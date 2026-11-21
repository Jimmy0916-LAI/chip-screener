from pathlib import Path
root=Path(__file__).resolve().parent
html=(root/'app.template.html').read_text(encoding='utf-8')
html=html.replace('__DATA_JSON__',(root/'web_data.json').read_text(encoding='utf-8'))
html=html.replace('__APP_JS__',(root/'app.js').read_text(encoding='utf-8'))
assert '__DATA_JSON__' not in html and '__APP_JS__' not in html
(root/'開啟籌碼雷達.html').write_bytes(html.encode('utf-8'))
print('Final HTML size',len(html.encode('utf-8')))
