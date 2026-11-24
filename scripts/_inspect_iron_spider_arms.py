"""Inspect the supplied Iron Spider mechanical-arm mesh across every imported action.

The source mesh has body-scale-relative weights but positions that are roughly 25x larger
than the body. This script answers whether any original clip repositions the arm mesh into
the skeleton's space, or whether the mesh always needs a bind normalization.

Usage:
  bash scripts/blender.sh -b --python scripts/_inspect_iron_spider_arms.py -- <source.glb> <report.json>
"""

import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SOURCE, OUT = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)

rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
arm = bpy.data.objects.get("Object_122")
body = bpy.data.objects.get("Object_120")
if rig is None or arm is None:
    print("RESULT:" + json.dumps({"ok": False, "error": "missing armature or Object_122"}))
    raise SystemExit(0)

scene = bpy.context.scene
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.animation_data.action = None
scene.frame_set(0)
bpy.context.view_layer.update()


def evaluated_bounds(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    if not mesh.vertices:
        evaluated.to_mesh_clear()
        return None
    matrix = evaluated.matrix_world
    points = [matrix @ vertex.co for vertex in mesh.vertices]
    lo = [min(point[i] for point in points) for i in range(3)]
    hi = [max(point[i] for point in points) for i in range(3)]
    evaluated.to_mesh_clear()
    return {
        "min": [round(value, 4) for value in lo],
        "max": [round(value, 4) for value in hi],
        "size": [round(hi[i] - lo[i], 4) for i in range(3)],
        "center": [round((hi[i] + lo[i]) / 2, 4) for i in range(3)],
    }


def brief(bounds):
    if bounds is None:
        return None
    return {
        "size": bounds["size"],
        "center": bounds["center"],
        "maxDimension": round(max(bounds["size"]), 4),
    }


def arm_bone_state():
    names = [
        "spider body bone_067",
        "spider leg L Bone001_068",
        "spider leg L Bone010_077",
        "spider leg R Bone001_078",
        "spider leg R Bone010_087",
        "Helper_Chain_Root_092",
        "Helper_Chain_Root00_099",
    ]
    result = {}
    for name in names:
        bone = rig.pose.bones.get(name)
        if bone is None:
            continue
        head = rig.matrix_world @ bone.head
        tail = rig.matrix_world @ bone.tail
        result[name] = {
            "head": [round(value, 4) for value in head],
            "tail": [round(value, 4) for value in tail],
            "length": round((tail - head).length, 4),
        }
    return result


report = {
    "ok": True,
    "source": SOURCE,
    "blender": bpy.app.version_string,
    "objects": {
        "armature": rig.name,
        "arm": arm.name,
        "body": body.name if body else None,
    },
    "rest": {
        "arm": brief(evaluated_bounds(arm)),
        "body": brief(evaluated_bounds(body)) if body else None,
        "armBones": arm_bone_state(),
    },
    "actions": [],
}

for action in sorted(bpy.data.actions, key=lambda item: item.name):
    start, end = [float(value) for value in action.frame_range]
    if end <= start:
        continue
    rig.animation_data.action = action
    samples = []
    for fraction, label in ((0.0, "start"), (0.5, "mid"), (1.0, "end")):
        frame = round(start + (end - start) * fraction)
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        arm_bounds = evaluated_bounds(arm)
        body_bounds = evaluated_bounds(body) if body else None
        samples.append({
            "label": label,
            "frame": frame,
            "arm": brief(arm_bounds),
            "body": brief(body_bounds),
            "armBones": arm_bone_state(),
        })
    best = min(samples, key=lambda sample: sample["arm"]["maxDimension"])
    report["actions"].append({
        "name": action.name,
        "range": [start, end],
        "duration": round((end - start) / scene.render.fps, 4),
        "samples": samples,
        "best": best,
    })
    print(
        "ARM_CLIP "
        + action.name
        + " bestFrame="
        + str(best["frame"])
        + " size="
        + str(best["arm"]["size"])
        + " center="
        + str(best["arm"]["center"])
        + " bodySize="
        + str(best["body"]["size"] if best["body"] else None)
    )

rig.animation_data.action = None
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
with open(OUT, "w", encoding="utf-8") as handle:
    json.dump(report, handle, indent=2)
print("RESULT:" + json.dumps({"ok": True, "out": OUT, "actions": len(report["actions"])}))
