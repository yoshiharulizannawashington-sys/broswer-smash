#!/usr/bin/env python3
"""Find open, roughly level rectangles in an environment GLB using downward raycasts.

  bash scripts/blender.sh -b --python scripts/find-environment-plaza.py -- file.glb [span] [step] [width] [depth]

Prints the best candidates as world-space rectangles, mean height and height spread. This is a
placement aid for playable plazas; the final arena still has an explicit collision layout.
"""
import json
import math
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path = args[0]
span = float(args[1]) if len(args) > 1 else 120.0
step = float(args[2]) if len(args) > 2 else 2.0
win_w = float(args[3]) if len(args) > 3 else 44.0
win_d = float(args[4]) if len(args) > 4 else 34.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
lo = Vector((math.inf, math.inf, math.inf))
hi = Vector((-math.inf, -math.inf, -math.inf))
for obj in meshes:
    for corner in obj.bound_box:
        p = obj.matrix_world @ Vector(corner)
        for i in range(3):
            lo[i] = min(lo[i], p[i]); hi[i] = max(hi[i], p[i])
cx, cy = (lo.x + hi.x) / 2, (lo.y + hi.y) / 2
deps = bpy.context.evaluated_depsgraph_get()
scene = bpy.context.scene

samples = {}
for ix in range(-int(span / step) // 2, int(span / step) // 2 + 1):
    for iy in range(-int(span / step) // 2, int(span / step) // 2 + 1):
        x, y = cx + ix * step, cy + iy * step
        hit, loc, _n, _i, obj, _m = scene.ray_cast(deps, Vector((x, y, hi.z + 60)), Vector((0, 0, -1)))
        if hit:
            samples[(round(x, 2), round(y, 2))] = (loc.z, obj.name)

best = []
nx = max(1, int(round(win_w / step)))
ny = max(1, int(round(win_d / step)))
for ix in range(-int(span / step) // 2, int(span / step) // 2 + 1 - nx):
    for iy in range(-int(span / step) // 2, int(span / step) // 2 + 1 - ny):
        vals = []
        names = set()
        ok = True
        for jx in range(nx):
            for jy in range(ny):
                key = (round(cx + (ix + jx) * step, 2), round(cy + (iy + jy) * step, 2))
                if key not in samples:
                    ok = False
                    break
                z, name = samples[key]
                vals.append(z)
                names.add(name)
            if not ok:
                break
        if not ok or len(vals) < nx * ny * 0.92:
            continue
        vals.sort()
        trimmed = vals[:max(1, int(len(vals) * 0.9))]
        mean = sum(trimmed) / len(trimmed)
        spread = max(trimmed) - min(trimmed)
        x0 = cx + ix * step
        z0 = cy + iy * step
        best.append({
            "rect": [round(x0, 1), round(z0, 1), round(x0 + win_w, 1), round(z0 + win_d, 1)],
            "mean": round(mean, 2),
            "spread": round(spread, 2),
            "objects": sorted(names)[:6],
        })
best.sort(key=lambda b: (b["spread"], abs(b["mean"])))
print("PLAZAS " + json.dumps(best[:12]))
