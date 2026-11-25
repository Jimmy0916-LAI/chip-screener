"""抓取並驗證最新 S&P 500 成分股名單（含 GICS 產業分類），寫入 data/sp500_universe.json。"""

import csv
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT_FILE = ROOT / 'data' / 'sp500_universe.json'

GICS_ZH = {
    'Information Technology': '資訊科技',
    'Communication Services': '通訊服務',
    'Consumer Discretionary': '非必需消費',
    'Consumer Staples': '必需消費',
    'Financials': '金融',
    'Health Care': '醫療保健',
    'Industrials': '工業',
    'Energy': '能源',
    'Materials': '原物料',
    'Real Estate': '不動產',
    'Utilities': '公用事業',
}

ZH_NAME_OVERRIDES = {
    'AAPL': 'Apple 蘋果', 'MSFT': 'Microsoft 微軟', 'NVDA': 'NVIDIA 輝達',
    'GOOGL': 'Alphabet 谷歌 A', 'GOOG': 'Alphabet 谷歌 C', 'AMZN': 'Amazon 亞馬遜',
    'META': 'Meta 臉書', 'TSLA': 'Tesla 特斯拉', 'AVGO': 'Broadcom 博通',
    'AMD': 'AMD 超微', 'INTC': 'Intel 英特爾', 'MU': 'Micron 美光',
    'QCOM': 'Qualcomm 高通', 'ORCL': 'Oracle 甲骨文', 'PLTR': 'Palantir',
    'SMCI': 'Super Micro 美超微', 'BRK-B': '波克夏海瑟威 B', 'JPM': 'JPMorgan 摩根大通',
    'V': 'Visa 威士卡', 'MA': 'Mastercard 萬事達卡', 'COST': 'Costco 好市多',
    'NFLX': 'Netflix 網飛', 'LLY': 'Eli Lilly 禮來', 'UNH': 'UnitedHealth 聯合健康',
    'XOM': 'ExxonMobil 埃克森美孚', 'WMT': 'Walmart 沃爾瑪', 'PG': 'P&G 寶僑',
    'JNJ': 'Johnson & Johnson 嬌生', 'HD': 'Home Depot 家得寶', 'BAC': 'Bank of America 美銀',
    'CRM': 'Salesforce', 'ADBE': 'Adobe', 'CSCO': 'Cisco 思科', 'TXN': 'Texas Instruments 德儀',
    'AMAT': 'Applied Materials 應材', 'LRCX': 'Lam Research 科林研發', 'KLAC': 'KLA 科磊',
    'NOW': 'ServiceNow', 'PANW': 'Palo Alto Networks', 'CRWD': 'CrowdStrike',
    'KO': 'Coca-Cola 可口可樂', 'PEP': 'PepsiCo 百事', 'DIS': 'Disney 迪士尼',
    'MCD': "McDonald's 麥當勞", 'NKE': 'Nike 耐吉', 'SBUX': 'Starbucks 星巴克',
    'BA': 'Boeing 波音', 'CAT': 'Caterpillar 卡特彼勒', 'GE': 'GE Aerospace 奇異航太',
    'GS': 'Goldman Sachs 高盛', 'MS': 'Morgan Stanley 摩根士丹利', 'BLK': 'BlackRock 貝萊德',
    'CVX': 'Chevron 雪佛龍', 'ABBV': 'AbbVie 艾伯維', 'MRK': 'Merck 默沙東', 'PFE': 'Pfizer 輝瑞',
}


def fetch_csv_constituents() -> list[dict]:
    urls = [
        'https://raw.githubusercontent.com/datasets/s-and-p-500-companies/main/data/constituents.csv',
        'https://datahub.io/core/s-and-p-500-companies/r/constituents.csv',
    ]
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 ChipScreener/0.6'})
            raw = urllib.request.urlopen(req, timeout=15).read().decode('utf-8-sig')
            rows = list(csv.DictReader(io.StringIO(raw)))
            if len(rows) >= 480:
                items = []
                seen = set()
                for r in rows:
                    sym = (r.get('Symbol') or '').strip().upper().replace('.', '-')
                    if not sym or sym in seen:
                        continue
                    seen.add(sym)
                    raw_name = (r.get('Security') or sym).strip()
                    raw_sec = (r.get('GICS Sector') or 'Other').strip()
                    items.append({
                        'code': sym,
                        'name': ZH_NAME_OVERRIDES.get(sym, raw_name),
                        'enName': raw_name,
                        'sector': GICS_ZH.get(raw_sec, raw_sec),
                        'enSector': raw_sec,
                    })
                return items
        except Exception as exc:
            print(f'Source failed ({url}): {exc}')
    raise RuntimeError('Unable to fetch S&P 500 constituents from public sources')


def main() -> None:
    items = fetch_csv_constituents()
    # 額外補上台灣投資人最關注但非 S&P 500 的代表性 ADR / 指標 ETF，標記為選配分類
    extras = [
        ('TSM', 'TSMC 台積電 ADR', 'Taiwan Semiconductor Manufacturing', '半導體 ADR / ETF'),
        ('ASML', 'ASML 艾司摩爾', 'ASML Holding', '半導體 ADR / ETF'),
        ('ARM', 'Arm 安謀', 'Arm Holdings', '半導體 ADR / ETF'),
        ('SPY', 'SPDR S&P 500 ETF', 'SPDR S&P 500 ETF Trust', '半導體 ADR / ETF'),
        ('QQQ', 'Invesco Nasdaq 100', 'Invesco QQQ Trust', '半導體 ADR / ETF'),
        ('SOXX', 'iShares 半導體 ETF', 'iShares Semiconductor ETF', '半導體 ADR / ETF'),
        ('VOO', 'Vanguard S&P 500', 'Vanguard S&P 500 ETF', '半導體 ADR / ETF'),
        ('TLT', '20年期美債 ETF', 'iShares 20+ Year Treasury Bond ETF', '半導體 ADR / ETF'),
        ('GLD', 'SPDR 黃金 ETF', 'SPDR Gold Shares', '半導體 ADR / ETF'),
    ]
    existing = {x['code'] for x in items}
    for code, nm, en_nm, sec in extras:
        if code not in existing:
            items.append({'code': code, 'name': nm, 'enName': en_nm, 'sector': sec, 'enSector': 'ADR/ETF', 'isExtra': True})

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps({'count': len(items), 'sp500Count': sum(1 for x in items if not x.get('isExtra')), 'items': items}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Saved {OUT_FILE}: sp500={sum(1 for x in items if not x.get("isExtra"))}, total={len(items)}')


if __name__ == '__main__':
    main()
