"""本機 AI 金鑰安全儲存模組（純 Python 3.10 標準函式庫）
- Windows 環境使用 DPAPI（crypt32.dll CryptProtectData / CryptUnprotectData，CRYPTPROTECT_UI_FORBIDDEN）
  將金鑰綁定至目前 Windows 使用者帳號與本應用程式熵值後再以 Base64 密文寫入
  %LOCALAPPDATA%\\ChipScreener\\user-v1\\ai-secrets.json，磁碟上絕不留存明文。
- 非 Windows 環境自動降級為 0600 權限隔離檔案（file-0600）。
- 自動無縫遷移舊版明文 user-v1/briefing-secrets.json 至加密儲存，並立即清除舊明文檔。
"""

from __future__ import annotations

import base64
import json
import os
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

TAIPEI_TZ = timezone(timedelta(hours=8))
OPTIONAL_ENTROPY = b'ChipScreener-SecretStore-v1'
CRYPTPROTECT_UI_FORBIDDEN = 0x01
MAX_KEY_LENGTH = 512

_STORE_LOCK = threading.Lock()


def _taipei_now() -> str:
    return datetime.now(TAIPEI_TZ).isoformat(timespec='seconds')


def _is_dpapi_available() -> bool:
    if os.name != 'nt':
        return False
    try:
        import ctypes  # noqa: F401
        import ctypes.wintypes  # noqa: F401
        return True
    except Exception:
        return False


def storage_mode_label() -> str:
    return 'Windows DPAPI 使用者加密' if _is_dpapi_available() else '本機權限隔離'


