from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from datetime import datetime, timezone
import gzip, hashlib, json, re
root=Path(__file__).resolve().parents[2]; evidence=root/'audits/2026-09-06-deployed'
manifest=json.loads((evidence/'deployment-files.json').read_text())
cities=[r['city'] for r in json.loads((root/'audits/2026-09-06-priorities/audit.json').read_text())['cityRows']]
paths=['index.html']+[city+'/index.html' for city in cities]
expected={r['path']:r['sha256'] for r in manifest}
base='https://www.danielpradilla.info/swiss-commutes/'
checked=datetime.now(timezone.utc).isoformat()
def check(path):
 url=base+path.removesuffix('index.html')+'?audit=20260906-script-order-v2'
 try:
  with urlopen(Request(url,headers={'Accept-Encoding':'gzip','Cache-Control':'no-cache','User-Agent':'Swiss-Commutes-deployment-check'}),timeout=60) as response:
   body=response.read()
   if response.headers.get('Content-Encoding')=='gzip':body=gzip.decompress(body)
   rawDigest=hashlib.sha256(body).hexdigest()
   # Cloudflare's optional analytics beacon is not part of the app build.
   normalized,beacons=re.subn(rb'<script\b(?=[^>]*\bsrc="https://static\.cloudflareinsights\.com/beacon\.min\.js)[^>]*>.*?</script>\n?',b'',body,flags=re.S)
   digest=hashlib.sha256(normalized).hexdigest()
   return dict(path=path,url=url,status=response.status,bytes=len(body),sha256=digest,rawSha256=rawDigest,ignoredAnalyticsBeacons=beacons,expectedSha256=expected[path],matches=digest==expected[path],contentType=response.headers.get('Content-Type'),cacheControl=response.headers.get('Cache-Control'))
 except Exception as exc:return dict(path=path,url=url,matches=False,error=str(exc))
with ThreadPoolExecutor(max_workers=3) as pool:rows=list(pool.map(check,paths))
result=dict(checkedAt=checked,normalization='Remove only the optional Cloudflare analytics beacon; application scripts and content must match byte for byte.',checked=len(rows),passed=sum(r['matches'] for r in rows),pages=rows)
(evidence/'http-verification.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='pages'}))
for r in rows:
 if not r['matches']:print(r)
assert all(r['matches'] for r in rows),'Live HTML does not match the exported build'
