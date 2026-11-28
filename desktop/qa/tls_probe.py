"""Report TLS reachability without exposing proxy addresses or credentials."""
import argparse
import json
from pathlib import Path
import ssl
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, getproxies, urlopen


def probe(url, open_request):
    req = Request(url, headers={'User-Agent': 'ChipScreener TLS validation', 'Range': 'bytes=0-1023'})
    host = urlsplit(url).hostname
    try:
        with open_request(req, timeout=15) as response:
            response.read(1024)
            return {'host': host, 'tls': 'verified', 'http': response.status,
                    'finalHost': urlsplit(response.geturl()).hostname}
    except HTTPError as error:
        return {'host': host, 'tls': 'verified', 'http': error.code}
    except (OSError, ValueError) as error:
        reason = error.reason if isinstance(error, URLError) else error
        result = {'host': host, 'tls': 'failed', 'errorType': type(reason).__name__}
        if isinstance(reason, ssl.SSLCertVerificationError):
            result['verifyCode'] = reason.verify_code
            result['verifyMessage'] = reason.verify_message
        elif isinstance(reason, ValueError):
            result['message'] = str(reason)
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('scripts', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--native', action='store_true')
    parser.add_argument('--local', nargs=2, metavar=('URL', 'EXPECTED'))
    args = parser.parse_args()
    sys.path.insert(0, str(args.scripts.resolve()))
    opener = urlopen
    if args.native:
        from providers.verified_https import open_url
        opener = open_url
    repo = 'Jimmy0916-LAI/chip-screener'
    endpoints = [
        f'https://api.github.com/repos/{repo}/contents/README.md?ref=main',
        f'https://github.com/{repo}/releases/download/v0.6.5-rc.5/ChipScreener-v0.6.5-rc.5-Windows-x64.zip',
        'https://opendata.tdcc.com.tw/getOD.ashx?id=1-5',
        'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',
        'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_quotes',
        'https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockPrice&data_id=2330&start_date=2026-11-27',
        'https://raw.githubusercontent.com/Jimmy0916-LAI/chip-screener-data/main/catalog.json',
    ]
    if args.local:
        endpoints = [args.local[0]]
    result = {'python': sys.version.split()[0], 'openSSL': ssl.OPENSSL_VERSION, 'windows': sys.platform == 'win32',
              'windowsRootEntries': len(ssl.enum_certificates('ROOT')) if sys.platform == 'win32' else None,
              'httpsProxyConfigured': bool(getproxies().get('https')), 'windowsNativeTrust': args.native,
              'endpoints': [probe(url, opener) for url in endpoints]}
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if args.local and result['endpoints'][0]['tls'] != args.local[1]:
        sys.exit(1)
