"""Read original public inputs with Python's CSV/XML parsers; emit bounded evidence."""
import csv
import hashlib
import json
from pathlib import Path
import sys
import re
import subprocess
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter, defaultdict

root = Path(sys.argv[1])
codes = set(sys.argv[2].split(','))
result = {'files': [], 'matrix': {}, 'ocstat': {}, 'modeTable': {}}
for filename in ['fso-commune-matrix-original', 'ocstat-commuters.xlsx', 'fso-modes.xml', 'fso-mode-definitions.xml', 'fso-cross-border-totals.json', 'insee-swiss-aggregates.json', 'city-mobility-comparison-2021.pdf', 'geneva-transport-2022.pdf']:
    p = root / filename
    if p.exists():
        result['files'].append({'file': filename, 'bytes': p.stat().st_size,
                                'sha256': hashlib.sha256(p.read_bytes()).hexdigest()})

p = root / 'geneva-transport-2022.pdf'
if p.exists():
    text = subprocess.check_output(['pdftotext', '-layout', str(p), '-'], text=True)
    section = text.split('DÉPLACEMENTS PENDULAIRES DEPUIS LE RESTE DE LA SUISSE', 1)[1].split('On comptait', 1)[0]
    district_rows = re.findall(r'(?:District de Nyon|Autres districts vaudois)\s+([\d\']+)\s+([\d\']+)\s+([\d\']+)\s+([\d\']+)', section)
    assert len(district_rows) == 4 and '2020' in section
    district_rows = [[int(v.replace("'", '')) for v in row] for row in district_rows]
    assert all(sum(row[:3]) == row[3] for row in district_rows)
    result['genevaVaudModes'] = {direction: dict(zip(['transit', 'car', 'unknown', 'total'],
        [sum(row[i] for row in district_rows[offset:offset + 2]) for i in range(4)]))
        for direction, offset in [('inbound', 0), ('outbound', 2)]}

p = root / 'fso-commune-matrix-original'
if p.exists():
    counts = Counter()
    pairs = defaultdict(int)
    years = Counter()
    duplicates = 0
    geneva = defaultdict(int)
    seen = set()
    with p.open(encoding='utf-8-sig', newline='') as f:
        for row in csv.DictReader(f):
            years[row['REF_YEAR']] += 1
            if row['REF_YEAR'] != '2020':
                continue
            # Unknown commune code 7777 is reused by different cantons; those are distinct source rows.
            key = tuple(row[field] for field in ['PERSPECTIVE', 'GEO_CANT_RESID', 'GEO_COMM_RESID', 'GEO_CANT_WORK', 'GEO_COMM_WORK'])
            duplicates += key in seen
            seen.add(key)
            value = int(row['VALUE'])
            # Reconcile the 2020 matrix to Neuchâtel's 2021 merger before comparing city pairs.
            for field in ['GEO_COMM_RESID', 'GEO_COMM_WORK']:
                if row[field] in ['6407', '6412', '6485']:
                    row[field] = '6458'
            key = (row['PERSPECTIVE'], row['GEO_COMM_RESID'], row['GEO_COMM_WORK'])
            if row['PERSPECTIVE'] == 'W' and row['GEO_CANT_WORK'] == '25' and row['GEO_CANT_RESID'] != '25':
                geneva['inbound:'+row['GEO_COMM_RESID']] += value
            if row['PERSPECTIVE'] == 'R' and row['GEO_CANT_RESID'] == '25' and row['GEO_CANT_WORK'] == '22':
                geneva['outbound:'+row['GEO_COMM_RESID']] += value
            if row['GEO_COMM_RESID'] in codes or row['GEO_COMM_WORK'] in codes:
                pairs[':'.join(key)] += value
            counts[row['PERSPECTIVE']] += value
    result['matrix'] = {'rowsByYear': dict(years), 'duplicateKeys2020': duplicates,
                        'totalsByPerspective2020': dict(counts), 'pairs': dict(pairs), 'genevaCantonalPairs': dict(geneva)}

p = root / 'ocstat-commuters.xlsx'
if p.exists():
    ns = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
    with zipfile.ZipFile(p) as z:
        strings = [''.join(x.itertext()) for x in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', ns)]
        cells = {}
        for c in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:c', ns):
            v = c.find('m:v', ns)
            if v is not None:
                cells[c.get('r')] = strings[int(v.text)] if c.get('t') == 's' else v.text
        assert '2024' in cells['A4'], 'OCSTAT sheet changed; inspect workbook before comparing'
        result['ocstat'] = {'sheet': '2024', 'cells': cells}

p = root / 'fso-modes.xml'
if p.exists():
    ns = {'g': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic'}
    for o in ET.parse(p).findall('.//g:Obs', ns):
        key = {v.get('id'): v.get('value') for v in o.findall('g:ObsKey/g:Value', ns)}
        code = key['SSV_SWISS_CITY']
        if code in codes:
            result['modeTable'].setdefault(code, {})[key['STATISTICAL_OPERATION']+':'+key['SSV_MOB_COM']] = float(o.find('g:ObsValue', ns).get('value'))

p = root / 'fso-mode-definitions.xml'
if p.exists():
    ns = {'s': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/structure', 'c': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/common'}
    tree = ET.parse(p)
    concept = tree.find('.//s:Concept[@id="SSV_MOB_COM"]', ns)
    result['modeDefinition'] = {v.get('{http://www.w3.org/XML/1998/namespace}lang'): v.text for v in concept.findall('c:Name', ns)}

p = root / 'fso-cross-border-totals.json'
if p.exists():
    d = json.loads(p.read_text())
    result['borderWorkers'] = {code: d['value'][i] for code, i in d['dimension']['Arbeitsgemeinde']['category']['index'].items()}

print(json.dumps(result, ensure_ascii=False))
