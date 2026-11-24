#!/usr/bin/env python3
"""Render a top-down, coordinate-labelled inspection frame for an environment GLB."""
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
path, out = args[0], args[1]
step = float(args[2]) if len(args) > 2 else 10.0

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
span = max(hi.x - lo.x, hi.y - lo.y)
top = hi.z + span * 0.02

# Camera looks straight down; X runs right, Y runs up in the frame.
bpy.ops.object.camera_add(location=(cx, cy, top + span))
cam = bpy.context.object
cam.data.type = "ORTHO"
cam.data.ortho_scale = span * 1.08
cam.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam

# Suns make the full-colour asset readable from above.
bpy.ops.object.light_add(type="SUN", location=(cx - span, cy - span, top + span))
bpy.context.object.data.energy = 4
bpy.ops.object.light_add(type="SUN", location=(cx + span, cy + span, top + span))
bpy.context.object.data.energy = 2

def line(name, a, b, color):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([(a[0], a[1], top), (b[0], b[1], top)], [], [(0, 1)])
    obj = bpy.data.objects.new(name, mesh)
    material = bpy.data.materials.new(name + "-mat")
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Emission Color"].default_value = color
    bsdf.inputs["Emission Strength"].default_value = 2.2
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)

for i in range(-8, 9):
    x = cx + i * step
    line(f"gx{i}", (x, cy - span / 2, 0), (x, cy + span / 2, 0), (0.05, 0.95, 1, 1) if i % 5 else (1, 0.2, 0.1, 1))
    y = cy + i * step
    line(f"gy{i}", (cx - span / 2, y, 0), (cx + span / 2, y, 0), (0.05, 0.95, 1, 1) if i % 5 else (1, 0.2, 0.1, 1))

# Labels along the central axes.
for i in range(-4, 5):
    curve = bpy.data.curves.new(type="FONT", name=f"textx{i}")
    curve.body = str(round(cx + i * step, 1))
    curve.size = span * 0.018
    obj = bpy.data.objects.new(f"tx{i}", curve)
    obj.location = (cx + i * step, cy - span * 0.03, top)
    obj.rotation_euler = (0, 0, math.radians(90))
    bpy.context.collection.objects.link(obj)
    curve2 = bpy.data.curves.new(type="FONT", name=f"texty{i}")
    curve2.body = str(round(cy + i * step, 1))
    curve2.size = span * 0.018
    obj2 = bpy.data.objects.new(f"ty{i}", curve2)
    obj2.location = (cx - span * 0.03, cy + i * step, top)
    bpy.context.collection.objects.link(obj2)

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 12
scene.render.resolution_x = 1200
scene.render.resolution_y = 1200
scene.render.image_settings.file_format = "PNG"
scene.world = bpy.data.worlds.new("TopWorld")
scene.world.color = (0.04, 0.06, 0.1)
os.makedirs(os.path.dirname(out), exist_ok=True)
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print("TOP", out, "center", round(cx, 2), round(cy, 2), "span", round(span, 2), "top", round(top, 2))
