"""Validate licensed shards and prepare a two-phase public data repository update."""

import argparse
import copy
import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop' / 'scripts'))
from providers import data_repository as schema


def file_json(path):
    return json.loads(path.read_bytes())


def canonical(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + '\n').encode()


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    stage = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.publish-', delete=False) as stream:
            stage = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(stage, path)
    finally:
        if stage is not None:
            stage.unlink(missing_ok=True)


def write_immutable(path, data):
    if path.exists():
        schema.require(path.read_bytes() == data, f'既有不可變資產不符 {path.name}')
    else:
        write_atomic(path, data)


def make_empty_month(month):
    return {'kind': 'month', 'schema_version': 1, 'month': month, 'datasets': {key: [] for key in schema.DATASETS}}


def write_month(annual, value):
    month = value['month']
    schema.validate_month(value, month)
    raw = canonical(value)
    digest = schema.sha256(raw)
    path = f'indexes/{month}/{digest}.json'
    write_immutable(annual / path, raw)
    return {'path': path, 'bytes': len(raw), 'sha256': digest}


def init(catalog, annual, year):
    schema.require(1 <= int(year) < 9999 and len(year) == 4, '年度須為四位數字')
    catalog_path, year_path = catalog / 'catalog.json', annual / 'manifest.json'
    schema.require(not year_path.exists(), '年度 manifest 已存在')
    current = file_json(catalog_path) if catalog_path.exists() else {'kind': 'catalog', 'schema_version': 1, 'years': {}}
    years = schema.validate_catalog(current)
    schema.require(year not in years, '全域 catalog 已列此年度')
    months = {month: write_month(annual, make_empty_month(month))
              for month in [f'{year}-{number:02d}' for number in range(1, 13)]}
    write_atomic(year_path, canonical({
        'kind': 'year', 'schema_version': 1, 'datasets': list(schema.DATASETS), 'year': year, 'months': months,
    }))
    years[year] = {'repository': f'{schema.CATALOG_REPOSITORY}-{year}', 'manifest': 'manifest.json'}
    write_atomic(catalog_path, canonical(current))


def approved_source(entry, approvals):
    source = entry['source']
    expected = {'dataset': entry['dataset'], 'url': source['url'], 'license_url': source['license_url'],
                'license': source['license']}
    official_tdcc = {'dataset': 'tdcc', 'url': schema.TDCC_URL, 'license_url': schema.TDCC_LICENSE_URL,
                     'license': '政府資料開放授權條款第1版'}
    if expected == official_tdcc:
        return
    if approvals and expected in file_json(approvals):
        return
    raise ValueError('來源與授權須由管理者逐項確認後列入授權清單')


def verify_payload(raw, entry, feed_base):
    decoded = schema.decode_shard(raw, entry)
    rows = schema.payload_rows(decoded, entry)
    if entry['dataset'] == 'tdcc':
        schema.require(feed_base is not None, '集保發布須指定可追溯的 feed-base.json')
        schema.require(entry['market'] == 'TW' and entry['instrument_id'] is None
                       and entry['statistic_date'] == entry['date_from'] == entry['date_to']
                       and entry['asset']['format'] == 'csv'
                       and entry['source']['url'] == schema.TDCC_URL
                       and all(schema.TDCC_FIELDS.issubset(row) for row in rows), '集保分片須為全市場單週官方原始 CSV')
        from serve_local import parse_week
        base = file_json(feed_base)
        week = parse_week(decoded, base['universe'], entry['retrieved_at'])
        schema.require(week['day'] == entry['statistic_date'] and week['day'] in base['sessions'],
                       '集保統計日與官方交易日曆不符')
        schema.require(not any(week['day'] < day <= week_end(week['day']) for day in base['sessions']),
                       '集保統計日不是當週最後交易日')
        invalid = week['quality']['invalid']
        schema.require(entry['coverage']['complete'] == (invalid == 0)
                       and (invalid == 0 or bool(entry['coverage']['missing'])), '集保母體覆蓋說明與驗證結果不符')


def week_end(day):
    from datetime import timedelta
    value = schema.day_key(day)
    return (value + timedelta(days=4 - value.weekday())).isoformat()


