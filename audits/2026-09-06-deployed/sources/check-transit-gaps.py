import osmium, math, json
# Review the longest rejected segments against the independent OSM rail/road network.
gaps=[('Lausanne rail',[46.411781,6.261061],[46.403018,6.253101]),('Valserhone rail',[46.10046,5.863631],[46.108692,5.880691]),('Valserhone rail',[46.106881,5.835419],[46.100456,5.852462]),('Valserhone rail',[46.219894,6.052424],[46.221233,6.065748]),('Annecy bus',[46.071667,6.082356],[46.080282,6.086451])]
class Check(osmium.SimpleHandler):
 def __init__(self):
  super().__init__();self.samples=[]
  for label,a,b in gaps:
   p=[[a[0]+(b[0]-a[0])*i/20,a[1]+(b[1]-a[1])*i/20] for i in range(21)]
   self.samples.append([label,a,b,p,[float('inf')]*21])
 def way(self,w):
  rail='railway' in w.tags;road='highway' in w.tags
  if not (rail or road):return
  p=[(n.lat,n.lon) for n in w.nodes]
  for label,a,b,samples,best in self.samples:
   if ('rail' in label and not rail) or ('bus' in label and not road):continue
   if not any(min(a[0],b[0])-.02<=lat<=max(a[0],b[0])+.02 and min(a[1],b[1])-.02<=lon<=max(a[1],b[1])+.02 for lat,lon in p):continue
   for i,(lat,lon) in enumerate(samples):
    scale=111200*math.cos(math.radians(lat))
    for (x0,y0),(x1,y1) in zip(p,p[1:]):
     ax,ay=(x0-lat)*111200,(y0-lon)*scale;bx,by=(x1-lat)*111200,(y1-lon)*scale
     dx,dy=bx-ax,by-ay;d=dx*dx+dy*dy;t=max(0,min(1,-(ax*dx+ay*dy)/d)) if d else 0
     best[i]=min(best[i],math.hypot(ax+t*dx,ay+t*dy))
c=Check();c.apply_file('/tmp/swiss-commutes-motis/region.osm.pbf',locations=True,idx='flex_mem')
r=[dict(label=l,fromPoint=a,toPoint=b,maxDistanceToOsmMetres=round(max(d),2)) for l,a,b,p,d in c.samples]
print(json.dumps(r,indent=2))
open('/tmp/swiss-transit-gap-review.json','w').write(json.dumps(r,indent=2)+'\n')
