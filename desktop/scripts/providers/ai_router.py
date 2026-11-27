"""Route each AI feature through the selected provider, with local fallbacks."""
from dataclasses import dataclass, field
import json
from pathlib import Path
import re
import threading
import urllib.error
import urllib.request

from . import secret_store

PROVIDERS = {
    'gemini': ('Gemini', 'gemini-2.5-flash'),
    'deepseek': ('DeepSeek', 'deepseek-chat'),
    'claude': ('Claude', 'claude-sonnet-4-6'),
    'openai': ('OpenAI', 'gpt-4.1-mini'),
}
FEATURES = ('briefing', 'channels', 'trader')
VIDEO_MODELS = {'gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'}
SETTINGS_LOCK = threading.RLock()

MESSAGES = {
    'ready': '已啟用 AI',
    'disabled': 'AI 總開關已關閉',
    'feature_disabled': '此模組的 AI 已關閉',
    'missing_key': '所選供應商尚未設定金鑰',
    'unsupported_video': '所選模型不支援直接解析影片，可使用字幕時再生成策略卡',
    'failed': '所選供應商請求失敗或回應格式無效',
    'success': 'AI 分析完成',
}


def _settings_path(root: Path) -> Path:
    return root / 'user-v1' / 'ai-settings.json'


def _read_settings(root: Path) -> dict:
    data = secret_store._read_json(_settings_path(root))
    provider = data.get('provider')
    saved_models = data.get('models') if isinstance(data.get('models'), dict) else {}
    saved_features = data.get('features') if isinstance(data.get('features'), dict) else {}
    return {
        'provider': provider if isinstance(provider, str) and provider in PROVIDERS else 'gemini',
        'models': {name: _valid_model(saved_models.get(name)) or default
                   for name, (_, default) in PROVIDERS.items()},
        'enabled': data.get('enabled') is not False,
        'features': {name: saved_features.get(name) is not False for name in FEATURES},
    }


def _valid_model(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,99}', value) else None


def public_state(root: Path) -> dict:
    with SETTINGS_LOCK:
        cfg = _read_settings(root)
        return {
            **cfg,
            'keys': {name: bool(secret_store.get_ai_key(root, name)) for name in PROVIDERS},
            'labels': {name: label for name, (label, _) in PROVIDERS.items()},
            'storage': secret_store.storage_mode_label(),
            'supportsVideo': cfg['provider'] == 'gemini' and cfg['models']['gemini'] in VIDEO_MODELS,
        }


def update_settings(root: Path, body: dict) -> dict:
    if not isinstance(body, dict):
        raise ValueError('AI 設定格式無效')
    with SETTINGS_LOCK:
        cfg = _read_settings(root)
        provider = body.get('provider', cfg['provider'])
        enabled = body.get('enabled', cfg['enabled'])
        models = body.get('models', {})
        features = body.get('features', {})
        keys = body.get('keys', {})
        if not isinstance(provider, str) or provider not in PROVIDERS or type(enabled) is not bool:
            raise ValueError('AI 供應商或總開關無效')
        if not isinstance(models, dict) or any(name not in PROVIDERS or not _valid_model(model)
                                               for name, model in models.items()):
            raise ValueError('模型代號格式無效')
        if not isinstance(features, dict) or any(name not in FEATURES or type(value) is not bool
                                                 for name, value in features.items()):
            raise ValueError('模組開關無效')
        if not isinstance(keys, dict) or any(name not in PROVIDERS for name in keys):
            raise ValueError('AI 金鑰供應商無效')
        secret_store.update_ai_keys(root, keys)
        saved = {
            'provider': provider, 'enabled': enabled,
            'models': {**cfg['models'], **models},
            'features': {**cfg['features'], **features},
        }
        secret_store._atomic_write_json(_settings_path(root), saved)
        return public_state(root)


