"""Copy the FSO 2023 resident-mode counts; preserve the original XML for definitions and uncertainty."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
source = root / 'audits/2026-09-06/sources/fso-modes.xml'
ns = {'g': 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/generic'}
profiles = {}
for obs in ET.parse(source).findall('.//g:Obs', ns):
    key = {v.get('id'): v.get('value') for v in obs.findall('g:ObsKey/g:Value', ns)}
    value = obs.find('g:ObsValue', ns)
    if key['STATISTICAL_OPERATION'] != 'OBS' or value is None or key['SSV_MOB_COM'] not in ['pen_t', 'pen_tim', 'pen_tp']:
        continue
    code = 'size-' + key['SSV_CLASS_CITY'] if key['SSV_SWISS_CITY'] == '_ST' else key['SSV_SWISS_CITY']
    profiles.setdefault(code, {})[key['SSV_MOB_COM']] = float(value.get('value'))
profiles = {k: v for k, v in sorted(profiles.items()) if len(v) == 3 and v['pen_t'] > 0}
assert 'size-1' in profiles and len(profiles) > 170
assert all(0 <= v['pen_tim'] + v['pen_tp'] <= v['pen_t'] for v in profiles.values())
(root / 'app/data/resident-mode-shares.json').write_text(json.dumps(profiles, ensure_ascii=False, indent=2) + '\n')
print(f'{len(profiles)} resident profiles copied from {source.name}')
