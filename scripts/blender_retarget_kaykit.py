"""Retarget a roster rig's gameplay clips onto a donor skeleton, keeping the donor's own skin weights.

This is the inverse of the reskin attempt: instead of forcing the donor mesh onto the roster's 19-bone
rig (which tore because the two rest poses do not match), the donor keeps its own skeleton, bind
matrices and weights, and the roster's clips are replayed onto it bone by bone. The donor therefore
deforms exactly as it was authored to; only the driving animation changes.

Usage:
  blender -b --python scripts/blender_retarget_kaykit.py -- <sourceClipModel.glb> <donor.glb> <out.glb>
"""

import json
import math
import os
import re
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SOURCE, DONOR, OUT = argv[0], argv[1], argv[2]
# Independent experiment switches. "notwist" drops the source-twist term from the arm transfer;
# "actions" exports in ACTIONS mode instead of NLA_TRACKS. They must be tested separately.
FLAGS = [a.lower() for a in argv[3:]]
NO_TWIST = "notwist" in FLAGS
EXPORT_ACTIONS = "actions" in FLAGS
GROUND_LIFT = "noground" not in FLAGS

# Roster bone -> candidate donor bone names, most specific first. Names are compared after stripping
# everything but letters and digits, so "LeftForeArm" and "lowerarm_l" style naming both resolve.
# The bones whose rest pose differs between the two rigs; these use the rest-offset aim transfer.
ARM_CHAIN = {"LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
             "RightShoulder", "RightArm", "RightForeArm", "RightHand"}

CANDIDATES = {
    "Hips": ["hips", "pelvis", "hip", "root"],
    "Spine": ["spine", "spine1"],
    "Chest": ["chest", "spine2", "torso", "upperchest"],
    "Neck": ["neck"],
    "Head": ["head"],
    "LeftShoulder": ["shoulderl", "claviclel", "leftshoulder", "shoulderleft"],
    "LeftArm": ["upperarml", "leftupperarm", "arml"],
    "LeftForeArm": ["lowerarml", "leftforearm", "forearml"],
    "LeftHand": ["handl", "lefthand", "wristl"],
    "RightShoulder": ["shoulderr", "clavicler", "rightshoulder", "shoulderright"],
    "RightArm": ["upperarmr", "rightupperarm", "armr"],
    "RightForeArm": ["lowerarmr", "rightforearm", "forearmr"],
    "RightHand": ["handr", "righthand", "wristr"],
    "LeftUpLeg": ["upperlegl", "leftupleg", "thighl"],
    "LeftLeg": ["lowerlegl", "leftleg", "shinl", "calf_l"],
    "LeftFoot": ["footl", "leftfoot"],
    "RightUpLeg": ["upperlegr", "rightupleg", "thighr"],
    "RightLeg": ["lowerlegr", "rightleg", "shinr", "calf_r"],
    "RightFoot": ["footr", "rightfoot"],
}


def normalise(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())


def resolve(donor_names, canonical):
    lookup = {normalise(name): name for name in donor_names}
    for candidate in CANDIDATES[canonical]:
        match = lookup.get(normalise(candidate))
        if match:
            return match
    return None


