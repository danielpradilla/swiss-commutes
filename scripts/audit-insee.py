"""Stream the official archive; save only aggregate Swiss-workplace counts, no microdata."""
import csv
import hashlib
import io
import json
from pathlib import Path
import sys
import zipfile
from collections import defaultdict

archive, output = map(Path, sys.argv[1:3])
with zipfile.ZipFile(archive) as z:
    labels = {}
    for r in csv.DictReader(io.TextIOWrapper(z.open('varmod_mobpro_2023.csv'), encoding='utf-8-sig'), delimiter=';'):
        if r['COD_VAR'] == 'DCFLT' and r['COD_MOD'].startswith('SU'):
            labels[r['COD_MOD']] = r['LIB_MOD']
    counts = defaultdict(float)
    destinations = defaultdict(float)
    rows, swiss = 0, 0
    with z.open('FD_MOBPRO_2023.csv') as f:
        for r in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig'), delimiter=';'):
            rows += 1
            if not r['DCFLT'].startswith('SU') and r['DCLT'] != '99140':
                continue
            swiss += 1
            weight = float(r['IPONDI'].replace(',', '.'))
            counts[(r['COMMUNE'], r['TRANS'], r['DCFLT'])] += weight
            destinations[r['DCFLT']] += weight
data = {
    'source': 'https://www.insee.fr/fr/statistiques/fichier/9004795/RP2023_mobpro.zip',
    'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'bytes': archive.stat().st_size,
    'rowsRead': rows, 'swissRecords': swiss,
    'filter': 'DCFLT starts SU or DCLT=99140; all French origins; sum IPONDI; retain each TRANS category',
    'destinations': [{'code': k, 'name': labels.get(k, 'Unspecified'), 'people': v} for k, v in sorted(destinations.items())],
    'rows': [{'origin': 'FR'+o, 'trans': m, 'destination': d, 'people': n} for (o, m, d), n in sorted(counts.items())],
}
output.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({k: data[k] for k in ['rowsRead','swissRecords','sha256']}))
