"""Build a candidate Iron Spider runtime body with the supplied mechanical arms repaired.

The source GLB has two useful facts:
  * Object_122 is fully weighted to the supplied spider-body and left/right spider-leg bones;
  * its POSITION accessor is in a different scale/space from the body, and its bind pose is
    inconsistent with the imported rest skeleton.

This script keeps the runtime body and its 57 actions, extracts Object_122 from the untouched
source, fits one similarity transform from its weighted bone clusters to the runtime skeleton,
rebinds the same vertex groups to the runtime rig, and exports a candidate. It does not overwrite
the promoted body.

Usage:
  bash scripts/blender.sh -b --python scripts/repair_iron_spider_arms.py -- \
    <runtime-body.glb> <source-with-arms.glb> <candidate.glb> <report.json>
"""

import json
import math
import os
import re
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BASE, SOURCE, OUT, REPORT = argv[0], argv[1], argv[2], argv[3]


def key(name):
    return re.sub(r"[^a-z0-9]", "", str(name or "").lower())


def parse_args():
    if not all((BASE, SOURCE, OUT, REPORT)):
        raise SystemExit("need base.glb source.glb out.glb report.json")


def objects_snapshot():
    return set(bpy.data.objects)


def actions_snapshot():
    return set(bpy.data.actions)


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
        "min": [round(value, 5) for value in lo],
        "max": [round(value, 5) for value in hi],
        "size": [round(hi[i] - lo[i], 5) for i in range(3)],
        "center": [round((hi[i] + lo[i]) / 2, 5) for i in range(3)],
    }


def mesh_world_bounds(obj):
    matrix = obj.matrix_world
    points = [matrix @ vertex.co for vertex in obj.data.vertices]
    if not points:
        return None
    lo = [min(point[i] for point in points) for i in range(3)]
    hi = [max(point[i] for point in points) for i in range(3)]
    return {
        "min": [round(value, 5) for value in lo],
        "max": [round(value, 5) for value in hi],
        "size": [round(hi[i] - lo[i], 5) for i in range(3)],
        "center": [round((hi[i] + lo[i]) / 2, 5) for i in range(3)],
    }


def dominant_group_centroids(obj, target_rig):
    group_names = {group.index: group.name for group in obj.vertex_groups}
    target_by_key = {key(bone.name): bone for bone in target_rig.data.bones}
    sums = {}
    for vertex in obj.data.vertices:
        if not vertex.groups:
            continue
        group = max(vertex.groups, key=lambda item: item.weight)
        if group.weight <= 0:
            continue
        name = group_names.get(group.group)
        target = target_by_key.get(key(name))
        if target is None:
            continue
        entry = sums.setdefault(name, {"sum": Vector((0, 0, 0)), "count": 0, "target": target})
        entry["sum"] += obj.matrix_world @ vertex.co
        entry["count"] += 1
    return {
        name: {
            "centroid": entry["sum"] / entry["count"],
            "count": entry["count"],
            "target": target_rig.matrix_world @ ((entry["target"].head_local + entry["target"].tail_local) * 0.5),
            "bone": entry["target"].name,
        }
        for name, entry in sums.items()
        if entry["count"] > 2
    }


def fit_similarity(source_points, target_points, allow_reflection=True):
    """Fit target ~= scale * R * source + translation.

    Returns a mathutils Matrix and diagnostics. Kabsch is solved in numpy; a reflection is
    reported rather than silently hidden, because the supplied mechanical arms are mirror-
    symmetric and a reflected fit is acceptable only if face winding is corrected.
    """
    a = np.asarray([[p.x, p.y, p.z] for p in source_points], dtype=np.float64)
    b = np.asarray([[p.x, p.y, p.z] for p in target_points], dtype=np.float64)
    mean_a = a.mean(axis=0)
    mean_b = b.mean(axis=0)
    ac = a - mean_a
    bc = b - mean_b
    variance = float((ac * ac).sum())
    if variance < 1e-12:
        raise RuntimeError("arm source points have no spread")
    h = ac.T @ bc
    u, singular, vt = np.linalg.svd(h)
    rotation = vt.T @ u.T
    determinant = float(np.linalg.det(rotation))
    if not allow_reflection and determinant < 0:
        vt[-1, :] *= -1
        rotation = vt.T @ u.T
        determinant = float(np.linalg.det(rotation))
    scale = float(singular.sum() / variance)
    translation = mean_b - scale * (rotation @ mean_a)
    predicted = scale * (a @ rotation.T) + translation
    residual = float(np.sqrt(((predicted - b) ** 2).sum(axis=1).mean()))
    worst = float(np.sqrt(((predicted - b) ** 2).sum(axis=1)).max())
    r4 = Matrix((
        (rotation[0, 0], rotation[0, 1], rotation[0, 2], 0.0),
        (rotation[1, 0], rotation[1, 1], rotation[1, 2], 0.0),
        (rotation[2, 0], rotation[2, 1], rotation[2, 2], 0.0),
        (0.0, 0.0, 0.0, 1.0),
    ))
    matrix = Matrix.Translation(Vector(translation)) @ r4 @ Matrix.Scale(scale, 4)
    return matrix, {
        "scale": round(scale, 8),
        "determinant": round(determinant, 8),
        "reflection": determinant < 0,
        "rmsMeters": round(residual, 5),
        "worstMeters": round(worst, 5),
        "translation": [round(value, 5) for value in translation],
        "rotation": [[round(float(value), 6) for value in row] for row in rotation],
    }


