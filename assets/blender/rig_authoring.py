"""Shared armature-space authoring helpers for imported fighter rigs.

Extracted from the Infantry attack pipeline, which proved the one non-obvious piece: an imported
limb bone carries a rolled rest orientation, so bone-local Euler angles are not readable. Every
pose is authored in ARMATURE space and converted per bone with

    Q_local = M_rest^-1 * R_armature * M_rest

which reproduces that armature-space rotation for the bone relative to its animated parent
(ordinary FK). That is rig-agnostic: the roll, the parent chain and the bone lengths belong to the
rig, while the authored numbers stay readable (-Y forward, +Z up).

Used by:
    assets/blender/reaction_animations.py     (idle / jump / land / hit / KO / recovery / victory)
    assets/blender/infantry_combat_animations.py  (the six attacks, unchanged behaviour)

Nothing here writes to a source GLB: geometry is dropped and only the armature plus its clips are
exported.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Euler

FPS = 24

# Canonical bone vocabulary the pose tables are written in. Any humanoid rig can be driven if its
# joints can be mapped onto these names.
CANONICAL = [
    "Hips", "Spine", "Spine01", "Spine02", "neck", "Head",
    "LeftShoulder", "RightShoulder",
    "LeftArm", "RightArm", "LeftForeArm", "RightForeArm", "LeftHand", "RightHand",
    "LeftUpLeg", "RightUpLeg", "LeftLeg", "RightLeg",
    "LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase",
]

# The Grab3D / Mixamo-style soldier already uses the canonical names.
MIXAMO_MAP = {name: name for name in CANONICAL}

# This repository's 19-bone roster armature. It has one spine bone and no toe bones, so the
# canonical slots that do not exist are aliased onto the nearest real joint. Pose tables authored
# for this adapter must not use Spine01/Spine02/toe slots; the aliases exist only so the map is
# complete and a missing joint cannot be mistaken for a rig failure.
ROSTER19_MAP = {
    "Hips": "Hips",
    "Spine": "Spine",
    "Spine01": "Spine",
    "Spine02": "Chest",
    "Chest": "Chest",
    "neck": "Neck",
    "Neck": "Neck",
    "Head": "Head",
    "LeftShoulder": "LeftShoulder",
    "RightShoulder": "RightShoulder",
    "LeftArm": "LeftArm",
    "RightArm": "RightArm",
    "LeftForeArm": "LeftForeArm",
    "RightForeArm": "RightForeArm",
    "LeftHand": "LeftHand",
    "RightHand": "RightHand",
    "LeftUpLeg": "LeftUpLeg",
    "RightUpLeg": "RightUpLeg",
    "LeftLeg": "LeftLeg",
    "RightLeg": "RightLeg",
    "LeftFoot": "LeftFoot",
    "RightFoot": "RightFoot",
    "LeftToeBase": "LeftFoot",
    "RightToeBase": "RightFoot",
}

# Rigify's deform chain, as used by the imported Naruto body (567 bones incl. controls and widgets).
# Candidates are tried in order so a rig that lacks a toe bone still resolves the foot.
RIGIFY_CANDIDATES = {
    "Hips": ["DEF-spine", "hips"],
    "Spine": ["DEF-spine.001"],
    "Spine01": ["DEF-spine.002"],
    "Spine02": ["DEF-spine.003"],
    "neck": ["DEF-spine.004", "DEF-neck"],
    "Head": ["DEF-spine.005", "DEF-head"],
    "LeftShoulder": ["DEF-shoulder.L"],
    "RightShoulder": ["DEF-shoulder.R"],
    "LeftArm": ["DEF-upper_arm.L"],
    "RightArm": ["DEF-upper_arm.R"],
    "LeftForeArm": ["DEF-forearm.L"],
    "RightForeArm": ["DEF-forearm.R"],
    "LeftHand": ["DEF-hand.L"],
    "RightHand": ["DEF-hand.R"],
    "LeftUpLeg": ["DEF-thigh.L"],
    "RightUpLeg": ["DEF-thigh.R"],
    "LeftLeg": ["DEF-shin.L"],
    "RightLeg": ["DEF-shin.R"],
    "LeftFoot": ["DEF-foot.L"],
    "RightFoot": ["DEF-foot.R"],
    "LeftToeBase": ["DEF-toe.L"],
    "RightToeBase": ["DEF-toe.R"],
}

RIGS = {"mixamo": MIXAMO_MAP, "rigify": RIGIFY_CANDIDATES, "roster19": ROSTER19_MAP}


def _resolve(armature, canonical, candidates):
    if isinstance(candidates, str):
        candidates = [candidates]
    for name in candidates:
        if armature.pose.bones.get(name):
            return name
    return None


def resolve_bone_map(armature, rig="mixamo", overrides=None):
    """Canonical name -> this rig's actual bone name. Fails loudly, with the missing list."""
    table = RIGS.get(rig)
    if table is None:
        raise SystemExit("unknown rig adapter: " + rig + " (known: " + ", ".join(RIGS) + ")")
    mapping = {}
    missing = []
    for canonical in CANONICAL:
        candidates = (overrides or {}).get(canonical) or table[canonical]
        resolved = _resolve(armature, canonical, candidates)
        if resolved:
            mapping[canonical] = resolved
        else:
            missing.append(canonical + " <- " + ",".join(candidates if isinstance(candidates, list) else [candidates]))
    if missing:
        raise SystemExit("rig is missing canonical bones:\n  " + "\n  ".join(missing))
    # Adapter-specific vocabulary: the roster19 rig's Chest is a real joint used by the bespoke
    # tables, but it is not part of the shared canonical set (which keeps Mixamo/Rigify reversible).
    # Resolve any extra entries the chosen adapter declares, without requiring them everywhere else.
    for canonical, candidates in table.items():
        if canonical in mapping:
            continue
        resolved = _resolve(armature, canonical, candidates)
        if resolved:
            mapping[canonical] = resolved
    return mapping


