"""Author Infantry's six combat actions on the imported 24-joint skeleton and export them as clips.

The imported rig is a Mixamo-style hierarchy (Hips / Spine01-02 / Left|Right Arm chain / legs) whose
limb bones carry a rolled rest orientation, so bone-local Euler angles are not readable: +X on
`RightArm` is not "swing forward". Every pose below is therefore written in ARMATURE space and
converted per bone with

    Q_local = M_rest^-1 * R_armature * M_rest

which reproduces exactly that armature-space rotation for the bone (its parent's animated frame is
the reference, i.e. ordinary FK). Forward for this body is -Y, up is +Z, the character's right is -X.

    bash scripts/blender.sh -b --python assets/blender/infantry_combat_animations.py

Output: public/models/characters/roster_hd/infantry_combat.glb (clips only; source model untouched).

The same script authors clips for another fighter, reusing these poses on a compatible rig:

    bash scripts/blender.sh -b --python assets/blender/infantry_combat_animations.py -- \
        --source public/models/characters/roster_hd/naruto_cc0.glb \
        --out public/models/characters/roster_hd/naruto_combat.glb \
        --prefix Naruto_

See docs/INFANTRY_COMBAT_ANIMATION_PIPELINE.md for the rest of the wiring.
"""
import argparse
import math
import os
import sys

import bpy
from mathutils import Euler

GLB = "public/models/characters/roster_hd/infantry_cc0.glb"
OUT = "public/models/characters/roster_hd/infantry_combat.glb"
PREFIX = "Infantry_"
FPS = 24
CLIP_NAMES = [
    "Infantry_RifleButt",
    "Infantry_CombatCross",
    "Infantry_BootKick",
    "Infantry_ArmourBreaker",
    "Infantry_StockSlam",
    "Infantry_JumpKnee",
]

# A light fighting stance every clip starts and ends in, so a strike blends back into locomotion
# instead of snapping the body upright on the last frame.
STANCE = {
    "Hips": (0, 0, 0),
    "Spine02": (3, 0, 0),
    "Spine01": (3, 0, 0),
    "Spine": (2, 0, 0),
    "neck": (-3, 0, 0),
    "Head": (-2, 0, 0),
    "LeftShoulder": (0, 0, -3),
    "RightShoulder": (0, 0, 3),
    "LeftArm": (-14, -6, 0),
    "RightArm": (-16, 6, 0),
    "LeftForeArm": (-38, 0, 0),
    "RightForeArm": (-40, 0, 0),
    "LeftHand": (0, 0, 0),
    "RightHand": (0, 0, 0),
    "LeftUpLeg": (-5, 0, 0),
    "RightUpLeg": (-5, 0, 3),
    "LeftLeg": (11, 0, 0),
    "RightLeg": (12, 0, 0),
    "LeftFoot": (-5, 0, 0),
    "RightFoot": (-6, 0, 0),
}


def pose(**overrides):
    """Stance plus per-bone deltas, written the way an animator would describe the move."""
    out = {bone: tuple(rot) for bone, rot in STANCE.items()}
    for bone, rot in overrides.items():
        base = out.get(bone, (0, 0, 0))
        out[bone] = (base[0] + rot[0], base[1] + rot[1], base[2] + rot[2])
    return out


