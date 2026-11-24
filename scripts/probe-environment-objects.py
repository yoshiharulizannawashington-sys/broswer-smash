#!/usr/bin/env python3
"""Print per-mesh bounds and a downward surface-height grid for an environment GLB.

  bash scripts/blender.sh -b --python scripts/probe-environment-objects.py -- path.glb [step]

The names and bounds identify water planes, display bases and the actual island/airport
geometry before an assembly pass. Surface samples come from the scene ray caster.
"""
import json
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = args[0]
step = float(args[1]) if len(args) > 1 else 10.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
rows = []
lo = Vector((math.inf, math.inf, math.inf))
hi = Vector((-math.inf, -math.inf, -math.inf))
for obj in objects:
    olo = Vector((math.inf, math.inf, math.inf))
    ohi = Vector((-math.inf, -math.inf, -math.inf))
    for corner in obj.bound_box:
        p = obj.matrix_world @ Vector(corner)
        for i in range(3):
            olo[i] = min(olo[i], p[i])
            ohi[i] = max(ohi[i], p[i])
            lo[i] = min(lo[i], p[i])
            hi[i] = max(hi[i], p[i])
    obj.data.calc_loop_triangles()
    rows.append({
        "name": obj.name,
        "triangles": len(obj.data.loop_triangles),
        "center": [round((olo[i] + ohi[i]) / 2, 2) for i in range(3)],
        "size": [round(ohi[i] - olo[i], 2) for i in range(3)],
    })
rows.sort(key=lambda r: -(r["size"][0] * r["size"][1]))
print("BOUNDS " + json.dumps({"min": [round(v, 2) for v in lo], "max": [round(v, 2) for v in hi]}))
for row in rows:
    print("MESH " + json.dumps(row))

# Downward ground probes on a coarse grid over the middle of the asset.
deps = bpy.context.evaluated_depsgraph_get()
scene = bpy.context.scene
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
half = min(65.0, max(hi.x - lo.x, hi.y - lo.y) / 2)
hits = []
for ix in range(-4, 5):
    for iy in range(-4, 5):
        x, y = cx + ix * step, cy + iy * step
        origin = Vector((x, y, hi.z + 50))
        hit, location, _normal, _index, obj, _matrix = scene.ray_cast(deps, origin, Vector((0, 0, -1)))
        if hit:
            hits.append({"x": round(x, 1), "y": round(y, 1), "z": round(location.z, 2), "object": obj.name})
print("GRID " + json.dumps({"center": [round(cx, 2), round(cy, 2)], "half": half, "hits": hits}))