def depth(bone):
    value = 0
    while bone.parent:
        bone = bone.parent
        value += 1
    return value


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=DONOR)
    donor_rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if not donor_rig:
        print("RESULT:" + json.dumps({"ok": False, "error": "donor has no armature"}))
        return
    donor_names = [b.name for b in donor_rig.data.bones]
    pairs = []
    for canonical in CANDIDATES:
        target = resolve(donor_names, canonical)
        if target:
            pairs.append((canonical, target))
    if not pairs:
        print("RESULT:" + json.dumps({"ok": False, "error": "no bone names resolved"}))
        return
    pairs.sort(key=lambda pair: depth(donor_rig.data.bones[pair[1]]))
    # The donor must ship without its own animation driving these bones.
    if donor_rig.animation_data:
        donor_rig.animation_data_clear()

    # The donor's own meshes, captured before the clip source is imported: they are what has to be
    # scaled to roster height, and they are also the objects whose weights must stay untouched.
    donor_meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    donor_mesh_names = {o.name for o in donor_meshes}
    # Character height from the UNTOUCHED donor rest pose. Measuring it later, after the clips existed,
    # made the scale depend on whatever pose the rig was left in (0.7306 -> 0.6903 in 28.4.8).
    _prop_measure = re.compile(r"sword|shield|axe|spear|bow|quiver|arrow|dagger|crossbow|staff|wand|spellbook|icosphere", re.IGNORECASE)
    _body = [o for o in donor_meshes
             if (any(m.type == "ARMATURE" for m in o.modifiers) or o.parent is not None)
             and not _prop_measure.search(o.name)]
    _zs = [(o.matrix_world @ v.co).z for o in _body for v in o.data.vertices]
    REST_HEIGHT = (max(_zs) - min(_zs)) if _zs else 0.0
    before = {o.name for o in bpy.data.objects}
    # Only the clips that arrive with the source may be retargeted; the donor's own action list must
    # not be replayed onto itself (that produced empty duplicates with zero movement).
    existing_actions = set(bpy.data.actions.keys())
    bpy.ops.import_scene.gltf(filepath=SOURCE)
    source_rig = next((o for o in bpy.data.objects if o.type == "ARMATURE" and o.name not in before), None)
    if not source_rig:
        print("RESULT:" + json.dumps({"ok": False, "error": "source rig not found"}))
        return
    source_actions = sorted(
        [a for a in bpy.data.actions if a.name not in existing_actions], key=lambda a: a.name
    )

    scene = bpy.context.scene
    donor_rig.animation_data_create()
    for pose_bone in donor_rig.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"

    report = {}
    for action in source_actions:
        label = action.name.split("_Kaze_Rig")[0]
        start, end = [int(round(v)) for v in action.frame_range]
        if end <= start:
            continue
        source_rig.animation_data_create()
        source_rig.animation_data.action = action
        produced = bpy.data.actions.new(label)
        produced.use_fake_user = True
        donor_rig.animation_data.action = produced
        peaks = {}
        base = {}
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            for canonical, target_name in pairs:
                source_pose = source_rig.pose.bones.get(canonical)
                target_pose = donor_rig.pose.bones[target_name]
                if not source_pose:
                    continue
                rest_d = target_pose.bone.matrix_local.to_quaternion()
                if canonical in ARM_CHAIN:
                    # The donor's rest pose is a T-pose and the source's is not, so a delta transfer only
                    # reproduces "how far the arm moved from its own rest": the source idle sits ~8 deg
                    # from its rest, so the donor stayed ~8 deg from ITS rest, which is a T-pose. Aim the
                    # donor bone at the source bone's absolute world direction instead, measured from the
                    # donor's own rest direction, and carry the source's twist across so elbow and wrist
                    # roll survive.
                    axis = Vector((0.0, 1.0, 0.0))
                    source_world = source_pose.matrix.to_quaternion()
                    rest_s = source_pose.bone.matrix_local.to_quaternion()
                    aim = (rest_d @ axis).normalized().rotation_difference((source_world @ axis).normalized())
                    twist_source = ((rest_s @ rest_s.inverted()) if NO_TWIST
                                    else (source_world @ rest_s.inverted()))
                    matrix = (aim @ rest_d @ twist_source).to_matrix().to_4x4()
                else:
                    delta = (source_pose.matrix.to_quaternion()
                             @ source_pose.bone.matrix_local.to_quaternion().inverted())
                    matrix = (delta @ rest_d).to_matrix().to_4x4()
                matrix.translation = target_pose.matrix.translation
                target_pose.matrix = matrix
                bpy.context.view_layer.update()
                target_pose.keyframe_insert("rotation_quaternion", frame=frame)
                if frame == start:
                    base[target_name] = target_pose.rotation_quaternion.copy()
                degrees = math.degrees(base[target_name].rotation_difference(target_pose.rotation_quaternion).angle)
                peaks[target_name] = max(peaks.get(target_name, 0.0), degrees)
            # Contact-aware ground compensation. The retarget keeps the donor's own proportions, but the
            # source clips swing the legs through Link's, so the soles ended 3-9.5 cm below the floor in
            # every one of the 25 clips. Lift the root only on frames where a sole would actually go
            # under: an airborne frame is already above the floor and is left exactly as authored, so
            # jumps and flights keep their arc instead of being flattened by a constant offset.
            if GROUND_LIFT:
                hips = donor_rig.pose.bones.get("hips")
                if hips:
                    # Measure the UN-LIFTED pose: reset the hips offset, evaluate, then apply the lift.
                    # The 28.4.8 version measured a body that was still raised from the previous frame,
                    # so each correction only recovered the residue (~5 mm of a 90 mm dip).
                    hips.location = (0.0, 0.0, 0.0)
                    bpy.context.view_layer.update()
                    deps = bpy.context.evaluated_depsgraph_get()
                    sole = 1e9
                    for mesh_obj in donor_meshes:
                        if mesh_obj.name not in ("Knight_LegLeft", "Knight_LegRight"):
                            continue
                        ev = mesh_obj.evaluated_get(deps)
                        me = ev.to_mesh()
                        for v in me.vertices:
                            sole = min(sole, (ev.matrix_world @ v.co).z)
                        ev.to_mesh_clear()
                    lift = max(0.0, -sole)
                    raised = hips.matrix.copy()
                    raised.translation.z += lift
                    hips.matrix = raised
                    bpy.context.view_layer.update()
                    # Key EVERY frame, including zero-lift ones, so no gap lets a stale offset interpolate
                    # across a frame that was never corrected.
                    hips.keyframe_insert("location", frame=frame)
        report[label] = {
            "frames": [start, end],
            "bonesMoved": sum(1 for value in peaks.values() if value > 1),
            "maxDegrees": round(max(peaks.values()) if peaks else 0, 1),
        }
        donor_rig.animation_data.action = None

    for action in bpy.data.actions:
        if action.name in report:
            track = donor_rig.animation_data.nla_tracks.new()
            track.name = action.name
            track.strips.new(action.name, int(action.frame_range[0]), action)
            track.mute = False

    # Match the roster body's height so the fighter keeps its gameplay size and hitbox.
    # Measure the character, not the scene. This used to collect every donor mesh, which pulled in the
    # loose helper geometry (the Icosphere at z -1..1 and the control/chantier meshes) and produced a
    # 3.93 m "height" for a 2.30 m knight, so the export was scaled to 1.24 m instead of 1.79 m. Only
    # skinned meshes belong to the body: they span z -0.001..2.301 in the donor's rest pose.
    # The helmet is bone-parented to the rig rather than armature-modified, and it is the tallest part of
    # the body: knight head 2.301 m, helmet 2.461 m. Measuring only armature-modified meshes therefore
    # read the head as the top, scaled for it, and left the helmet 13 cm over the 1.79 m target. Measure
    # every mesh that belongs to the rig, excluding the loose weapon/prop meshes and helper geometry.
    meshes = donor_meshes
    if meshes:
        donor_height = REST_HEIGHT
        roster_height = 1.79
        if donor_height > 0.01:
            factor = roster_height / donor_height
            donor_rig.scale = (factor, factor, factor)
            # Leave the uniform scale ON the armature object instead of baking it into the armature
            # data. Baking it there resized the bones while every skinned mesh kept its original vertex
            # coordinates, so nothing was in the space its bones described: the legs collapsed into the
            # hips and the helmet and cape landed below the floor. A scale left on the armature node
            # scales the whole subtree - skeleton and meshes together - and the exporter writes it as a
            # node transform, so the bind relationship is untouched.
            void = None

    # Drop the clip source's own bodies, and the donor's loose weapon variants, so only the fighter
    # body ships. Identity comparisons on Blender objects are unsafe after removals - a stale Python
    # reference made `obj is not donor_rig` true for the donor itself, which deleted the armature and
    # with it every skin and clip. Names are stable.
    donor_rig_name = donor_rig.name
    prop = re.compile(r"sword|shield|axe|spear|bow|quiver|arrow|dagger|crossbow|staff|wand|spellbook|icosphere", re.IGNORECASE)
    # Anything whose name is not in `before` arrived with the clip source; remove exactly those. The
    # name-set comparison previously spared the source's own helper Icosphere because the donor ships a
    # mesh of the same name, which then appeared in the export beside the fighter.
    for obj in [o for o in bpy.data.objects if o.name not in before]:
        bpy.data.objects.remove(obj, do_unlink=True)
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and prop.search(o.name)]:
        bpy.data.objects.remove(obj, do_unlink=True)
    donor_rig = bpy.data.objects.get(donor_rig_name)

    # ACTIONS mode exports EVERY action in the file, which pulled the donor's own 69 clips in beside the
    # 25 retargeted ones (126 animations). Keep only the clips this run authored, and drop the NLA tracks
    # that referenced them, so the export has exactly the expected set.
    if EXPORT_ACTIONS:
        keep = set(report.keys())
        if donor_rig.animation_data:
            for track in list(donor_rig.animation_data.nla_tracks):
                donor_rig.animation_data.nla_tracks.remove(track)
        for action in list(bpy.data.actions):
            if action.name not in keep:
                bpy.data.actions.remove(action)

    # glTF writes each joint's CURRENT pose transform into the node tree, so whatever pose the retarget
    # loop happened to stop on (last frame of the last clip, air_attack) became the file's rest pose.
    # That is why both feet sat 4.4 / 6.3 cm under the ground and disagreed by 1.9 cm even though every
    # leg bone and leg vertex is exactly symmetric, and why muting the NLA tracks changed nothing while
    # clearing the pose transforms put both feet back at 0.000. Clear the pose before exporting; the
    # clips live in their actions/NLA tracks and are unaffected.
    if donor_rig.animation_data:
        donor_rig.animation_data.action = None
    bpy.ops.object.select_all(action="DESELECT")
    donor_rig.select_set(True)
    bpy.context.view_layer.objects.active = donor_rig
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_animations=True,
        export_animation_mode=("ACTIONS" if EXPORT_ACTIONS else "NLA_TRACKS"),
        export_yup=True,
        # Write the BIND pose into the joint nodes. The leg bones and leg vertices are exactly
        # symmetric (foot head z equal to 4 dp, same lengths, same rest bounds), yet the export had
        # the left foot 4.4 cm and the right 6.3 cm below the ground: the file was carrying the pose
        # that happened to be active when the retarget loop stopped, not the rest pose.
        export_rest_position_armature=True,
    )
    print("RESULT:" + json.dumps({
        "ok": True,
        "out": OUT,
        "pairs": pairs,
        "mapCount": len(pairs),
        "clips": report,
        "donorBones": len(donor_names),
    }))


main()