# --- the six attacks ----------------------------------------------------------------------
# Each entry: (frame, pose). Frames are at 24 fps, matching the source clips' scene rate.
CLIPS = {
    # Rifle butt: a short, blunt forward thrust with the weapon held in both hands.
    "Infantry_RifleButt": [
        (0, pose()),
        (2, pose(Hips=(0, 0, -9), Spine02=(-2, 0, -9), Spine01=(-2, 0, -8), Spine=(-1, 0, -6),
                 RightArm=(16, 4, 0), RightForeArm=(14, 0, 0), LeftArm=(10, -4, 0),
                 LeftForeArm=(10, 0, 0), LeftLeg=(6, 0, 0), RightLeg=(6, 0, 0))),
        (5, pose(Hips=(2, 0, 13), Spine02=(9, 0, 13), Spine01=(8, 0, 12), Spine=(6, 0, 10),
                 neck=(-4, 0, -6), RightArm=(-42, -6, 0), RightForeArm=(-26, 0, 0),
                 LeftArm=(-34, -2, 0), LeftForeArm=(-18, 0, 0), RightUpLeg=(-4, 0, 0))),
        (7, pose(Hips=(2, 0, 15), Spine02=(11, 0, 15), Spine01=(10, 0, 14), Spine=(7, 0, 12),
                 neck=(-5, 0, -7), RightArm=(-50, -8, 0), RightForeArm=(-18, 0, 0),
                 LeftArm=(-42, -3, 0), LeftForeArm=(-14, 0, 0), LeftLeg=(4, 0, 0))),
        (10, pose(Hips=(1, 0, 6), Spine02=(5, 0, 6), Spine01=(5, 0, 6), Spine=(3, 0, 5),
                  RightArm=(-20, -2, 0), RightForeArm=(-6, 0, 0), LeftArm=(-18, -2, 0))),
        (13, pose()),
    ],
    # Combat cross: the left hand drives a straight cross while the rifle stays in the right.
    "Infantry_CombatCross": [
        (0, pose()),
        (2, pose(Hips=(0, 0, 14), Spine02=(1, 0, 14), Spine01=(1, 0, 13), Spine=(0, 0, 11),
                 LeftShoulder=(0, 0, -8), LeftArm=(22, -10, 0), LeftForeArm=(30, 0, 0),
                 RightArm=(-6, 0, 0), RightForeArm=(-6, 0, 0), LeftUpLeg=(2, 0, 0))),
        (5, pose(Hips=(1, 0, -16), Spine02=(6, 0, -16), Spine01=(6, 0, -15), Spine=(4, 0, -12),
                 neck=(-3, 0, 8), LeftShoulder=(0, 0, 6), LeftArm=(-76, -4, 0),
                 LeftForeArm=(30, 0, 0), LeftHand=(0, 0, 0), RightArm=(6, 2, 0),
                 RightForeArm=(4, 0, 0), RightUpLeg=(-3, 0, 0))),
        (7, pose(Hips=(2, 0, -20), Spine02=(9, 0, -20), Spine01=(8, 0, -18), Spine=(5, 0, -15),
                 neck=(-4, 0, 10), LeftShoulder=(0, 0, 8), LeftArm=(-90, -2, 0),
                 LeftForeArm=(38, 0, 0), RightArm=(8, 3, 0), LeftLeg=(4, 0, 0))),
        (10, pose(Hips=(1, 0, -6), Spine02=(3, 0, -6), Spine01=(3, 0, -5), Spine=(2, 0, -4),
                  LeftArm=(-28, -4, 0), LeftForeArm=(0, 0, 0))),
        (13, pose()),
    ],
    # Boot kick: chamber the right knee, snap the shin out, recover onto both feet.
    "Infantry_BootKick": [
        (0, pose()),
        (3, pose(Hips=(0, 0, -10), Spine02=(-4, 0, -10), Spine01=(-4, 0, -9), Spine=(-3, 0, -7),
                 RightUpLeg=(-52, 0, 0), RightLeg=(78, 0, 0), RightFoot=(10, 0, 0),
                 LeftLeg=(10, 0, 0), LeftArm=(14, -6, 0), RightArm=(12, 6, 0),
                 LeftForeArm=(16, 0, 0), RightForeArm=(14, 0, 0))),
        (6, pose(Hips=(0, 0, 8), Spine02=(-8, 0, 8), Spine01=(-8, 0, 7), Spine=(-6, 0, 5),
                 neck=(4, 0, -4), RightUpLeg=(-66, 0, 0), RightLeg=(-72, 0, 0),
                 RightFoot=(-14, 0, 0), LeftLeg=(16, 0, 0), LeftUpLeg=(-4, 0, 0),
                 LeftArm=(20, -10, 0), RightArm=(18, 10, 0), LeftForeArm=(20, 0, 0))),
        (8, pose(Hips=(0, 0, 10), Spine02=(-10, 0, 10), Spine01=(-9, 0, 9), Spine=(-7, 0, 6),
                 RightUpLeg=(-70, 0, 0), RightLeg=(-80, 0, 0), RightFoot=(-16, 0, 0),
                 LeftLeg=(18, 0, 0), LeftArm=(22, -11, 0), RightArm=(20, 11, 0))),
        (11, pose(Hips=(0, 0, 2), Spine02=(-2, 0, 2), RightUpLeg=(-26, 0, 0), RightLeg=(24, 0, 0),
                  RightFoot=(4, 0, 0), LeftArm=(8, -4, 0), RightArm=(8, 4, 0))),
        (15, pose()),
    ],
    # Armour breaker: a wide, committed forward strike with the whole body behind it.
    "Infantry_ArmourBreaker": [
        (0, pose()),
        (4, pose(Hips=(-4, 0, -20), Spine02=(-8, 0, -20), Spine01=(-8, 0, -18), Spine=(-6, 0, -14),
                 neck=(2, 0, 10), RightShoulder=(0, 0, -6), RightArm=(34, 12, 0),
                 RightForeArm=(26, 0, 0), LeftArm=(26, -10, 0), LeftForeArm=(24, 0, 0),
                 LeftUpLeg=(-6, 0, 0), LeftLeg=(22, 0, 0), RightLeg=(24, 0, 0),
                 RightUpLeg=(-8, 0, 0))),
        (8, pose(Hips=(4, 0, 22), Spine02=(14, 0, 22), Spine01=(13, 0, 20), Spine=(10, 0, 16),
                 neck=(-6, 0, -10), RightShoulder=(0, 0, 8), RightArm=(-64, -6, 0),
                 RightForeArm=(-22, 0, 0), LeftArm=(-30, -4, 0), LeftForeArm=(-10, 0, 0),
                 LeftUpLeg=(-2, 0, 0), LeftLeg=(14, 0, 0), RightLeg=(16, 0, 0))),
        (10, pose(Hips=(5, 0, 26), Spine02=(17, 0, 26), Spine01=(15, 0, 23), Spine=(11, 0, 18),
                  neck=(-7, 0, -12), RightArm=(-72, -4, 0), RightForeArm=(-14, 0, 0),
                  LeftArm=(-36, -2, 0), LeftForeArm=(-6, 0, 0), LeftLeg=(16, 0, 0))),
        (14, pose(Hips=(2, 0, 8), Spine02=(6, 0, 8), Spine01=(6, 0, 7), Spine=(4, 0, 6),
                  RightArm=(-22, 0, 0), RightForeArm=(-4, 0, 0), LeftLeg=(8, 0, 0))),
        (18, pose()),
    ],
    # Stock slam: lift the rifle overhead, then drop the stock through the target with the hips.
    "Infantry_StockSlam": [
        (0, pose()),
        (5, pose(Hips=(-3, 0, -4), Spine02=(-12, 0, -4), Spine01=(-11, 0, -4), Spine=(-8, 0, -3),
                 neck=(6, 0, 0), RightArm=(-134, 8, 0), RightForeArm=(-30, 0, 0),
                 LeftArm=(-128, -8, 0), LeftForeArm=(-34, 0, 0), LeftLeg=(16, 0, 0),
                 RightLeg=(18, 0, 0), LeftUpLeg=(-4, 0, 0), RightUpLeg=(-6, 0, 0))),
        (7, pose(Hips=(-4, 0, -4), Spine02=(-16, 0, -4), Spine01=(-15, 0, -4), Spine=(-11, 0, -3),
                 neck=(8, 0, 0), RightArm=(-148, 10, 0), RightForeArm=(-38, 0, 0),
                 LeftArm=(-140, -10, 0), LeftForeArm=(-42, 0, 0), LeftLeg=(18, 0, 0),
                 RightLeg=(20, 0, 0))),
        (11, pose(Hips=(6, 0, 2), Spine02=(28, 0, 2), Spine01=(26, 0, 2), Spine=(20, 0, 1),
                  neck=(-14, 0, 0), RightArm=(-6, 2, 0), RightForeArm=(-6, 0, 0),
                  LeftArm=(-4, -2, 0), LeftForeArm=(-8, 0, 0), LeftLeg=(30, 0, 0),
                  RightLeg=(32, 0, 0), LeftUpLeg=(-10, 0, 0), RightUpLeg=(-12, 0, 0))),
        (13, pose(Hips=(7, 0, 2), Spine02=(32, 0, 2), Spine01=(29, 0, 2), Spine=(22, 0, 1),
                  neck=(-16, 0, 0), RightArm=(2, 2, 0), RightForeArm=(0, 0, 0),
                  LeftArm=(2, -2, 0), LeftForeArm=(0, 0, 0), LeftLeg=(32, 0, 0),
                  RightLeg=(34, 0, 0), LeftUpLeg=(-11, 0, 0), RightUpLeg=(-13, 0, 0))),
        (17, pose(Hips=(2, 0, 0), Spine02=(10, 0, 0), Spine01=(9, 0, 0), Spine=(7, 0, 0),
                  RightArm=(-22, 0, 0), LeftArm=(-20, 0, 0), LeftLeg=(16, 0, 0),
                  RightLeg=(18, 0, 0))),
        (21, pose()),
    ],
    # Jump knee: the aerial attack — knee driven up, torso folded over it, leg extending to land.
    "Infantry_JumpKnee": [
        (0, pose(Hips=(-4, 0, -5), Spine02=(6, 0, 0), LeftUpLeg=(-10, 0, 0), RightUpLeg=(-10, 0, 0),
                 LeftLeg=(16, 0, 0), RightLeg=(16, 0, 0))),
        (3, pose(Hips=(-17, 0, -12), Spine02=(16, 0, 0), Spine01=(14, 0, 0), Spine=(10, 0, 0),
                 neck=(-6, 0, 0), RightUpLeg=(-84, 0, 0), RightLeg=(96, 0, 0),
                 RightFoot=(12, 0, 0), LeftUpLeg=(-18, 0, 0), LeftLeg=(48, 0, 0),
                 LeftFoot=(8, 0, 0), LeftArm=(26, -10, 0), RightArm=(22, 8, 0),
                 LeftForeArm=(18, 0, 0), RightForeArm=(16, 0, 0))),
        (5, pose(Hips=(-21, 0, -15), Spine02=(20, 0, 0), Spine01=(17, 0, 0), Spine=(12, 0, 0),
                 neck=(-8, 0, 0), RightUpLeg=(-96, 0, 0), RightLeg=(112, 0, 0),
                 RightFoot=(14, 0, 0), LeftUpLeg=(-20, 0, 0), LeftLeg=(54, 0, 0),
                 LeftArm=(30, -12, 0), RightArm=(26, 10, 0))),
        (8, pose(Hips=(-9, 0, -6), Spine02=(10, 0, 0), Spine01=(9, 0, 0), Spine=(6, 0, 0),
                 RightUpLeg=(-44, 0, 0), RightLeg=(40, 0, 0), LeftUpLeg=(-12, 0, 0),
                 LeftLeg=(26, 0, 0), LeftArm=(12, -4, 0), RightArm=(10, 4, 0))),
        (12, pose(Hips=(-2, 0, 0), Spine02=(4, 0, 0), RightUpLeg=(-12, 0, 0), RightLeg=(16, 0, 0),
                  LeftUpLeg=(-10, 0, 0), LeftLeg=(16, 0, 0))),
    ],
}


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def parse_args():
    """Blender passes its own argv; everything after `--` belongs to this script."""
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(description="Author combat clips on an imported fighter rig.")
    parser.add_argument("--source", default=GLB, help="source GLB carrying the rig to author on")
    parser.add_argument("--out", default=OUT, help="clip-only GLB to write")
    parser.add_argument("--prefix", default=PREFIX, help="clip name prefix, e.g. Naruto_")
    return parser.parse_args(argv)


