#!/usr/bin/env python3
"""Prepare an external environment model for the browser runtime.

Joins the imported scene, scales it to a real-world height, decimates it, caps texture
resolution, and exports a single GLB. Intended for static scenery only; source archives stay
in artifacts/asset-fetch and are never modified.

Usage:
  bash scripts/blender.sh -b --python scripts/prepare_environment_model.py -- \
    <input.gltf|glb> <output.glb> --height 180 --ratio 0.30 --max-texture 1024
"""
import argparse
import json
import os
import sys

import bpy


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--height", type=float, default=180.0)
    parser.add_argument("--ratio", type=float, default=0.3)
    parser.add_argument("--max-texture", type=int, default=1024)
    parser.add_argument("--no-decimate", action="store_true")
    return parser.parse_args(argv)


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.materials, bpy.data.images):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def world_bounds(objects):
    lo = [float("inf")] * 3
    hi = [float("-inf")] * 3
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ bpy.mathutils.Vector(corner) if hasattr(bpy, "mathutils") else obj.matrix_world @ __import__("mathutils").Vector(corner)
            for i in range(3):
                lo[i] = min(lo[i], point[i])
                hi[i] = max(hi[i], point[i])
    return lo, hi


def main():
    args = parse_args()
    source = os.path.abspath(args.source)
    output = os.path.abspath(args.output)
    os.makedirs(os.path.dirname(output), exist_ok=True)

    clear_scene()
    bpy.ops.import_scene.gltf(filepath=source)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    if not meshes:
        raise SystemExit("no meshes imported from " + source)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = "environment_model"
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    lo, hi = world_bounds([obj])
    native_height = hi[2] - lo[2]
    if native_height <= 0:
        raise SystemExit("model has zero height")
    scale = args.height / native_height
    obj.scale = (scale, scale, scale)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    lo, hi = world_bounds([obj])
    obj.location.x -= (lo[0] + hi[0]) / 2
    obj.location.y -= (lo[1] + hi[1]) / 2
    obj.location.z -= lo[2]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)

    source_tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if not args.no_decimate and args.ratio < 1.0:
        modifier = obj.modifiers.new("runtime-lod", "DECIMATE")
        modifier.ratio = args.ratio
        modifier.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)

    resized = 0
    for image in bpy.data.images:
        if image.size[0] > args.max_texture or image.size[1] > args.max_texture:
            image.scale(args.max_texture, args.max_texture)
            image.pack()
            resized += 1
        elif image.source == "FILE":
            image.pack()

    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=output,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_yup=True,
        export_cameras=False,
        export_lights=False,
    )

    report = {
        "ok": True,
        "source": source,
        "output": output,
        "bytes": os.path.getsize(output),
        "sourceTriangles": source_tris,
        "triangles": triangles,
        "nativeHeight": round(native_height, 3),
        "height": args.height,
        "materials": len(obj.data.materials),
        "texturesResized": resized,
    }
    print("ENV_RESULT:" + json.dumps(report))


if __name__ == "__main__":
    main()