@dataclass(frozen=True)
class AiSession:
    root: Path
    feature: str
    provider: str
    model: str
    status: str
    key: str = field(default='', repr=False)

    @property
    def label(self):
        return PROVIDERS[self.provider][0]

    @property
    def video(self):
        return self.provider == 'gemini' and self.model in VIDEO_MODELS

    def metadata(self, status=None):
        status = status or self.status
        return {'provider': self.provider, 'model': self.model, 'label': self.label,
                'status': status, 'message': MESSAGES[status]}

    def send(self, payload, timeout=40):
        # Recheck after local research or a previous model turn before any new send.
        active = session(self.root, self.feature)
        if (self.status != 'ready' or active.status != 'ready' or self.key != active.key
                or (self.provider, self.model) != (active.provider, active.model)):
            raise RuntimeError('AI 設定已變更或關閉')
        url, headers = _endpoint(self.provider, self.model, self.key)
        return _post(url, headers, payload, timeout)

    def generate(self, prompt, *, video_url=None):
        if video_url and (not self.video or not re.fullmatch(
                r'https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{11}', video_url)):
            raise RuntimeError(MESSAGES['unsupported_video'])
        if self.provider == 'gemini':
            parts = [{'text': prompt}]
            if video_url:
                parts.insert(0, {'fileData': {'fileUri': video_url, 'mimeType': 'video/mp4'}})
            body = {'contents': [{'role': 'user', 'parts': parts}],
                    'generationConfig': {'responseMimeType': 'application/json'}}
        elif self.provider == 'claude':
            body = {'model': self.model, 'max_tokens': 3500, 'messages': [{'role': 'user', 'content': prompt}]}
        else:
            body = {'model': self.model, 'messages': [{'role': 'user', 'content': prompt}],
                    'response_format': {'type': 'json_object'}}
        result = self.send(body, 60 if video_url else 40)
        try:
            if self.provider == 'gemini':
                text = ''.join(part.get('text', '') for part in result['candidates'][0]['content']['parts'])
            elif self.provider == 'claude':
                text = ''.join(part.get('text', '') for part in result['content'] if part.get('type') == 'text')
            else:
                text = result['choices'][0]['message']['content']
            value = json.loads(re.sub(r'^\x60\x60\x60(?:json)?\s*|\s*\x60\x60\x60$', '', text.strip()))
            if isinstance(value, dict) and value:
                return value
        except (KeyError, IndexError, TypeError, ValueError, AttributeError):
            pass
        raise RuntimeError('AI 回應不是有效 JSON 物件')


def session(root: Path, feature: str) -> AiSession:
    with SETTINGS_LOCK:
        cfg = _read_settings(root)
        provider = cfg['provider']
        model = cfg['models'][provider]
        if not cfg['enabled']:
            return AiSession(root, feature, provider, model, 'disabled')
        if not cfg['features'][feature]:
            return AiSession(root, feature, provider, model, 'feature_disabled')
        key = secret_store.get_ai_key(root, provider)
        return AiSession(root, feature, provider, model, 'ready' if key else 'missing_key', key)


def text_items(value, limit=5, max_length=300):
    if not isinstance(value, list):
        return []
    return [x.strip()[:max_length] for x in value[:limit] if isinstance(x, str) and x.strip()]


def _endpoint(provider, model, key):
    if provider == 'gemini':
        return f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', {'x-goog-api-key': key}
    if provider == 'claude':
        return 'https://api.anthropic.com/v1/messages', {'x-api-key': key, 'anthropic-version': '2023-06-01'}
    host = 'https://api.deepseek.com' if provider == 'deepseek' else 'https://api.openai.com/v1'
    return host + '/chat/completions', {'Authorization': 'Bearer ' + key}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _post(url, headers, body, timeout):
    req = urllib.request.Request(url, data=json.dumps(body, ensure_ascii=False, allow_nan=False).encode('utf-8'),
                                 headers={'Content-Type': 'application/json', **headers}, method='POST')
    try:
        with urllib.request.build_opener(_NoRedirect()).open(req, timeout=timeout) as res:
            data = res.read(2 * 1024 * 1024 + 1)
            if len(data) > 2 * 1024 * 1024:
                raise RuntimeError('AI 回應超過大小限制')
            return json.loads(data)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'AI API HTTP {error.code}') from None
    except (OSError, ValueError):
        raise RuntimeError('AI 連線或回應無效') from None
