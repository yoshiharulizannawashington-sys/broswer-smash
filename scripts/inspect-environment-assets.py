#!/usr/bin/env python3
"""Inspect and preview downloaded environment GLBs in headless Blender.

Usage:
  bash scripts/blender.sh -b --python scripts/inspect-environment-assets.py -- \
      --out artifacts/environment/inspect -- uid=path [uid=path ...]

Writes one PNG per asset and prints a JSON report (bounds in metres, meshes, triangles,
materials, images). This is an inspection tool, not an assembly/export step.
"""
import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument("--out", default="artifacts/environment/inspect")
parser.add_argument("assets", nargs="+")
args = parser.parse_args(argv)
os.makedirs(args.out, exist_ok=True)


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mesh_bounds(objects):
    lo = Vector((math.inf, math.inf, math.inf))
    hi = Vector((-math.inf, -math.inf, -math.inf))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            lo.x = min(lo.x, point.x); lo.y = min(lo.y, point.y); lo.z = min(lo.z, point.z)
            hi.x = max(hi.x, point.x); hi.y = max(hi.y, point.y); hi.z = max(hi.z, point.z)
    return lo, hi


def render(path, objects, label):
    lo, hi = mesh_bounds(objects)
    centre = (lo + hi) * 0.5
    size = max((hi - lo).x, (hi - lo).y, (hi - lo).z, 1.0)

    bpy.ops.object.camera_add(location=centre + Vector((size * 1.05, -size * 1.55, size * 0.85)))
    camera = bpy.context.object
    camera.data.lens = 50
    direction = centre - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = camera

    bpy.ops.object.light_add(type="SUN", location=centre + Vector((size, -size, size * 1.6)))
    bpy.context.object.data.energy = 3.2
    bpy.ops.object.light_add(type="AREA", location=centre + Vector((-size, -size * 0.6, size)))
    bpy.context.object.data.energy = 900 * max(size, 1) ** 2
    bpy.context.object.data.size = size * 2

    scene = bpy.context.scene
    # Workbench needs an EGL/OpenGL context, which the headless image does not provide.
    # Cycles on the CPU renders the same inspection frame without a display server.
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.render.resolution_x = 1100
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = path
    scene.world = bpy.data.worlds.new("PreviewWorld")
    scene.world.color = (0.09, 0.11, 0.16)
    bpy.ops.render.render(write_still=True)
    print("PREVIEW", label, path)


for entry in args.assets:
    label, _, path = entry.partition("=")
    clear()
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    objects = list(bpy.context.scene.objects)
    meshes = [o for o in objects if o.type == "MESH"]
    lo, hi = mesh_bounds(meshes)
    tris = 0
    materials = set()
    images = set()
    for obj in meshes:
        obj.data.calc_loop_triangles()
        tris += len(obj.data.loop_triangles)
        for slot in obj.material_slots:
            if slot.material:
                materials.add(slot.material.name)
                for node in slot.material.node_tree.nodes if slot.material.use_nodes else []:
                    if node.type == "TEX_IMAGE" and node.image:
                        images.add((node.image.name, tuple(node.image.size)))
    report = {
        "label": label,
        "file": os.path.abspath(path),
        "objects": len(objects),
        "meshes": len(meshes),
        "triangles": tris,
        "materials": sorted(materials),
        "images": sorted([{"name": n, "size": list(s)} for n, s in images], key=lambda i: i["name"]),
        "boundsMin": [round(v, 3) for v in lo],
        "boundsMax": [round(v, 3) for v in hi],
        "size": [round(v, 3) for v in (hi - lo)],
        "names": sorted(o.name for o in objects)[:80],
    }
    print("ASSET_REPORT " + json.dumps(report))
    render(os.path.join(args.out, label + ".png"), meshes, label)