def import_model(source):
    bpy.ops.import_scene.gltf(filepath=source)
    armature = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    bpy.context.view_layer.objects.active = armature
    return armature


def apply_pose(armature, rotations, frame):
    """Write one armature-space pose at `frame` and key every animated bone."""
    for bone_name, (rx, ry, rz) in rotations.items():
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            raise SystemExit("rig has no bone named " + bone_name)
        rest = pose_bone.bone.matrix_local.to_3x3()
        armature_rotation = Euler(
            (math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ"
        ).to_matrix()
        local = (rest.inverted() @ armature_rotation @ rest).to_quaternion()
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = local
        pose_bone.keyframe_insert("rotation_quaternion", frame=frame)


def clip_name(name, prefix):
    """Retarget the authored clip names onto the fighter being exported (Infantry_ -> prefix)."""
    suffix = name[len("Infantry_"):] if name.startswith("Infantry_") else name
    return prefix + suffix


def build_actions(armature, prefix):
    scene = bpy.context.scene
    scene.render.fps = FPS
    armature.animation_data_create()
    actions = []
    for name, keys in CLIPS.items():
        action = bpy.data.actions.new(clip_name(name, prefix))
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, rotations in keys:
            apply_pose(armature, rotations, frame)
        for fcurve in action.fcurves:
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "BEZIER"
                keyframe.handle_left_type = "AUTO_CLAMPED"
                keyframe.handle_right_type = "AUTO_CLAMPED"
        # A loop-free action needs an explicit range, otherwise the exporter guesses from the
        # first and last key of whichever bone it happens to visit.
        action.frame_start = keys[0][0]
        action.frame_end = keys[-1][0]
        actions.append(action)
    armature.animation_data.action = None
    return actions


def to_nla(armature, actions):
    """One NLA track per action, named exactly as the clip, so the exporter emits six clips."""
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
    """The clip asset carries bones and motion only: the 13 MB body keeps living in its own file."""
    for obj in list(bpy.data.objects):
        if obj.type != "ARMATURE":
            bpy.data.objects.remove(obj, do_unlink=True)


def export(armature, out):
    os.makedirs(os.path.dirname(out), exist_ok=True)
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


def main():
    args = parse_args()
    clear_scene()
    armature = import_model(args.source)
    actions = build_actions(armature, args.prefix)
    to_nla(armature, actions)
    drop_geometry()
    export(armature, args.out)
    print("ACTIONS " + ", ".join(a.name + ":" + str((a.frame_start, a.frame_end)) for a in actions))


main()
