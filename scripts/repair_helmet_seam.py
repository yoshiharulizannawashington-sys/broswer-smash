"""Clear the Knight's face/visor seam by moving head vertices that protrude through the helmet rim.

  bash scripts/blender.sh -b --python scripts/repair_helmet_seam.py -- <in.glb> <out.glb> [clearance]

The head mesh stores duplicate vertices at UV seams, so moving one copy of a seam vertex is undone when
the exporter welds duplicates. Coincident vertices are therefore grouped and moved together, inward along
the helmet's own normal by their penetration plus a clearance, with two rings of falloff. Passes repeat
until nothing protrudes. UVs, vertex groups, materials, bones and clips are untouched.
"""
import bpy, json, sys
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
src, out = argv[0], argv[1]
clearance = float(argv[2]) if len(argv) > 2 else 0.0018
NEAR = 0.004
MAX_PASSES = 10
WELD = 1e-5

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

head = next((o for o in bpy.data.objects if o.type == "MESH" and "Head" in o.name and "Helmet" not in o.name), None)
helmet = next((o for o in bpy.data.objects if o.type == "MESH" and "Helmet" in o.name), None)
if not head or not helmet:
    print("SEAMFIX:" + json.dumps({"error": "head or helmet missing"}))
    raise SystemExit(0)

mw_helmet = helmet.matrix_world
bvh = BVHTree.FromPolygons([mw_helmet @ v.co for v in helmet.data.vertices],
                           [tuple(p.vertices) for p in helmet.data.polygons], all_triangles=False)

head_mw = head.matrix_world
head_inv = head_mw.inverted()

def measure():
    protruding, worst, dists = 0, 0.0, []
    for v in head.data.vertices:
        p = head_mw @ v.co
        hit = bvh.find_nearest(p)
        if not hit or hit[0] is None:
            continue
        co, normal, index, dist = hit
        signed = (p - co).dot(normal)
        dists.append(dist)
        if dist <= NEAR:
            if signed > 0:
                protruding += 1
                worst = max(worst, signed)
    dists.sort()
    return {"protruding": protruding, "worstPenetration": round(worst, 4),
            "minDistance": round(dists[0], 4) if dists else None}

# Group coincident vertices so a seam duplicate moves with its twin.
groups = {}
for v in head.data.vertices:
    key = (round(v.co.x / WELD), round(v.co.y / WELD), round(v.co.z / WELD))
    groups.setdefault(key, []).append(v.index)

adjacency = {}
for edge in head.data.edges:
    a, b = edge.vertices
    adjacency.setdefault(a, set()).add(b)
    adjacency.setdefault(b, set()).add(a)

def displace_pass():
    targets = []
    for v in head.data.vertices:
        p = head_mw @ v.co
        hit = bvh.find_nearest(p)
        if not hit or hit[0] is None:
            continue
        co, normal, index, dist = hit
        signed = (p - co).dot(normal)
        if dist <= NEAR and signed > 0:
            targets.append((v.index, -normal.normalized(), signed + clearance))
    if not targets:
        return 0, 0.0
    strongest = {}
    for index, direction, amount in targets:
        if index not in strongest or amount > strongest[index][1]:
            strongest[index] = (direction, amount)
    influence = {}
    for index, (direction, amount) in strongest.items():
        influence.setdefault(index, (direction, amount, 1.0))
        for neighbour in adjacency.get(index, ()):
            influence.setdefault(neighbour, (direction, amount, 0.5))
        for neighbour in adjacency.get(index, ()):
            for second in adjacency.get(neighbour, ()):
                influence.setdefault(second, (direction, amount, 0.22))
    # Propagate the influence onto every coincident twin before moving.
    per_vertex = dict(influence)
    for index in list(influence):
        key = (round(head.data.vertices[index].co.x / WELD),
               round(head.data.vertices[index].co.y / WELD),
               round(head.data.vertices[index].co.z / WELD))
        for twin in groups.get(key, ()):
            if twin not in per_vertex:
                per_vertex[twin] = influence[index]
            else:
                direction, amount, weight = per_vertex[twin]
                src_direction, src_amount, src_weight = influence[index]
                if src_weight > weight:
                    per_vertex[twin] = influence[index]
    max_move = 0.0
    for index, (direction, amount, weight) in per_vertex.items():
        vertex = head.data.vertices[index]
        local_direction = head_inv.to_3x3() @ direction
        if local_direction.length == 0:
            continue
        local_direction.normalize()
        step = amount * weight
        vertex.co += local_direction * step
        max_move = max(max_move, step)
    head.data.update()
    return len(targets), max_move

before = measure()
passes, direct_total, max_move = 0, 0, 0.0
while passes < MAX_PASSES:
    if measure()["protruding"] == 0:
        break
    direct, moved = displace_pass()
    direct_total += direct
    max_move = max(max_move, moved)
    passes += 1
after = measure()

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=False,
                          export_animations=True, export_skins=True, export_yup=True)

print("SEAMFIX:" + json.dumps({
    "before": before, "after": after, "passes": passes, "directVerticesMoved": direct_total,
    "maxMove": round(max_move, 5), "clearance": clearance,
    "headVerts": len(head.data.vertices), "headFaces": len(head.data.polygons),
    "uvLayers": [u.name for u in head.data.uv_layers], "vertexGroups": len(head.vertex_groups),
}))
