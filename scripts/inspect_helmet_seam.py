"""Measure where the Knight's head surface sits relative to the helmet shell.

  bash scripts/blender.sh -b --python scripts/inspect_helmet_seam.py -- <glb>

Reports, for the head mesh against the helmet mesh: nearest-surface distance distribution, how many
head vertices sit within 3 mm of the helmet, and on which side of the helmet surface they fall
(negative = inside the helmet shell, positive = protruding through it).
"""
import bpy, json, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src = argv[0]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

def world_verts(obj):
    mw = obj.matrix_world
    return [mw @ v.co for v in obj.data.vertices]

def world_tris(obj):
    mw = obj.matrix_world
    verts = [mw @ v.co for v in obj.data.vertices]
    polys = [tuple(p.vertices) for p in obj.data.polygons]
    return verts, polys

head = next((o for o in bpy.data.objects if o.type == "MESH" and "Head" in o.name and "Helmet" not in o.name), None)
helmet = next((o for o in bpy.data.objects if o.type == "MESH" and "Helmet" in o.name), None)
if not head or not helmet:
    print("SEAM:" + json.dumps({"error": "head or helmet mesh missing", "meshes": [o.name for o in bpy.data.objects if o.type == 'MESH']}))
    raise SystemExit(0)

hv, hp = world_tris(helmet)
bvh = BVHTree.FromPolygons(hv, hp, all_triangles=False)

def bbox(points):
    lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    return {"min": [round(v, 3) for v in lo], "max": [round(v, 3) for v in hi],
            "size": [round(hi[i] - lo[i], 3) for i in range(3)]}

head_pts = world_verts(head)
rows = []
for p in head_pts:
    hit = bvh.find_nearest(p)
    if not hit or hit[0] is None:
        rows.append((p, None, None))
        continue
    co, normal, index, dist = hit
    signed = (p - co).dot(normal)
    rows.append((p, dist, signed))

finite = [(p, d, s) for p, d, s in rows if d is not None]
finite.sort(key=lambda r: r[1])
near = [r for r in finite if r[1] <= 0.003]
protruding = [r for r in near if r[2] > 0]
inside = [r for r in near if r[2] <= 0]
dists = [r[1] for r in finite]

def pct(values, q):
    if not values: return None
    i = min(len(values) - 1, max(0, int(round(q * (len(values) - 1)))))
    return round(values[i], 4)

report = {
    "head": {"name": head.name, "verts": len(head_pts), "bbox": bbox(head_pts),
             "uvLayers": [u.name for u in head.data.uv_layers],
             "materials": [m.name for m in head.data.materials if m]},
    "helmet": {"name": helmet.name, "verts": len(hv), "bbox": bbox(hv),
               "uvLayers": [u.name for u in helmet.data.uv_layers],
               "materials": [m.name for m in helmet.data.materials if m]},
    "distance": {"min": pct(dists, 0.0), "p05": pct(dists, 0.05), "median": pct(dists, 0.5),
                 "max": pct(dists, 1.0)},
    "near3mm": {"total": len(near), "protruding": len(protruding), "inside": len(inside)},
    "closest": [{"p": [round(c, 3) for c in p], "d": round(d, 4), "signed": round(s, 4)}
                for p, d, s in finite[:8]],
    "protrudingRegion": bbox([r[0] for r in protruding]) if protruding else None,
    "insideRegion": bbox([r[0] for r in inside]) if inside else None,
    "penetrationMax": round(max((r[2] for r in protruding), default=0), 4),
}
print("SEAM:" + json.dumps(report))