def remove_object(obj):
    if obj is None:
        return
    bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parse_args()
    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    os.makedirs(os.path.dirname(os.path.abspath(REPORT)), exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=BASE)
    base_objects = objects_snapshot()
    base_actions = actions_snapshot()
    target_rig = next((obj for obj in bpy.data.objects if obj.type == "ARMATURE"), None)
    if target_rig is None:
        raise RuntimeError("runtime base has no armature")
    base_meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    target_bones = {key(bone.name): bone for bone in target_rig.data.bones}

    # Clear pose and actions before measuring or binding.
    target_rig.animation_data_create()
    target_rig.animation_data.action = None
    for track in target_rig.animation_data.nla_tracks:
        track.mute = True
    for pose_bone in target_rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    bpy.ops.import_scene.gltf(filepath=SOURCE)
    source_objects = objects_snapshot() - base_objects
    arm = next((obj for obj in source_objects if obj.type == "MESH" and obj.name.startswith("Object_122")), None)
    if arm is None:
        arm = next((obj for obj in source_objects if obj.type == "MESH" and "ironspiderman02" in obj.name.lower()), None)
    if arm is None:
        raise RuntimeError(
            "source has no Object_122 arm mesh; source meshes: "
            + ", ".join(sorted(obj.name for obj in source_objects if obj.type == "MESH"))
        )

    # A body-only bake can still retain a transform/empty node with the source arm's name. The
    # runtime identifies native arms by the mesh object's name, so remove that non-mesh placeholder
    # before giving the real arm its canonical name.
    for obj in list(bpy.data.objects):
        if obj is not arm and obj.name.startswith("Object_122") and obj.type != "MESH":
            remove_object(obj)

    # Keep the mesh's world while removing the source armature, then discard every other source
    # object so only the runtime body and the repaired arm are exported.
    arm_world = arm.matrix_world.copy()
    arm.parent = None
    arm.matrix_world = arm_world
    for modifier in list(arm.modifiers):
        if modifier.type == "ARMATURE":
            arm.modifiers.remove(modifier)
    for obj in list(source_objects):
        if obj != arm:
            remove_object(obj)
    for action in list(bpy.data.actions):
        if action not in base_actions:
            bpy.data.actions.remove(action)

    target_rig.animation_data.action = None
    for pose_bone in target_rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    groups = dominant_group_centroids(arm, target_rig)
    if len(groups) < 8:
        raise RuntimeError("not enough supplied arm groups map to runtime bones: %d" % len(groups))
    source_points = [entry["centroid"] for entry in groups.values()]
    target_points = [entry["target"] for entry in groups.values()]
    fit, fit_report = fit_similarity(source_points, target_points, allow_reflection=True)

    before = mesh_world_bounds(arm)
    arm.matrix_world = fit @ arm.matrix_world
    bpy.context.view_layer.update()
    after_fit = mesh_world_bounds(arm)
    if fit_report["reflection"]:
        # A reflected similarity flips face winding. Reverse it on the source topology; UVs and
        # vertex groups stay intact.
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(arm.data)
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
        bm.to_mesh(arm.data)
        bm.free()
        arm.data.update()

    # Put the mesh into the runtime rig's local/rest space, exactly as the normal reskin path does.
    to_rig = target_rig.matrix_world.inverted() @ arm.matrix_world
    arm.data.transform(to_rig)
    arm.matrix_world = target_rig.matrix_world.copy()
    arm.parent = target_rig
    arm.matrix_parent_inverse = Matrix.Identity(4)
    arm.name = "Object_122"
    arm.data.name = "IronSpider_MechanicalArms_Repaired"

    # The source groups and the target skeleton are the same joint family but may use different
    # separator styles. Rename to the target bone names and verify every weighted vertex survives.
    missing_groups = []
    group_names = {group.index: group.name for group in arm.vertex_groups}
    for group in arm.vertex_groups:
        target = target_bones.get(key(group.name))
        if target is None:
            missing_groups.append(group.name)
        else:
            group.name = target.name
    rebuilt = arm.modifiers.new("Armature", "ARMATURE")
    rebuilt.object = target_rig
    unweighted = 0
    for vertex in arm.data.vertices:
        if not vertex.groups:
            unweighted += 1
    if missing_groups:
        raise RuntimeError("source groups missing from target rig: " + ", ".join(missing_groups))
    if unweighted:
        raise RuntimeError("%d arm vertices lost all weights" % unweighted)

    target_rig.animation_data.action = None
    for pose_bone in target_rig.pose.bones:
        pose_bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()

    criteria = {
        "meshes": len([obj for obj in bpy.data.objects if obj.type == "MESH"]),
        "bones": len(target_rig.data.bones),
        "actions": len(bpy.data.actions),
        "armVertices": len(arm.data.vertices),
        "armGroups": len(arm.vertex_groups),
        "unweighted": unweighted,
        "fit": fit_report,
        "before": before,
        "afterFit": after_fit,
        "restArm": evaluated_bounds(arm),
        "restArmAndBody": None,
    }
    # Whole character bounds, for the rig gate.
    character_meshes = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    points = []
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in character_meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        points.extend(evaluated.matrix_world @ vertex.co for vertex in mesh.vertices)
        evaluated.to_mesh_clear()
    lo = [min(point[i] for point in points) for i in range(3)]
    hi = [max(point[i] for point in points) for i in range(3)]
    criteria["restArmAndBody"] = {
        "min": [round(value, 4) for value in lo],
        "max": [round(value, 4) for value in hi],
        "size": [round(hi[i] - lo[i], 4) for i in range(3)],
    }

    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_yup=True,
        export_skins=True,
        export_morph=False,
    )
    criteria["ok"] = True
    criteria["output"] = OUT
    criteria["baseMeshes"] = [obj.name for obj in base_meshes]
    criteria["missingGroups"] = missing_groups
    with open(REPORT, "w", encoding="utf-8") as handle:
        json.dump(criteria, handle, indent=2)
    print("RESULT:" + json.dumps(criteria))


if __name__ == "__main__":
    main()
