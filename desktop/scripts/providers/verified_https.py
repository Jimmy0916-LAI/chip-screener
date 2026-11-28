"""Outbound HTTPS using the platform's trusted certificate chain."""
import ssl
import sys
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import HTTPSHandler, HTTPRedirectHandler, build_opener, getproxies


class CertificateError(ValueError):
    """Safe, user-facing details for a failed certificate check."""


def context():
    if sys.platform == 'win32':
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return ssl.create_default_context()


class VerifiedHTTPS(HTTPSHandler):
    def __init__(self):
        super().__init__(context=context())

    def https_open(self, request):
        try:
            return super().https_open(request)
        except (URLError, ssl.SSLError) as exc:
            cause = exc.reason if isinstance(exc, URLError) else exc
            if not isinstance(cause, ssl.SSLCertVerificationError):
                raise
            host = urlsplit(request.full_url).hostname or '未知主機'
            proxy = '已偵測 HTTPS 代理設定' if getproxies().get('https') else '未偵測固定 HTTPS 代理'
            code = getattr(cause, 'verify_code', None)
            code_text = f'，驗證代碼 {code}' if isinstance(code, int) else ''
            raise CertificateError(
                f'無法驗證 {host} 的 HTTPS 憑證。請確認 Windows 日期與時間，'
                '並請網路管理員確認代理及受信任的根和中繼憑證。'
                f'（{proxy}{code_text}）'
            ) from exc


class HTTPSRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urlsplit(newurl).scheme != 'https':
            raise ValueError('資料來源轉向非 HTTPS 網址，已停止連線。')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(request, *, timeout):
    return build_opener(VerifiedHTTPS(), HTTPSRedirect()).open(request, timeout=timeout)