def _dpapi_protect(plaintext: bytes) -> bytes:
    import ctypes
    import ctypes.wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ('cbData', ctypes.wintypes.DWORD),
            ('pbData', ctypes.POINTER(ctypes.c_char)),
        ]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        ctypes.wintypes.LPCWSTR,
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    crypt32.CryptProtectData.restype = ctypes.wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    in_buf = ctypes.create_string_buffer(plaintext, len(plaintext))
    ent_buf = ctypes.create_string_buffer(OPTIONAL_ENTROPY, len(OPTIONAL_ENTROPY))
    blob_in = DATA_BLOB(len(plaintext), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_char)))
    blob_ent = DATA_BLOB(len(OPTIONAL_ENTROPY), ctypes.cast(ent_buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()

    ok = crypt32.CryptProtectData(
        ctypes.byref(blob_in),
        'ChipScreener AI Secret',
        ctypes.byref(blob_ent),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(blob_out),
    )
    if not ok:
        raise RuntimeError('Windows DPAPI 加密失敗')
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        if blob_out.pbData:
            kernel32.LocalFree(blob_out.pbData)


def _dpapi_unprotect(ciphertext: bytes) -> bytes:
    import ctypes
    import ctypes.wintypes

    class DATA_BLOB(ctypes.Structure):
        _fields_ = [
            ('cbData', ctypes.wintypes.DWORD),
            ('pbData', ctypes.POINTER(ctypes.c_char)),
        ]

    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32

    crypt32.CryptUnprotectData.argtypes = [
        ctypes.POINTER(DATA_BLOB),
        ctypes.POINTER(ctypes.wintypes.LPWSTR),
        ctypes.POINTER(DATA_BLOB),
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.wintypes.DWORD,
        ctypes.POINTER(DATA_BLOB),
    ]
    crypt32.CryptUnprotectData.restype = ctypes.wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p

    in_buf = ctypes.create_string_buffer(ciphertext, len(ciphertext))
    ent_buf = ctypes.create_string_buffer(OPTIONAL_ENTROPY, len(OPTIONAL_ENTROPY))
    blob_in = DATA_BLOB(len(ciphertext), ctypes.cast(in_buf, ctypes.POINTER(ctypes.c_char)))
    blob_ent = DATA_BLOB(len(OPTIONAL_ENTROPY), ctypes.cast(ent_buf, ctypes.POINTER(ctypes.c_char)))
    blob_out = DATA_BLOB()

    ok = crypt32.CryptUnprotectData(
        ctypes.byref(blob_in),
        None,
        ctypes.byref(blob_ent),
        None,
        None,
        CRYPTPROTECT_UI_FORBIDDEN,
        ctypes.byref(blob_out),
    )
    if not ok:
        raise RuntimeError('Windows DPAPI 解密失敗')
    try:
        return ctypes.string_at(blob_out.pbData, blob_out.cbData)
    finally:
        if blob_out.pbData:
            kernel32.LocalFree(blob_out.pbData)


def _secrets_file(app_data_dir: Path) -> Path:
    return Path(app_data_dir) / 'user-v1' / 'ai-secrets.json'


def _legacy_briefing_secrets_file(app_data_dir: Path) -> Path:
    return Path(app_data_dir) / 'user-v1' / 'briefing-secrets.json'


def _atomic_write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    stage = path.with_suffix('.json.tmp')
    stage.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    if os.name != 'nt':
        try:
            os.chmod(stage, 0o600)
        except OSError:
            pass
    os.replace(stage, path)
    if os.name != 'nt':
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def _read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _cleanup_legacy_plaintext(app_data_dir: Path) -> None:
    legacy_path = _legacy_briefing_secrets_file(app_data_dir)
    if not legacy_path.exists():
        return
    try:
        doc = _read_json(legacy_path)
        if 'geminiApiKey' in doc:
            doc.pop('geminiApiKey', None)
        if doc:
            _atomic_write_json(legacy_path, doc)
        else:
            legacy_path.unlink(missing_ok=True)
    except OSError:
        pass


def _sanitize_api_key(key: str) -> str:
    if not isinstance(key, str):
        raise ValueError('AI 金鑰格式無效')
    cleaned = key.strip()
    if not cleaned:
        raise ValueError('AI 金鑰不能為空')
    if len(cleaned) > MAX_KEY_LENGTH:
        raise ValueError(f'AI 金鑰長度超過安全上限（{MAX_KEY_LENGTH} 字元）')
    if any(ord(ch) < 32 or ord(ch) == 127 or ch.isspace() for ch in cleaned):
        raise ValueError('AI 金鑰不能包含換行、控制字元或空白')
    return cleaned


def mask_api_key(key: str) -> str:
    if not key:
        return ''
    if len(key) >= 6:
        return '••••' + key[-4:]
    return '已設定'


def _encode_secret(plaintext: str) -> tuple[str, str]:
    raw = plaintext.encode('utf-8')
    if _is_dpapi_available():
        protected = _dpapi_protect(raw)
        return 'dpapi-v1', base64.b64encode(protected).decode('ascii')
    return 'file-0600', base64.b64encode(raw).decode('ascii')


def _decode_secret(encoding: str, encoded_value: str) -> str:
    if not encoded_value:
        return ''
    try:
        blob = base64.b64decode(encoded_value.encode('ascii'), validate=True)
    except Exception:
        return ''
    if encoding == 'dpapi-v1':
        if not _is_dpapi_available():
            return ''
        try:
            return _dpapi_unprotect(blob).decode('utf-8').strip()
        except Exception:
            return ''
    if encoding == 'file-0600':
        try:
            return blob.decode('utf-8').strip()
        except Exception:
            return ''
    return ''


def _write_key_unlocked(app_data_dir: Path, cleaned_key: str) -> None:
    enc_mode, enc_val = _encode_secret(cleaned_key)
    path = _secrets_file(app_data_dir)
    doc = _read_json(path)
    secrets = doc.get('secrets') if isinstance(doc.get('secrets'), dict) else {}
    # 若編碼方式改變則以新格式覆寫
    if doc.get('encoding') != enc_mode:
        secrets = {}
    secrets['geminiApiKey'] = enc_val
    payload = {
        'version': 1,
        'encoding': enc_mode,
        'updatedAt': _taipei_now(),
        'secrets': secrets,
    }
    _atomic_write_json(path, payload)
    _cleanup_legacy_plaintext(app_data_dir)


def get_gemini_api_key(app_data_dir: Path) -> str:
    with _STORE_LOCK:
        path = _secrets_file(app_data_dir)
        doc = _read_json(path)
        enc_mode = str(doc.get('encoding') or '').strip()
        secrets = doc.get('secrets') if isinstance(doc.get('secrets'), dict) else {}
        enc_val = str(secrets.get('geminiApiKey') or '').strip()
        if enc_mode and enc_val:
            decoded = _decode_secret(enc_mode, enc_val)
            if decoded:
                return decoded

        # 無縫遷移舊版明文 user-v1/briefing-secrets.json
        legacy_path = _legacy_briefing_secrets_file(app_data_dir)
        if legacy_path.exists():
            legacy_doc = _read_json(legacy_path)
            raw_legacy = str(legacy_doc.get('geminiApiKey') or '').strip()
            if raw_legacy:
                try:
                    cleaned = _sanitize_api_key(raw_legacy)
                    _write_key_unlocked(app_data_dir, cleaned)
                    return cleaned
                except Exception:
                    return ''
        return ''


def set_gemini_api_key(app_data_dir: Path, key: str) -> dict:
    cleaned = _sanitize_api_key(key)
    with _STORE_LOCK:
        _write_key_unlocked(app_data_dir, cleaned)
    return {
        'hasGeminiKey': True,
        'geminiKeyHint': mask_api_key(cleaned),
        'secretStorageMode': storage_mode_label(),
    }


def clear_gemini_api_key(app_data_dir: Path) -> dict:
    with _STORE_LOCK:
        path = _secrets_file(app_data_dir)
        if path.exists():
            doc = _read_json(path)
            secrets = doc.get('secrets') if isinstance(doc.get('secrets'), dict) else {}
            secrets.pop('geminiApiKey', None)
            if secrets:
                doc['secrets'] = secrets
                doc['updatedAt'] = _taipei_now()
                _atomic_write_json(path, doc)
            else:
                try:
                    path.unlink(missing_ok=True)
                except OSError:
                    pass
        _cleanup_legacy_plaintext(app_data_dir)
    return {
        'hasGeminiKey': False,
        'geminiKeyHint': '',
        'secretStorageMode': storage_mode_label(),
    }


def get_gemini_key_meta(app_data_dir: Path) -> dict:
    key = get_gemini_api_key(app_data_dir)
    return {
        'hasGeminiKey': bool(key),
        'geminiKeyHint': mask_api_key(key),
        'secretStorageMode': storage_mode_label(),
    }


AI_KEY_FIELDS = {
    'gemini': 'geminiApiKey',
    'deepseek': 'deepseekApiKey',
    'claude': 'claudeApiKey',
    'openai': 'openaiApiKey',
}


def get_ai_key(app_data_dir: Path, provider: str) -> str:
    if provider == 'gemini':
        return get_gemini_api_key(app_data_dir)
    with _STORE_LOCK:
        doc = _read_json(_secrets_file(app_data_dir))
        secrets = doc.get('secrets') if isinstance(doc.get('secrets'), dict) else {}
        return _decode_secret(str(doc.get('encoding') or ''), str(secrets.get(AI_KEY_FIELDS[provider]) or ''))


def update_ai_keys(app_data_dir: Path, changes: dict) -> None:
    cleaned = {AI_KEY_FIELDS[provider]: _sanitize_api_key(value) if value is not None else None
               for provider, value in changes.items()}
    if not cleaned:
        return
    with _STORE_LOCK:
        path = _secrets_file(app_data_dir)
        doc = _read_json(path)
        encoding = 'dpapi-v1' if _is_dpapi_available() else 'file-0600'
        if os.name == 'nt' and encoding != 'dpapi-v1':
            raise ValueError('Windows DPAPI 無法使用，金鑰未儲存')
        secrets = doc.get('secrets') if isinstance(doc.get('secrets'), dict) else {}
        if secrets and doc.get('encoding') != encoding:
            raise ValueError('現有金鑰儲存格式與本機不相容')
        for field, key in cleaned.items():
            if key is None:
                secrets.pop(field, None)
            else:
                _, protected = _encode_secret(key)
                secrets[field] = protected
        _atomic_write_json(path, {
            'version': 1, 'encoding': encoding, 'updatedAt': _taipei_now(), 'secrets': secrets,
        })
        if 'geminiApiKey' in cleaned:
            _cleanup_legacy_plaintext(app_data_dir)
