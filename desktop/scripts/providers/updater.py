"""GitHub Releases 雙軌自動更新與版本隔離管理模組
設計原則：
1. 敏感憑證（Read-only Fine-grained Token）與更新設定嚴格隔離於 %LOCALAPPDATA%\\ChipScreener\\user-v1\\。
2. 版本分層：shellVersion（安裝目錄外殼）與 appVersion（scripts/release_meta.json 熱更程式版）。
3. 雙通道管理：stable（預設）與 beta，支援 SemVer 與 -beta.N / -b05.1 預發比較。
4. 防變磚：安全解壓至 runtime/<appVersion>/（僅限 build/dashboard.html 與 scripts/），
   配合 pendingVerify 健康檢查與啟動失敗自動回滾上一有效版本；開發環境（含 .git）預設略過 runtime 覆寫。
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from providers.secret_store import (
    clear_gemini_api_key,
    get_gemini_key_meta,
    set_gemini_api_key,
)

TAIPEI_TZ = timezone(timedelta(hours=8))
DEFAULT_REPO = 'Jimmy0916-LAI/chip-screener'
VALID_REPO_RE = re.compile(r'^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$')
VALID_CHANNELS = ('stable', 'beta')
VALID_INTERVALS = (15, 30, 60)
MAX_BUNDLE_BYTES = 32 * 1024 * 1024
HTTP_TIMEOUT_SEC = 20


def taipei_now() -> str:
    return datetime.now(TAIPEI_TZ).isoformat(timespec='seconds')


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stage = path.with_suffix('.json.tmp')
    stage.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(stage, path)


def _read_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return dict(default)
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else dict(default)
    except Exception:
        return dict(default)


def parse_semver(version: str) -> tuple[tuple[int, int, int], tuple[tuple[int, int | str], ...]]:
    """解析 SemVer（支援 v 前綴與 -beta.1 / -b05.1 預發標籤）。"""
    raw = str(version or '').strip().lstrip('vV').split('+', 1)[0]
    core_part, _, pre_part = raw.partition('-')
    nums = []
    for seg in (core_part.split('.') + ['0', '0', '0'])[:3]:
        m = re.match(r'^(\d+)', seg.strip())
        nums.append(int(m.group(1)) if m else 0)
    pre_tokens: list[tuple[int, int | str]] = []
    if pre_part:
        for tok in re.split(r'[.\-_]+', pre_part):
            if not tok:
                continue
            if tok.isdigit():
                pre_tokens.append((0, int(tok)))
            else:
                pre_tokens.append((1, tok.lower()))
    return (nums[0], nums[1], nums[2]), tuple(pre_tokens)


def compare_semver(a: str, b: str) -> int:
    """比較版本 a 與 b：a > b 回傳 1、a < b 回傳 -1、相等回傳 0。"""
    core_a, pre_a = parse_semver(a)
    core_b, pre_b = parse_semver(b)
    if core_a != core_b:
        return 1 if core_a > core_b else -1
    if not pre_a and not pre_b:
        return 0
    if not pre_a:
        return 1  # 正式版 > 同版號預發版
    if not pre_b:
        return -1
    for ta, tb in zip(pre_a, pre_b):
        if ta != tb:
            return 1 if ta > tb else -1
    if len(pre_a) == len(pre_b):
        return 0
    return 1 if len(pre_a) > len(pre_b) else -1


def normalize_repo(repo_text: str) -> str:
    raw = str(repo_text or '').strip()
    if not raw:
        return DEFAULT_REPO
    if 'github.com/' in raw:
        tail = raw.split('github.com/', 1)[1]
        parts = [p for p in tail.split('/') if p]
        if len(parts) >= 2:
            raw = f'{parts[0]}/{parts[1]}'
    if raw.endswith('.git'):
        raw = raw[:-4]
    raw = raw.strip('/')
    if not VALID_REPO_RE.fullmatch(raw):
        raise ValueError('GitHub Repo 格式須為 owner/repo（例如 Jimmy0916-LAI/chip-screener）')
    return raw


def mask_token(token: str) -> str:
    if not token:
        return ''
    if len(token) <= 8:
        return '****'
    return f'{token[:4]}...{token[-4:]}'


class _StripAuthRedirectHandler(urllib.request.HTTPRedirectHandler):
    """GitHub Release Private Asset API 重導向至物件儲存時自動剝除 Authorization，避免 400 錯誤。"""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        new_req = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new_req is None:
            return None
        old_host = urllib.parse.urlsplit(req.full_url).netloc.lower()
        new_host = urllib.parse.urlsplit(newurl).netloc.lower()
        if new_host != old_host:
            for h in ('Authorization', 'authorization', 'Cookie', 'cookie'):
                new_req.headers.pop(h, None)
                new_req.unredirected_hdrs.pop(h, None)
        return new_req


_HTTPS_OPENER = urllib.request.build_opener(_StripAuthRedirectHandler())


def _http_fetch_bytes(
    url: str,
    headers: dict[str, str] | None = None,
    timeout: int = HTTP_TIMEOUT_SEC,
    max_bytes: int = MAX_BUNDLE_BYTES,
    on_progress=None,
) -> bytes:
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme.lower() != 'https':
        raise ValueError('基於安全性要求，遠端更新僅允許 HTTPS 協定')
    req_headers = {
        'User-Agent': 'ChipScreener-Updater/0.6',
        'Cache-Control': 'no-cache',
    }
    if headers:
        req_headers.update(headers)
    req = urllib.request.Request(url, headers=req_headers)
    try:
        with _HTTPS_OPENER.open(req, timeout=timeout) as resp:
            if resp.status != 200:
                raise ValueError(f'遠端回應 HTTP {resp.status}')
            raw_len = resp.headers.get('Content-Length') if resp.headers else None
            try:
                content_len = int(raw_len) if raw_len and str(raw_len).strip().isdigit() else 0
            except (TypeError, ValueError):
                content_len = 0
            if content_len > max_bytes:
                raise ValueError('更新檔體積超過安全上限（32 MB）')
            chunks = []
            total = 0
            if callable(on_progress):
                on_progress(0, content_len)
            while True:
                part = resp.read(32768)
                if not part:
                    break
                total += len(part)
                if total > max_bytes:
                    raise ValueError('更新檔體積超過安全上限（32 MB）')
                chunks.append(part)
                if callable(on_progress):
                    on_progress(total, content_len)
            return b''.join(chunks)
    except urllib.error.HTTPError as exc:
        if exc.code == 401:
            raise ValueError('GitHub 驗證失敗（HTTP 401），請檢查 Read-only Token 是否過期或無效') from exc
        if exc.code in (403, 404):
            raise ValueError(f'找不到 GitHub Release 或存取受限（HTTP {exc.code}；若為私人 Repo 請設定 Contents: Read-only Token）') from exc
        raise ValueError(f'GitHub API 錯誤（HTTP {exc.code}）') from exc
    except urllib.error.URLError as exc:
        raise ValueError(f'無法連線更新伺服器：{exc.reason}') from exc
    except TimeoutError as exc:
        raise ValueError('連線更新伺服器逾時') from exc


def read_install_shell_version(install_root: Path) -> str:
    pkg_file = install_root / 'package.json'
    if pkg_file.exists():
        try:
            doc = json.loads(pkg_file.read_text(encoding='utf-8'))
            if doc.get('version'):
                return str(doc['version']).strip()
        except Exception:
            pass
    return '0.6.0-b05.1'


def read_code_meta(code_root: Path) -> dict:
    meta_file = code_root / 'scripts' / 'release_meta.json'
    if meta_file.exists():
        try:
            doc = json.loads(meta_file.read_text(encoding='utf-8'))
            if isinstance(doc, dict) and doc.get('appVersion'):
                return doc
        except Exception:
            pass
    return {
        'appVersion': read_install_shell_version(code_root),
        'channel': 'stable',
        'builtAt': '',
    }


def runtime_dir_valid(path: Path) -> bool:
    return (
        path.is_dir()
        and (path / 'build' / 'dashboard.html').is_file()
        and (path / 'scripts' / 'serve_local.py').is_file()
    )


def _runtime_paths(app_data_dir: Path) -> tuple[Path, Path, Path, Path]:
    user_dir = app_data_dir / 'user-v1'
    cfg_file = user_dir / 'updater-config.json'
    sec_file = user_dir / 'updater-secrets.json'
    rt_root = app_data_dir / 'runtime'
    rt_state_file = rt_root / 'state.json'
    return cfg_file, sec_file, rt_root, rt_state_file


def load_updater_config(app_data_dir: Path) -> dict:
    cfg_file, _, _, _ = _runtime_paths(app_data_dir)
    raw = _read_json(cfg_file, {})
    channel = raw.get('channel') if raw.get('channel') in VALID_CHANNELS else 'stable'
    try:
        repo = normalize_repo(raw.get('repo') or DEFAULT_REPO)
    except ValueError:
        repo = DEFAULT_REPO
    interval_raw = raw.get('liveQuoteIntervalSec', 30)
    try:
        interval = int(interval_raw)
        if interval not in VALID_INTERVALS:
            interval = 30
    except (TypeError, ValueError):
        interval = 30
    return {
        'version': 1,
        'channel': channel,
        'repo': repo,
        'allowRuntimeInDev': bool(raw.get('allowRuntimeInDev', False)),
        'liveQuoteEnabled': bool(raw.get('liveQuoteEnabled', True)),
        'liveQuoteIntervalSec': interval,
    }


def load_runtime_state(app_data_dir: Path) -> dict:
    _, _, _, rt_state_file = _runtime_paths(app_data_dir)
    raw = _read_json(rt_state_file, {})
    notice_raw = raw.get('recentReleaseNotice')
    notice = None
    if isinstance(notice_raw, dict) and str(notice_raw.get('version') or '').strip():
        notice = {
            'version': str(notice_raw.get('version') or '').strip(),
            'previousVersion': str(notice_raw.get('previousVersion') or '').strip(),
            'changelog': [str(x).strip() for x in (notice_raw.get('changelog') or []) if str(x).strip()],
            'appliedAt': str(notice_raw.get('appliedAt') or '').strip(),
            'acknowledged': bool(notice_raw.get('acknowledged', False)),
        }
    return {
        'activeVersion': str(raw.get('activeVersion') or ''),
        'previousVersion': str(raw.get('previousVersion') or ''),
        'lastKnownGood': str(raw.get('lastKnownGood') or ''),
        'pendingVerify': bool(raw.get('pendingVerify', False)),
        'verifyAttempts': int(raw.get('verifyAttempts') or 0),
        'lastError': str(raw.get('lastError') or ''),
        'rolledBackFrom': str(raw.get('rolledBackFrom') or ''),
        'rolledBackAt': str(raw.get('rolledBackAt') or ''),
        'updatedAt': str(raw.get('updatedAt') or ''),
        'recentReleaseNotice': notice,
    }


def _find_fallback_runtime(rt_root: Path, st: dict, bad_ver: str) -> str:
    for cand in (st.get('previousVersion', ''), st.get('lastKnownGood', '')):
        if cand and cand != bad_ver and runtime_dir_valid(rt_root / cand):
            return cand
    return ''


def resolve_boot_runtime(
    install_root: Path,
    app_data_dir: Path,
    cli_runtime_override: bool | None = None,
) -> tuple[Path | None, str, str]:
    """供 launcher.py 於啟動時解析應載入之 runtime 目錄，並執行 pendingVerify 自動回滾檢查。
    回傳：(runtime_root_or_None, active_version_label, notice_message)
    """
    is_dev = (install_root / '.git').exists()
    cfg = load_updater_config(app_data_dir)
    allow_runtime = (not is_dev) or cfg.get('allowRuntimeInDev', False)
    if cli_runtime_override is not None:
        allow_runtime = cli_runtime_override

    if not allow_runtime:
        return None, '', '開發環境偵測 (.git)，已略過載入 runtime 覆寫'

    _, _, rt_root, rt_state_file = _runtime_paths(app_data_dir)
    st = load_runtime_state(app_data_dir)
    active = st['activeVersion']
    if not active:
        return None, '', ''

    rt_dir = rt_root / active
    if not runtime_dir_valid(rt_dir):
        fallback = _find_fallback_runtime(rt_root, st, active)
        st['rolledBackFrom'] = active
        st['rolledBackAt'] = taipei_now()
        st['lastError'] = f'版本 {active} 檔案不完整，已自動回滾'
        st['activeVersion'] = fallback
        st['pendingVerify'] = False
        st['verifyAttempts'] = 0
        st['recentReleaseNotice'] = None
        _atomic_write_json(rt_state_file, st)
        return (rt_root / fallback if fallback else None), fallback, st['lastError']

    if st['pendingVerify']:
        if st['verifyAttempts'] >= 1:
            fallback = _find_fallback_runtime(rt_root, st, active)
            st['rolledBackFrom'] = active
            st['rolledBackAt'] = taipei_now()
            st['lastError'] = f'版本 {active} 啟動健康檢查未通過，已自動回滾至上一可用版本'
            st['activeVersion'] = fallback
            st['pendingVerify'] = False
            st['verifyAttempts'] = 0
            st['recentReleaseNotice'] = None
            _atomic_write_json(rt_state_file, st)
            return (rt_root / fallback if fallback else None), fallback, st['lastError']
        st['verifyAttempts'] = st['verifyAttempts'] + 1
        _atomic_write_json(rt_state_file, st)

    return rt_dir, active, ''


def record_boot_failure_and_rollback(app_data_dir: Path, failed_ver: str, reason: str) -> tuple[Path | None, str]:
    _, _, rt_root, rt_state_file = _runtime_paths(app_data_dir)
    st = load_runtime_state(app_data_dir)
    fallback = _find_fallback_runtime(rt_root, st, failed_ver)
    st['rolledBackFrom'] = failed_ver
    st['rolledBackAt'] = taipei_now()
    st['lastError'] = f'版本 {failed_ver} 啟動失敗（{reason}），已自動回滾'
    st['activeVersion'] = fallback
    st['pendingVerify'] = False
    st['verifyAttempts'] = 0
    st['recentReleaseNotice'] = None
    _atomic_write_json(rt_state_file, st)
    return (rt_root / fallback if fallback else None), fallback


def mark_runtime_verified(app_data_dir: Path) -> None:
    _, _, _, rt_state_file = _runtime_paths(app_data_dir)
    if not rt_state_file.exists():
        return
    st = load_runtime_state(app_data_dir)
    if st.get('pendingVerify') or st.get('verifyAttempts'):
        st['pendingVerify'] = False
        st['verifyAttempts'] = 0
        if st.get('activeVersion'):
            st['lastKnownGood'] = st['activeVersion']
        st['updatedAt'] = taipei_now()
        _atomic_write_json(rt_state_file, st)


def _safe_extract_runtime_zip(zip_bytes: bytes, target_dir: Path) -> None:
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)
    target_dir.mkdir(parents=True, exist_ok=True)
    base_resolved = target_dir.resolve()

    with zipfile.ZipFile(io.BytesIO(zip_bytes), 'r') as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            rel = info.filename.replace('\\', '/').lstrip('/')
            if not rel or rel.startswith('/') or '..' in rel.split('/') or ':' in rel:
                raise ValueError(f'更新包內含不安全路徑：{info.filename}')
            # 熱更包僅允許寫入 build/dashboard.html 與 scripts/（不允許覆寫 data/ 或 user 資料）
            if not (rel == 'build/dashboard.html' or rel.startswith('scripts/')):
                continue
            if '/__pycache__/' in f'/{rel}' or rel.endswith('.pyc'):
                continue
            dest = (base_resolved / rel).resolve()
            if not str(dest).startswith(str(base_resolved)):
                raise ValueError(f'更新包路徑越界：{info.filename}')
            dest.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, 'r') as src_f, open(dest, 'wb') as out_f:
                shutil.copyfileobj(src_f, out_f)

    if not runtime_dir_valid(target_dir):
        shutil.rmtree(target_dir, ignore_errors=True)
        raise ValueError('更新包缺少必要檔案（須同時包含 build/dashboard.html 與 scripts/serve_local.py）')


class UpdaterService:
    def __init__(self, app_data_dir: Path, install_root: Path, code_root: Path):
        self.app_data_dir = app_data_dir
        self.install_root = install_root
        self.code_root = code_root
        self.cfg_file, self.sec_file, self.rt_root, self.rt_state_file = _runtime_paths(app_data_dir)
        self._lock = threading.RLock()
        self._progress_lock = threading.Lock()
        self._last_check: dict | None = None
        self._last_manifest: dict | None = None
        self._server_ref = None
        self._server_port = int(os.environ.get('CHIP_PORT', '18765'))
        self._progress: dict = {
            'active': False,
            'stage': 'idle',
            'percent': 0,
            'title': '',
            'detail': '',
            'downloadedBytes': 0,
            'totalBytes': 0,
            'error': '',
            'updatedAt': '',
        }

    def get_progress(self) -> dict:
        with self._progress_lock:
            return dict(self._progress)

    def _set_progress(
        self,
        *,
        active: bool,
        stage: str,
        percent: int,
        title: str,
        detail: str = '',
        downloaded_bytes: int = 0,
        total_bytes: int = 0,
        error: str = '',
    ) -> None:
        with self._progress_lock:
            self._progress = {
                'active': active,
                'stage': stage,
                'percent': max(0, min(100, int(percent))),
                'title': title,
                'detail': detail,
                'downloadedBytes': int(downloaded_bytes or 0),
                'totalBytes': int(total_bytes or 0),
                'error': str(error or ''),
                'updatedAt': taipei_now(),
            }

    def bind_server(self, server, port: int) -> None:
        self._server_ref = server
        self._server_port = port

    def is_dev_mode(self) -> bool:
        return (self.install_root / '.git').exists()

    def _read_secret_token(self) -> str:
        raw = _read_json(self.sec_file, {})
        return str(raw.get('githubToken') or '').strip()

    def _write_secret_token(self, token: str) -> None:
        if token:
            _atomic_write_json(self.sec_file, {'githubToken': token, 'updatedAt': taipei_now()})
        elif self.sec_file.exists():
            self.sec_file.unlink()

    def get_version_info(self) -> dict:
        shell_ver = read_install_shell_version(self.install_root)
        meta = read_code_meta(self.code_root)
        app_ver = str(meta.get('appVersion') or shell_ver)
        using_runtime = self.code_root.resolve() != self.install_root.resolve()
        return {
            'shellVersion': shell_ver,
            'appVersion': app_ver,
            'codeChannel': str(meta.get('channel') or 'stable'),
            'builtAt': str(meta.get('builtAt') or ''),
            'changelog': [str(x).strip() for x in (meta.get('changelog') or []) if str(x).strip()],
            'usingRuntime': using_runtime,
            'activeCodeRoot': str(self.code_root),
            'isDevMode': self.is_dev_mode(),
        }

    def get_state(self) -> dict:
        cfg = load_updater_config(self.app_data_dir)
        token = self._read_secret_token()
        ai_meta = get_gemini_key_meta(self.app_data_dir)
        rt_state = load_runtime_state(self.app_data_dir)
        ver = self.get_version_info()
        installed_runtimes: list[str] = []
        if self.rt_root.exists():
            for p in sorted(self.rt_root.iterdir()):
                if p.is_dir() and not p.name.startswith('.staging') and runtime_dir_valid(p):
                    installed_runtimes.append(p.name)
        return {
            'config': {
                **cfg,
                'hasToken': bool(token),
                'tokenHint': mask_token(token),
                'hasGeminiKey': ai_meta['hasGeminiKey'],
                'geminiKeyHint': ai_meta['geminiKeyHint'],
                'secretStorageMode': ai_meta['secretStorageMode'],
            },
            'version': ver,
            'runtime': {
                **rt_state,
                'installedVersions': installed_runtimes,
                'canRollback': bool(
                    rt_state.get('activeVersion')
                    and (rt_state.get('previousVersion') or rt_state.get('lastKnownGood') or ver['usingRuntime'])
                ),
            },
            'paths': {
                'configFile': str(self.cfg_file),
                'secretsFile': str(self.sec_file),
                'aiSecretsFile': str(self.app_data_dir / 'user-v1' / 'ai-secrets.json'),
                'runtimeDir': str(self.rt_root),
            },
            'lastCheck': self._last_check,
        }

    def update_config(self, body: dict) -> dict:
        with self._lock:
            cur = load_updater_config(self.app_data_dir)
            if 'channel' in body:
                ch = str(body['channel'] or '').strip().lower()
                if ch not in VALID_CHANNELS:
                    raise ValueError('更新通道僅支援 stable（正式版）或 beta（測試版）')
                cur['channel'] = ch
            if 'repo' in body:
                cur['repo'] = normalize_repo(body['repo'])
            if 'allowRuntimeInDev' in body:
                cur['allowRuntimeInDev'] = bool(body['allowRuntimeInDev'])
            if 'liveQuoteEnabled' in body:
                cur['liveQuoteEnabled'] = bool(body['liveQuoteEnabled'])
            if 'liveQuoteIntervalSec' in body:
                iv = int(body['liveQuoteIntervalSec'])
                if iv not in VALID_INTERVALS:
                    raise ValueError('即時更新頻率僅支援 15、30 或 60 秒')
                cur['liveQuoteIntervalSec'] = iv

            _atomic_write_json(self.cfg_file, cur)

            if body.get('clearToken'):
                self._write_secret_token('')
            elif isinstance(body.get('githubToken'), str) and body['githubToken'].strip():
                self._write_secret_token(body['githubToken'].strip())

            if body.get('clearGeminiKey'):
                clear_gemini_api_key(self.app_data_dir)
            elif isinstance(body.get('geminiApiKey'), str) and body['geminiApiKey'].strip():
                set_gemini_api_key(self.app_data_dir, body['geminiApiKey'])

        return self.get_state()

    def _github_headers(self, token: str, accept: str = 'application/vnd.github+json') -> dict[str, str]:
        headers = {'Accept': accept, 'X-GitHub-Api-Version': '2022-11-28'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        return headers

    def _fetch_release_manifest(self, repo: str, channel: str, token: str) -> tuple[dict, dict, str]:
        api_url = f'https://api.github.com/repos/{repo}/releases?per_page=15'
        raw = _http_fetch_bytes(api_url, headers=self._github_headers(token))
        releases = json.loads(raw.decode('utf-8'))
        if not isinstance(releases, list) or not releases:
            raise ValueError(f'{repo} 目前尚無任何 GitHub Release 發布紀錄')

        best_candidate = None
        for rel in releases:
            if rel.get('draft'):
                continue
            is_pre = bool(rel.get('prerelease'))
            if channel == 'stable' and is_pre:
                continue
            assets = rel.get('assets') or []
            manifest_asset = next((a for a in assets if a.get('name') == 'manifest.json'), None)
            if not manifest_asset and channel == 'beta':
                manifest_asset = next((a for a in assets if a.get('name') == 'manifest-beta.json'), None)
            if not manifest_asset:
                continue

            dl_url = manifest_asset.get('url') if token else (manifest_asset.get('browser_download_url') or manifest_asset.get('url'))
            accept = 'application/octet-stream' if (token or dl_url == manifest_asset.get('url')) else 'application/json'
            m_bytes = _http_fetch_bytes(dl_url, headers=self._github_headers(token, accept=accept), max_bytes=2 * 1024 * 1024)
            manifest_doc = json.loads(m_bytes.decode('utf-8'))
            entry = (manifest_doc.get('channels') or {}).get(channel)
            if not entry and channel == 'beta':
                entry = (manifest_doc.get('channels') or {}).get('stable')
            if not entry and manifest_doc.get('appVersion'):
                entry = manifest_doc
            if not isinstance(entry, dict) or not entry.get('appVersion'):
                continue

            if best_candidate is None or compare_semver(entry['appVersion'], best_candidate[0]['appVersion']) > 0:
                best_candidate = (entry, rel, str(rel.get('html_url') or f'https://github.com/{repo}/releases'))

        if not best_candidate:
            raise ValueError(f'在 {repo} 找不到 {channel} 通道的 manifest.json 發布資產')
        return best_candidate

    def check_for_updates(self, channel_override: str | None = None) -> dict:
        cfg = load_updater_config(self.app_data_dir)
        channel = channel_override if channel_override in VALID_CHANNELS else cfg['channel']
        repo = DEFAULT_REPO
        token = self._read_secret_token()
        ver_info = self.get_version_info()
        current_app = ver_info['appVersion']
        shell_ver = ver_info['shellVersion']

        entry, rel, html_url = self._fetch_release_manifest(repo, channel, token)
        remote_app = str(entry.get('appVersion') or '').strip()
        min_shell = str(entry.get('minShellVersion') or shell_ver).strip()
        bundle_url = str(entry.get('bundleUrl') or '').strip()
        asset_name = str(entry.get('assetName') or (bundle_url.rsplit('/', 1)[-1] if bundle_url else '')).strip()
        sha256 = str(entry.get('sha256') or '').strip().lower()
        changelog = entry.get('changelog')
        if isinstance(changelog, str):
            changelog_list = [line.strip() for line in changelog.splitlines() if line.strip()]
        elif isinstance(changelog, list):
            changelog_list = [str(x).strip() for x in changelog if str(x).strip()]
        else:
            body_text = str(rel.get('body') or '').strip()
            changelog_list = [line.strip() for line in body_text.splitlines()[:6] if line.strip()]

        if not bundle_url.startswith('https://'):
            raise ValueError('遠端 manifest.json 的 bundleUrl 必須使用 HTTPS')
        if not re.fullmatch(r'[0-9a-f]{64}', sha256):
            raise ValueError('遠端 manifest.json 缺少有效的 SHA-256 校驗碼')

        has_update = compare_semver(remote_app, current_app) > 0
        requires_shell = True

        # 解析 Private Repo API asset URL（供下載壓縮包時免 S3 Auth 衝突）
        assets = rel.get('assets') or []
        matched_asset = next(
            (a for a in assets if a.get('browser_download_url') == bundle_url or (asset_name and a.get('name') == asset_name)),
            None,
        )

        result = {
            'checkedAt': taipei_now(),
            'repo': repo,
            'channel': channel,
            'currentAppVersion': current_app,
            'shellVersion': shell_ver,
            'remoteAppVersion': remote_app,
            'minShellVersion': min_shell,
            'hasUpdate': has_update,
            'canHotUpdate': has_update and (not requires_shell),
            'requiresShellUpgrade': has_update and requires_shell,
            'bundleUrl': bundle_url,
            'apiAssetUrl': str(matched_asset.get('url') or '') if matched_asset else '',
            'assetName': asset_name,
            'sha256': sha256,
            'changelog': changelog_list,
            'releaseTag': str(rel.get('tag_name') or f'v{remote_app}'),
            'releaseUrl': str(entry.get('shellDownloadUrl') or html_url),
        }
        with self._lock:
            self._last_check = result
        return result

    def _run_apply_update(self, channel_override: str | None = None) -> dict:
        with self._lock:
            try:
                self._set_progress(
                    active=True,
                    stage='checking',
                    percent=10,
                    title='正在確認最新版本清單...',
                    detail='正在向 GitHub Releases 核對版本與 SHA-256 資訊',
                )
                info = self.check_for_updates(channel_override=channel_override)
                if not info['hasUpdate']:
                    raise ValueError(f'目前版本 {info["currentAppVersion"]} 已是最新')
                if info['requiresShellUpgrade']:
                    raise ValueError(
                        f'此版本（{info["remoteAppVersion"]}）需要新版外殼（需求 {info["minShellVersion"]}，目前 {info["shellVersion"]}），請先前往下載正式版'
                    )

                cfg = load_updater_config(self.app_data_dir)
                if self.is_dev_mode() and not cfg.get('allowRuntimeInDev'):
                    raise ValueError('目前偵測為 Git 開發環境且未開啟「開發模式載入 runtime 測試開關」，為避免與原始碼混淆已略過熱更；如需實測請先開啟該開關。')

                token = self._read_secret_token()
                dl_url = info['apiAssetUrl'] if (token and info['apiAssetUrl']) else info['bundleUrl']
                accept = 'application/octet-stream' if (token and info['apiAssetUrl']) else 'application/zip,application/octet-stream'
                target_ver = info['remoteAppVersion']

                def _on_dl_progress(done_bytes: int, total_bytes: int) -> None:
                    if total_bytes > 0:
                        pct = 15 + int((done_bytes / total_bytes) * 60)
                        detail = f'已下載 {done_bytes / 1024:.0f} KB / {total_bytes / 1024:.0f} KB'
                    else:
                        pct = min(72, 18 + int(done_bytes / 32768) * 2)
                        detail = f'已下載 {done_bytes / 1024:.0f} KB...'
                    self._set_progress(
                        active=True,
                        stage='downloading',
                        percent=pct,
                        title=f'正在下載更新包 {target_ver}...',
                        detail=detail,
                        downloaded_bytes=done_bytes,
                        total_bytes=total_bytes,
                    )

                zip_bytes = _http_fetch_bytes(
                    dl_url,
                    headers=self._github_headers(token, accept=accept),
                    on_progress=_on_dl_progress,
                )

                self._set_progress(
                    active=True,
                    stage='verifying',
                    percent=80,
                    title='正在校驗 SHA-256 完整性...',
                    detail=f'檔案大小 {len(zip_bytes) / 1024:.0f} KB，核對數位指紋中',
                    downloaded_bytes=len(zip_bytes),
                    total_bytes=len(zip_bytes),
                )
                actual_sha = hashlib.sha256(zip_bytes).hexdigest().lower()
                if actual_sha != info['sha256']:
                    raise ValueError(f'SHA-256 校驗失敗（預期 {info["sha256"][:12]}...，實際 {actual_sha[:12]}...），已中止套用')

                self._set_progress(
                    active=True,
                    stage='extracting',
                    percent=90,
                    title=f'正在安全解壓版本 {target_ver}...',
                    detail='僅寫入隔離執行區，不覆蓋個人設定與歷史基線',
                    downloaded_bytes=len(zip_bytes),
                    total_bytes=len(zip_bytes),
                )
                staging_dir = self.rt_root / f'.staging-{target_ver}'
                final_dir = self.rt_root / target_ver
                _safe_extract_runtime_zip(zip_bytes, staging_dir)

                if final_dir.exists():
                    shutil.rmtree(final_dir, ignore_errors=True)
                os.replace(staging_dir, final_dir)

                st = load_runtime_state(self.app_data_dir)
                prev = st.get('activeVersion') or info['currentAppVersion']
                prev_ver = prev if prev != target_ver else st.get('lastKnownGood', '')
                st.update({
                    'activeVersion': target_ver,
                    'previousVersion': prev_ver,
                    'pendingVerify': True,
                    'verifyAttempts': 0,
                    'lastError': '',
                    'updatedAt': taipei_now(),
                    'recentReleaseNotice': {
                        'version': target_ver,
                        'previousVersion': prev_ver,
                        'changelog': list(info.get('changelog') or []),
                        'appliedAt': taipei_now(),
                        'acknowledged': False,
                    },
                })
                _atomic_write_json(self.rt_state_file, st)

                self._set_progress(
                    active=True,
                    stage='restarting',
                    percent=95,
                    title=f'正在重啟服務以載入 {target_ver}...',
                    detail='就緒後將自動重新整理頁面並驗證啟動狀態',
                    downloaded_bytes=len(zip_bytes),
                    total_bytes=len(zip_bytes),
                )
                self.schedule_restart()
                return {
                    'ok': True,
                    'appliedVersion': target_ver,
                    'sha256': actual_sha,
                    'restarting': True,
                    'message': f'已校驗並套用 {target_ver}，正在背景重啟本機服務...',
                }
            except Exception as exc:
                self._set_progress(
                    active=False,
                    stage='error',
                    percent=0,
                    title='更新失敗',
                    detail=str(exc),
                    error=str(exc),
                )
                raise

    def apply_update(self, channel_override: str | None = None, async_mode: bool = False) -> dict:
        if not async_mode:
            return self._run_apply_update(channel_override=channel_override)
        cur = self.get_progress()
        if cur.get('active') and cur.get('stage') in ('checking', 'downloading', 'verifying', 'extracting', 'restarting'):
            return {'ok': True, 'started': False, 'alreadyRunning': True, 'progress': cur}
        self._set_progress(
            active=True,
            stage='checking',
            percent=8,
            title='正在準備檢查與下載更新...',
            detail='連線 GitHub Releases 中',
        )

        def _bg_worker() -> None:
            try:
                self._run_apply_update(channel_override=channel_override)
            except Exception:
                # 錯誤訊息已寫入 self._progress，供輪詢端回報前端
                pass

        threading.Thread(target=_bg_worker, daemon=True).start()
        return {'ok': True, 'started': True, 'progress': self.get_progress()}

    def rollback(self) -> dict:
        with self._lock:
            st = load_runtime_state(self.app_data_dir)
            cur = st.get('activeVersion', '')
            if not cur:
                raise ValueError('目前直接執行安裝目錄版本，無可回滾之熱更版本')
            fallback = _find_fallback_runtime(self.rt_root, st, cur)
            st.update({
                'rolledBackFrom': cur,
                'rolledBackAt': taipei_now(),
                'lastError': f'使用者手動從 {cur} 回滾至 {fallback or "內建安裝版"}',
                'activeVersion': fallback,
                'pendingVerify': False,
                'verifyAttempts': 0,
                'updatedAt': taipei_now(),
                'recentReleaseNotice': None,
            })
            _atomic_write_json(self.rt_state_file, st)
            self.schedule_restart()
            return {
                'ok': True,
                'rolledBackFrom': cur,
                'targetVersion': fallback or read_install_shell_version(self.install_root),
                'restarting': True,
                'message': f'已設定回滾至 {fallback or "內建安裝版"}，正在背景重啟服務...',
            }

    def dismiss_release_notice(self) -> dict:
        with self._lock:
            st = load_runtime_state(self.app_data_dir)
            notice = st.get('recentReleaseNotice')
            if isinstance(notice, dict):
                notice['acknowledged'] = True
                st['recentReleaseNotice'] = notice
                st['updatedAt'] = taipei_now()
                _atomic_write_json(self.rt_state_file, st)
        return self.get_state()

    def schedule_restart(self, delay_sec: float = 0.35) -> None:
        install_launcher = self.install_root / 'scripts' / 'launcher.py'
        port = int(self._server_port or 18765)
        server_ref = self._server_ref
        if not install_launcher.exists():
            return

        def _do_restart():
            time.sleep(delay_sec)
            if server_ref is not None:
                try:
                    server_ref.server_close()
                except Exception:
                    pass
            child_env = os.environ.copy()
            child_env['CHIP_WAIT_PORT_RELEASE'] = '1'
            cmd = [sys.executable, '-B', '-X', 'utf8', str(install_launcher), '--no-open', '--port', str(port)]
            kwargs: dict = {
                'cwd': str(self.install_root),
                'env': child_env,
                'stdout': subprocess.DEVNULL,
                'stderr': subprocess.DEVNULL,
                'stdin': subprocess.DEVNULL,
            }
            if sys.platform == 'win32':
                kwargs['creationflags'] = (
                    getattr(subprocess, 'CREATE_NEW_PROCESS_GROUP', 0x00000200)
                    | getattr(subprocess, 'DETACHED_PROCESS', 0x00000008)
                    | getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)
                )
            try:
                subprocess.Popen(cmd, **kwargs)
            finally:
                time.sleep(0.05)
                os._exit(0)

        threading.Thread(target=_do_restart, daemon=True).start()