def prepare(annual, metadata, file, candidate, approvals, feed_base):
    year_path = annual / 'manifest.json'
    original = year_path.read_bytes()
    manifest = json.loads(original)
    year = manifest['year']
    months = schema.validate_year(manifest, year)
    entry = file_json(metadata)
    month = schema.day_key(entry.get('date_from')).strftime('%Y-%m')
    schema.require(month in months, '分片日期不屬於年度資料夾')
    dataset = entry.get('dataset')
    schema.require(dataset in schema.DATASETS, '資料集無效')
    asset = entry.get('asset')
    schema.require(isinstance(asset, dict), '缺少資產格式')
    raw = file.read_bytes()
    digest = schema.sha256(raw)
    suffix = f".{asset.get('format')}" + ('.gz' if asset.get('compression') == 'gzip' else '')
    asset.update(path=f'shards/{month}/{dataset}/{digest}{suffix}', bytes=len(raw), sha256=digest)
    current_index = months[month]
    month_doc = json.loads(schema.verify_bytes((annual / current_index['path']).read_bytes(), current_index))
    entries = schema.validate_month(month_doc, month)[dataset]
    peer = [row for row in entries if schema.entry_identity(row) == schema.entry_identity(entry)]
    schema.require(not any(row['asset']['sha256'] == digest for row in peer), '相同分片內容已存在')
    next_revision = max((row['revision'] for row in peer), default=0) + 1
    schema.require(entry.get('revision', next_revision) == next_revision, f'新分片修訂須為 {next_revision}')
    entry['revision'] = next_revision
    schema.validate_entry(entry, month, dataset)
    approved_source(entry, approvals)
    verify_payload(raw, entry, feed_base)
    write_immutable(annual / asset['path'], raw)
    entries.append(entry)
    index = write_month(annual, month_doc)
    months[month] = index
    write_atomic(candidate, canonical({
        'kind': 'publication', 'schema_version': 1, 'before': schema.sha256(original),
        'after': manifest, 'index': index, 'asset': asset, 'entry': entry,
    }))
    print(f'Validated {entry["row_count"]} rows, {entry["date_from"]}, revision {next_revision}')
    print(asset['path'])
    print(index['path'])


def activate(annual, candidate, approvals, feed_base):
    """Check anonymously downloaded content before moving the annual manifest."""
    year_path = annual / 'manifest.json'
    original = year_path.read_bytes()
    plan = schema.object_document(file_json(candidate), 'publication')
    schema.require(schema.sha256(original) == plan['before'], '年度 manifest 已異動，請重新準備')
    before, after = json.loads(original), plan['after']
    entry = plan['entry']
    asset, index = plan['asset'], plan['index']
    year = before['year']
    month = schema.day_key(entry['date_from']).strftime('%Y-%m')
    expected = copy.deepcopy(before)
    expected['months'][month] = index
    schema.require(after == expected and entry['asset'] == asset, '候選只可切換單一已驗證的月份索引')
    schema.validate_year(after, year)
    schema.validate_entry(entry, month, entry['dataset'])
    approved_source(entry, approvals)

    reader = schema.SharedDataClient(timeout=6, cancel=threading.Event())
    repository = f'{schema.CATALOG_REPOSITORY}-{year}'
    for descriptor in (index, asset):
        local = schema.verify_bytes((annual / descriptor['path']).read_bytes(), descriptor)
        remote = reader.download_asset(schema.data_url(repository, descriptor['path']), descriptor['bytes'], time.monotonic() + 15)
        schema.verify_bytes(remote, descriptor)
        schema.require(local == remote, '已上傳資產與準備檔不符')
    index_content = file_json(annual / index['path'])
    existing = file_json(annual / before['months'][month]['path'])
    existing['datasets'][entry['dataset']].append(entry)
    schema.require(index_content == existing, '新索引僅可附加已驗證分片')
    schema.validate_month(index_content, month)
    verify_payload((annual / asset['path']).read_bytes(), entry, feed_base)
    schema.require(year_path.read_bytes() == original, '年度 manifest 已異動，請重新準備')
    write_atomic(year_path, canonical(after))
    print(f'Activated month {month} locally after anonymous asset verification')


def verify(catalog, annual):
    years = schema.validate_catalog(file_json(catalog / 'catalog.json'))
    manifest = file_json(annual / 'manifest.json')
    year = manifest['year']
    schema.require(year in years, '年度 catalog 無本年度')
    for month, index in schema.validate_year(manifest, year).items():
        doc = json.loads(schema.verify_bytes((annual / index['path']).read_bytes(), index))
        for entries in schema.validate_month(doc, month).values():
            for entry in entries:
                raw = schema.decode_shard((annual / entry['asset']['path']).read_bytes(), entry)
                schema.payload_rows(raw, entry)
    print(f'Catalog and year {year}: indexes and advertised shards verified')


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    modes = cli.add_subparsers(dest='mode', required=True)
    for name in ('init', 'prepare', 'activate', 'verify'):
        parser = modes.add_parser(name)
        parser.add_argument('--annual', type=Path, required=True)
        if name in ('init', 'verify'):
            parser.add_argument('--catalog', type=Path, required=True)
        if name == 'init':
            parser.add_argument('--year', required=True)
        if name in ('prepare', 'activate'):
            parser.add_argument('--candidate', type=Path, required=True)
            parser.add_argument('--approvals', type=Path)
            parser.add_argument('--feed-base', type=Path)
        if name == 'prepare':
            parser.add_argument('--metadata', type=Path, required=True)
            parser.add_argument('--file', type=Path, required=True)
    args = vars(cli.parse_args())
    method = {'init': init, 'prepare': prepare, 'activate': activate, 'verify': verify}[args.pop('mode')]
    try:
        method(**args)
    except (KeyError, TypeError, ValueError, OSError, UnicodeError) as exc:
        cli.exit(2, f'{exc}\n')


if __name__ == '__main__':
    main()
