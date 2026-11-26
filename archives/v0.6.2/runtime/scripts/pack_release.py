"""一鍵打包 ChipScreener 輕量熱更發佈包工具
流程：
1. 依版本號與通道更新 scripts/release_meta.json
2. 執行 scripts/build_dashboard.py 重新編譯 build/dashboard.html（除非指定 --skip-build）
3. 僅打包 build/dashboard.html 與 scripts/（排除 __pycache__ / *.pyc 與 data/ 基線、用戶資料）
4. 計算 ZIP 檔 SHA-256 校驗碼並更新 dist/manifest.json 對應通道（stable / beta）
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / 'scripts'
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import build_dashboard  # noqa: E402
from providers.updater import DEFAULT_REPO, normalize_repo, read_install_shell_version  # noqa: E402

TAIPEI_TZ = timezone(timedelta(hours=8))


def pack_release(
    version: str,
    channel: str | None = None,
    min_shell: str | None = None,
    repo: str = DEFAULT_REPO,
    tag: str | None = None,
    changelog: list[str] | None = None,
    out_dir: Path | None = None,
    skip_build: bool = False,
    dry_meta_restore: bool = False,
) -> dict:
    clean_ver = str(version or '').strip().lstrip('vV')
    if not clean_ver:
        raise ValueError('請提供發佈版號（例如 0.6.1 或 0.6.2-beta.1）')

    resolved_channel = channel or ('beta' if ('-' in clean_ver and 'beta' in clean_ver.lower()) else 'stable')
    if resolved_channel not in ('stable', 'beta'):
        raise ValueError('channel 僅支援 stable 或 beta')

    repo_slug = normalize_repo(repo)
    shell_min = (min_shell or read_install_shell_version(ROOT)).strip()
    release_tag = tag or f'v{clean_ver}'
    now_iso = datetime.now(TAIPEI_TZ).isoformat(timespec='seconds')

    meta_file = SCRIPTS_DIR / 'release_meta.json'
    prev_meta_raw = meta_file.read_text(encoding='utf-8') if meta_file.exists() else None
    meta_doc = {
        'appVersion': clean_ver,
        'channel': resolved_channel,
        'builtAt': now_iso,
    }
    meta_file.write_text(json.dumps(meta_doc, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    try:
        if not skip_build:
            build_dashboard.build()

        dashboard_file = ROOT / 'build' / 'dashboard.html'
        if not dashboard_file.is_file():
            raise FileNotFoundError(f'找不到建置產物：{dashboard_file}')

        target_out = out_dir or (ROOT / 'dist')
        target_out.mkdir(parents=True, exist_ok=True)
        asset_name = f'ChipScreener-runtime-{clean_ver}.zip'
        zip_path = target_out / asset_name

        file_count = 0
        with zipfile.ZipFile(zip_path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            zf.write(dashboard_file, 'build/dashboard.html')
            file_count += 1
            for p in sorted(SCRIPTS_DIR.rglob('*')):
                if not p.is_file():
                    continue
                rel = p.relative_to(ROOT).as_posix()
                if '__pycache__' in rel.split('/') or p.suffix in ('.pyc', '.pyo'):
                    continue
                zf.write(p, rel)
                file_count += 1

        zip_bytes = zip_path.read_bytes()
        sha256 = hashlib.sha256(zip_bytes).hexdigest().lower()

        manifest_path = target_out / 'manifest.json'
        if manifest_path.exists():
            try:
                manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            except Exception:
                manifest = {}
        else:
            manifest = {}

        if not isinstance(manifest, dict):
            manifest = {}
        channels = manifest.get('channels')
        if not isinstance(channels, dict):
            channels = {}

        notes = [line.strip() for line in (changelog or []) if line and line.strip()]
        if not notes:
            notes = [f'ChipScreener {clean_ver}（{resolved_channel}）熱更更新包']

        channels[resolved_channel] = {
            'appVersion': clean_ver,
            'minShellVersion': shell_min,
            'assetName': asset_name,
            'bundleUrl': f'https://github.com/{repo_slug}/releases/download/{release_tag}/{asset_name}',
            'shellDownloadUrl': f'https://github.com/{repo_slug}/releases/tag/{release_tag}',
            'sha256': sha256,
            'sizeBytes': len(zip_bytes),
            'changelog': notes,
            'publishedAt': now_iso,
        }

        manifest['schemaVersion'] = 1
        manifest['updatedAt'] = now_iso
        manifest['repo'] = repo_slug
        manifest['channels'] = channels
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

        return {
            'version': clean_ver,
            'channel': resolved_channel,
            'minShellVersion': shell_min,
            'zipPath': str(zip_path),
            'manifestPath': str(manifest_path),
            'sha256': sha256,
            'sizeBytes': len(zip_bytes),
            'fileCount': file_count,
        }
    finally:
        if dry_meta_restore and prev_meta_raw is not None:
            meta_file.write_text(prev_meta_raw, encoding='utf-8')


def main() -> None:
    parser = argparse.ArgumentParser(description='ChipScreener 一鍵打包輕量熱更發佈包與 manifest.json')
    parser.add_argument('--version', required=True, help='目標熱更版號（例：0.6.1 或 0.6.2-beta.1）')
    parser.add_argument('--channel', choices=['stable', 'beta'], default=None, help='發布通道（未指定時依版號自動判斷）')
    parser.add_argument('--min-shell', default=None, help='最低要求外殼版號（預設讀取 package.json）')
    parser.add_argument('--repo', default=DEFAULT_REPO, help='GitHub Repo（owner/repo）')
    parser.add_argument('--tag', default=None, help='Release Tag（預設 v<version>）')
    parser.add_argument('--changelog', action='append', default=[], help='更新摘要項目（可重複指定）')
    parser.add_argument('--out-dir', default=None, help='輸出目錄（預設 dist/）')
    parser.add_argument('--skip-build', action='store_true', help='略過重新編譯 build/dashboard.html')
    parser.add_argument('--restore-meta', action='store_true', help='打包後還原工作區 release_meta.json（適用測試打包）')
    args = parser.parse_args()

    res = pack_release(
        version=args.version,
        channel=args.channel,
        min_shell=args.min_shell,
        repo=args.repo,
        tag=args.tag,
        changelog=args.changelog,
        out_dir=Path(args.out_dir) if args.out_dir else None,
        skip_build=args.skip_build,
        dry_meta_restore=args.restore_meta,
    )
    print(json.dumps(res, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    main()
