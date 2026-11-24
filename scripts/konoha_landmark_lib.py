#!/usr/bin/env python3
"""Assemble the imported Konoha landmarks into one optimized GLB.

The supplied village asset is a tabletop diorama (painted sky + display base), so it is not used
as the playable village. The Six Hokage Mountain relief and the Hokage Office are real geometry
and textures; this script normalizes both to metres, places them behind/inside the existing
procedural Konoha world, decimates the mountain for the Chromium triangle budget, packs textures,
and exports one static scenery GLB.

Usage:
  bash scripts/blender.sh -b --python scripts/assemble_konoha_landmarks.py -- \
    artifacts/asset-fetch/c9cc.../model.glb \
    artifacts/asset-fetch/0751.../model.glb \
    public/assets/environments/konoha/hokage_landmarks.glb
"""
import bpy
import os
import sys
import json
from mathutils import Vector, Matrix

MOUNTAIN_WIDTH_M = 180.0
OFFICE_HEIGHT_M = 8.0
MOUNTAIN_DISSOLVE_ANGLE_DEG = 12.0
MAX_TEXTURE = 1024


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    if len(argv) != 3:
        raise SystemExit("usage: assemble_konoha_landmarks.py <mountain.glb> <office.glb> <out.glb>")
    return argv


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    return [o for o in bpy.context.scene.objects if o.type == "MESH" and o not in before]


def join_meshes(meshes, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    # Bake the import matrix once. Each imported mesh is parented to a Sketchfab empty at a
    # large offset; clear the parent first, or that offset is re-applied at export and the
    # relief ends up 17 km from its node origin.
    world = obj.matrix_world.copy()
    obj.parent = None
    obj.data.transform(world)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.update()
    return obj


def bounds(obj):
    lo = Vector((1e30, 1e30, 1e30))
    hi = Vector((-1e30, -1e30, -1e30))
    for v in obj.data.vertices:
        p = obj.matrix_world @ v.co
        for i in range(3):
            lo[i] = min(lo[i], p[i])
            hi[i] = max(hi[i], p[i])
    return lo, hi


def normalize(obj, target_width=None, target_height=None):
    lo, hi = bounds(obj)
    dims = hi - lo
    factor = target_width / dims.x if target_width else target_height / dims.z
    center = (lo + hi) / 2
    for v in obj.data.vertices:
        v.co = (v.co - center) * factor
    obj.data.update()
    lo, hi = bounds(obj)
    obj.location.z -= lo.z
    obj.data.transform(Matrix.Translation((0, 0, -lo.z)))
    obj.location = (0, 0, 0)
    obj.data.update()
    return bounds(obj)


def dissolve_mountain(obj):
    """Planar-dissolve the joined relief, then drop loose vertices.

    A collapsing Decimate modifier on the joined 558-piece photogrammetry mesh collapses nearly
    every face into a tiny cluster while leaving loose vertices at the original bounds. Planar
    dissolve preserves the relief silhouette and material boundaries at ~45% of the source
    triangles, which is appropriate for a background landmark.
    """
    import math
    mod = obj.modifiers.new("runtime-lod", "DECIMATE")
    mod.decimate_type = "DISSOLVE"
    mod.angle_limit = math.radians(MOUNTAIN_DISSOLVE_ANGLE_DEG)
    mod.use_dissolve_boundaries = False
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.delete_loose(use_verts=True, use_edges=True, use_faces=False)
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()


def cap_textures():
    resized = 0
    for image in bpy.data.images:
        if image.size[0] > MAX_TEXTURE or image.size[1] > MAX_TEXTURE:
            image.scale(MAX_TEXTURE, MAX_TEXTURE)
            resized += 1
        if image.source == "FILE":
            image.pack()
    return resized


def triangles(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)
