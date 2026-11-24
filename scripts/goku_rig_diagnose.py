#!/usr/bin/env python3
"""Diagnose the space mismatch between a character's meshes and its armature.

Usage:
  bash scripts/blender.sh -b --python scripts/goku_rig_diagnose.py -- <model> [out.json]

Writes a single RESULT: JSON line. Read-only: never saves or exports the model.
"""

import bpy
import json
import os
import sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if not argv:
    print("RESULT:" + json.dumps({"ok": False, "error": "usage: <model> [out.json]"}))
    raise SystemExit(0)

SOURCE = argv[0]
OUT = argv[1] if len(argv) > 1 else ""


def rounded(value, digits=4):
    return round(float(value), digits)


def emit(payload):
    text = "RESULT:" + json.dumps(payload, default=str)
    if OUT:
        with open(OUT, "w", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, indent=2, default=str))
    print(text)


def bounds(points):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for point in points:
        for axis in range(3):
            lo[axis] = min(lo[axis], point[axis])
            hi[axis] = max(hi[axis], point[axis])
    if lo.x > hi.x:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return lo, hi


def record(vec):
    return [rounded(vec.x), rounded(vec.y), rounded(vec.z)]


def obj_bounds(obj):
    matrix = obj.matrix_world
    return bounds([matrix @ Vector(corner) for corner in obj.bound_box])


def main():
    if not os.path.isfile(SOURCE):
        emit({"ok": False, "error": "missing source: " + SOURCE})
        return

    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = os.path.splitext(SOURCE)[1].lower()
    if ext in (".glb", ".gltf", ".vrm"):
        bpy.ops.import_scene.gltf(filepath=SOURCE)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=SOURCE, automatic_bone_orientation=False)
    else:
        emit({"ok": False, "error": "unsupported format " + ext})
        return
    bpy.context.view_layer.update()

    scene = bpy.context.scene
    meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    armatures = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    armature = max(armatures, key=lambda obj: len(obj.data.bones), default=None)

    mesh_info = []
    all_mesh_points = []
    for obj in meshes:
        obj.data.calc_loop_triangles()
        lo, hi = obj_bounds(obj)
        all_mesh_points.extend([obj.matrix_world @ Vector(corner) for corner in obj.bound_box])
        groups = {group.index: group.name for group in obj.vertex_groups}
        weighted = 0
        unweighted = 0
        group_usage = {}
        for vertex in obj.data.vertices:
            best = 0.0
            best_name = None
            total = 0.0
            for membership in vertex.groups:
                total += membership.weight
                if membership.weight > best:
                    best = membership.weight
                    best_name = groups.get(membership.group)
            if total > 0.0001:
                weighted += 1
                if best_name:
                    group_usage[best_name] = group_usage.get(best_name, 0) + 1
            else:
                unweighted += 1
        modifiers = [
            {
                "type": modifier.type,
                "object": modifier.object.name if getattr(modifier, "object", None) else None,
                "useVertexGroups": getattr(modifier, "use_vertex_groups", None),
            }
            for modifier in obj.modifiers
        ]
        mesh_info.append({
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "triangles": len(obj.data.loop_triangles),
            "vertexGroups": len(obj.vertex_groups),
            "weightedVertices": weighted,
            "unweightedVertices": unweighted,
            "topGroups": sorted(group_usage.items(), key=lambda item: -item[1])[:6],
            "modifiers": modifiers,
            "parent": obj.parent.name if obj.parent else None,
            "parentType": obj.parent_type,
            "parentBone": obj.parent_bone,
            "matrixWorld": [rounded(value, 5) for row in obj.matrix_world for value in row],
            "worldBounds": {"min": record(lo), "max": record(hi), "centre": record((lo + hi) * 0.5)},
            "localBounds": {"min": record(obj.location), "dimensions": record(obj.dimensions)},
        })

    mesh_lo, mesh_hi = bounds(all_mesh_points)
    mesh_centre = (mesh_lo + mesh_hi) * 0.5

    rig = None
    if armature:
        points = []
        bone_rows = []
        for bone in armature.data.bones:
            head = armature.matrix_world @ bone.head_local
            tail = armature.matrix_world @ bone.tail_local
            points.extend([head, tail])
            bone_rows.append({
                "name": bone.name,
                "parent": bone.parent.name if bone.parent else None,
                "head": record(head),
                "tail": record(tail),
            })
        bone_lo, bone_hi = bounds(points)
        rig = {
            "name": armature.name,
            "bones": len(armature.data.bones),
            "matrixWorld": [rounded(value, 5) for row in armature.matrix_world for value in row],
            "location": record(armature.location),
            "rotationEuler": [rounded(value, 5) for value in armature.rotation_euler],
            "rotationMode": armature.rotation_mode,
            "scale": record(armature.scale),
            "parent": armature.parent.name if armature.parent else None,
            "worldBounds": {"min": record(bone_lo), "max": record(bone_hi), "centre": record((bone_lo + bone_hi) * 0.5)},
            "height": rounded(bone_hi.z - bone_lo.z),
            "centreDistanceFromMesh": rounded(((bone_lo + bone_hi) * 0.5 - mesh_centre).length),
            "posePosition": armature.data.pose_position,
            "keyBones": [row for row in bone_rows if any(
                token in row["name"].lower() for token in ("pelvis", "hips", "head", "foot", "hand.l", "hand.r")
            )],
        }

        # Where does the skin actually bind? Compare each mesh's rest world position with the
        # joint positions used by its armature modifier.
        for entry in mesh_info:
            if not any(modifier["type"] == "ARMATURE" for modifier in entry["modifiers"]):
                continue
            entry["bindCheck"] = {
                "offsetFromRigCentre": rounded(
                    (Vector(entry["worldBounds"]["centre"]) - Vector(rig["worldBounds"]["centre"])).length
                ),
            }

    emit({
        "ok": True,
        "source": SOURCE,
        "meshes": mesh_info,
        "meshBounds": {
            "min": record(mesh_lo),
            "max": record(mesh_hi),
            "centre": record(mesh_centre),
            "height": rounded(mesh_hi.z - mesh_lo.z),
        },
        "rig": rig,
    })


try:
    main()
except SystemExit:
    raise
except Exception as error:
    emit({"ok": False, "error": type(error).__name__ + ": " + str(error)[:800]})