def import_model(source):
    """Import the source GLB and return its armature. The source file is only read."""
    bpy.ops.import_scene.gltf(filepath=source)
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bpy.context.view_layer.objects.active = armature
    return armature


def apply_pose(armature, rotations, frame, bone_map):
    """Write one armature-space pose at `frame` and key every animated bone."""
    for canonical, (rx, ry, rz) in rotations.items():
        bone_name = bone_map.get(canonical)
        if not bone_name:
            raise SystemExit("no mapping for canonical bone " + canonical)
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            raise SystemExit("rig has no bone named " + bone_name + " (for " + canonical + ")")
        rest = pose_bone.bone.matrix_local.to_3x3()
        armature_rotation = Euler(
            (math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ"
        ).to_matrix()
        local = (rest.inverted() @ armature_rotation @ rest).to_quaternion()
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = local
        pose_bone.keyframe_insert("rotation_quaternion", frame=frame)


def build_actions(armature, clips, prefix, bone_map):
    """One action per clip, keyed with BEZIER/AUTO_CLAMPED and given an explicit range."""
    scene = bpy.context.scene
    scene.render.fps = FPS
    armature.animation_data_create()
    actions = []
    for name, keys in clips.items():
        action = bpy.data.actions.new(prefix + name)
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, rotations in keys:
            apply_pose(armature, rotations, frame, bone_map)
        for fcurve in action.fcurves:
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "BEZIER"
                keyframe.handle_left_type = "AUTO_CLAMPED"
                keyframe.handle_right_type = "AUTO_CLAMPED"
        action.frame_start = keys[0][0]
        action.frame_end = keys[-1][0]
        actions.append(action)
    armature.animation_data.action = None
    return actions


def to_nla(armature, actions):
    """One NLA track per action, named exactly like the clip, so NLA_TRACKS export emits them all."""
    animation_data = armature.animation_data
    for track in list(animation_data.nla_tracks):
        animation_data.nla_tracks.remove(track)
    for action in actions:
        track = animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_start), action)
        strip.name = action.name
        strip.blend_type = "REPLACE"
        track.mute = True
    for track in animation_data.nla_tracks:
        track.mute = True


def drop_geometry():
    """Clip assets carry bones and motion only; the body and its textures stay in their own file."""
    for obj in list(bpy.data.objects):
        if obj.type != "ARMATURE":
            bpy.data.objects.remove(obj, do_unlink=True)


def export(armature, out):
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_bake_animation=False,
        export_anim_single_armature=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="NONE",
    )
    print("EXPORTED " + out + " (" + str(os.path.getsize(out)) + " bytes)")


def parse_args(description, default_source, default_out, default_prefix):
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--source", default=default_source)
    parser.add_argument("--out", default=default_out)
    parser.add_argument("--prefix", default=default_prefix)
    parser.add_argument("--rig", default="mixamo", choices=sorted(RIGS))
    parser.add_argument("--bones", default=None, help="optional JSON canonical -> bone overrides")
    return parser.parse_args(argv)


def bone_overrides(path):
    if not path:
        return None
    import json
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)
