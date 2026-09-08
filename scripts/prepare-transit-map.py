"""Clip and merge Swiss/French OSM roads and rails for the offline Geneva router.

Run with a Python environment containing pyosmium; this is an import dependency,
not an application dependency. Usage: script.py OUTPUT.pbf INPUT.pbf INPUT.pbf
"""
from pathlib import Path
import sys
import tempfile
import osmium


class Region(osmium.SimpleHandler):
    def __init__(self, writer):
        super().__init__()
        self.writer = writer
        self.nodes = set()
        self.ways = set()

    def node(self, node):
        if 5.0 <= node.location.lon <= 7.2 and 45.4 <= node.location.lat <= 47.1:
            self.nodes.add(node.id)
            if len(node.tags):
                self.writer.add_node(node)

    def way(self, way):
        if ('highway' in way.tags or 'railway' in way.tags or way.tags.get('route') == 'ferry') and any(n.ref in self.nodes for n in way.nodes):
            self.ways.add(way.id)
            self.writer.add_way(way)

    def relation(self, relation):
        if relation.tags.get('type') == 'restriction' and any(m.type == 'w' and m.ref in self.ways for m in relation.members):
            self.writer.add_relation(relation)


if __name__ == '__main__':
    if len(sys.argv) < 4:
        raise SystemExit('Usage: prepare-transit-map.py OUTPUT.pbf SWISS.pbf FRENCH.pbf')
    with tempfile.TemporaryDirectory(prefix='swiss-transit-map-') as temp:
        paths = []
        for index, source in enumerate(sys.argv[2:]):
            target = Path(temp) / f'{index}.osm.pbf'
            with osmium.BackReferenceWriter(target, source, remove_tags=False) as writer:
                selected = Region(writer)
                selected.apply_file(source)
                assert selected.nodes and selected.ways, 'Input does not cover the selected region'
                print(f'{Path(source).name}: {len(selected.ways)} ways', flush=True)
                del selected
            paths.append(target)
        merged = osmium.MergeInputReader()
        for path in paths:
            merged.add_file(str(path))
        with osmium.SimpleWriter(sys.argv[1]) as writer:
            merged.apply(writer)
        assert Path(sys.argv[1]).stat().st_size > 0
