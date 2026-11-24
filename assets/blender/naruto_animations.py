"""Author Naruto's gameplay clips on his own imported 567-bone Rigify rig and export the body with them.

The rig is the one that arrived with the creator's FBX: a Rigify deform chain (DEF-spine…DEF-hand,
DEF-thigh…DEF-foot) whose limb rest axes are rolled, so bone-local Euler angles are unreadable. Like
the Infantry pipeline, every pose is written in ARMATURE space and converted per bone with

    Q_local = M_rest^-1 * R_armature * M_rest

which reproduces that armature-space rotation relative to the bone's animated parent (ordinary FK).
Naruto faces -Y, up is +Z, his left is +X, so: thigh forward = -X, knee bend = +X, left arm forward
= -Z, right arm forward = +Z, left arm down = +Y, right arm down = -Y.

    bash scripts/blender.sh -b --python assets/blender/naruto_animations.py

Output: public/models/characters/naruto_uzumaki/naruto_uzumaki.glb — the same body and textures the
extraction script produces, plus one clip per gameplay state. No root displacement: the game owns
position, so locomotion clips animate limbs only.
"""
import math
import os
import sys

import bpy
from mathutils import Euler

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import naruto_from_fbx as base  # noqa: E402

FPS = 24

# Friendly pose keys -> the rig's actual deform bones.
BONES = {
    "hips": "DEF-spine",
    "spine1": "DEF-spine.001",
    "spine2": "DEF-spine.002",
    "chest": "DEF-spine.003",
    "neck": "DEF-spine.004",
    "head": "DEF-spine.005",
    "shoulderL": "DEF-shoulder.L",
    "shoulderR": "DEF-shoulder.R",
    "armL": "DEF-upper_arm.L",
    "armR": "DEF-upper_arm.R",
    "foreL": "DEF-forearm.L",
    "foreR": "DEF-forearm.R",
    "handL": "DEF-hand.L",
    "handR": "DEF-hand.R",
    "legL": "DEF-thigh.L",
    "legR": "DEF-thigh.R",
    "shinL": "DEF-shin.L",
    "shinR": "DEF-shin.R",
    "footL": "DEF-foot.L",
    "footR": "DEF-foot.R",
}

# Relaxed fighting stance: arms down and slightly forward with bent elbows, knees soft. Every clip
# starts and ends here so a state change blends instead of snapping the body upright.
STANCE = {
    "hips": (0, 0, 0),
    "spine1": (2, 0, 0),
    "spine2": (2, 0, 0),
    "chest": (1, 0, 0),
    "neck": (-3, 0, 0),
    "head": (-2, 0, 0),
    "shoulderL": (0, 0, -3),
    "shoulderR": (0, 0, 3),
    "armL": (0, 62, -8),
    "armR": (0, -62, 8),
    "foreL": (0, 0, -30),
    "foreR": (0, 0, 30),
    "handL": (0, 0, 0),
    "handR": (0, 0, 0),
    "legL": (-4, 0, 0),
    "legR": (-4, 0, 0),
    "shinL": (8, 0, 0),
    "shinR": (8, 0, 0),
    "footL": (-4, 0, 0),
    "footR": (-4, 0, 0),
}


def arm(side, forward=0, down=62, flex=30):
    """forward = degrees the arm swings toward -Y; down = degrees below horizontal; flex = elbow."""
    sign = 1 if side == "L" else -1
    return {
        "arm" + side: (0, sign * down, -sign * forward),
        "fore" + side: (0, 0, -sign * flex),
    }


def leg(side, lift=4, bend=8, foot=-4):
    """lift = degrees the knee drives forward; bend = knee flex; foot = ankle pitch."""
    return {
        "leg" + side: (-lift, 0, 0),
        "shin" + side: (bend, 0, 0),
        "foot" + side: (foot, 0, 0),
    }


def pose(*parts, **overrides):
    out = dict(STANCE)
    for part in parts:
        out.update(part)
    out.update(overrides)
    return out


# --- the clips -------------------------------------------------------------------------------
# (frame, pose) pairs at 24 fps. Names match the baked aliases in anim/animation_manifest.js, so the
# legacy mixer binds each gameplay state to its own motion instead of one clip for everything.
CLIPS = {
    "idle": [
        (0, pose()),
        (18, pose(chest=(2, 0, 0), spine2=(3, 0, 0), head=(-1, 0, 0), **arm("L", 2, 60, 34), **arm("R", 2, 60, 34))),
        (36, pose()),
        (54, pose(hips=(0, 0, 2), head=(0, 0, -3), **arm("L", 0, 63, 26), **arm("R", 0, 63, 26))),
        (72, pose()),
    ],
    "walk": [
        (0, pose(arm("L", -20), arm("R", 20), leg("L", 26, 10), leg("R", -18, 28))),
        (8, pose(arm("L", 0, 62, 34), arm("R", 0, 62, 34), leg("L", 4, 30), leg("R", 10, 46), hips=(0, 0, 3))),
        (16, pose(arm("L", 20), arm("R", -20), leg("L", -18, 28), leg("R", 26, 10))),
        (24, pose(arm("L", 0, 62, 34), arm("R", 0, 62, 34), leg("L", 10, 46), leg("R", 4, 30), hips=(0, 0, -3))),
        (32, pose(arm("L", -20), arm("R", 20), leg("L", 26, 10), leg("R", -18, 28))),
    ],
    "run": [
        (0, pose(spine1=(14, 0, 0), spine2=(10, 0, 0), chest=(4, 0, 0),
                 **arm("L", -40, 55, 70), **arm("R", 45, 50, 80), **leg("L", 40, 20), **leg("R", -25, 50))),
        (6, pose(spine1=(14, 0, 0), spine2=(10, 0, 0), hips=(0, 0, 4),
                 **arm("L", 0, 55, 75), **arm("R", 0, 55, 75), **leg("L", 15, 60), **leg("R", 15, 85))),
        (12, pose(spine1=(14, 0, 0), spine2=(10, 0, 0), chest=(4, 0, 0),
                  **arm("L", 45, 50, 80), **arm("R", -40, 55, 70), **leg("L", -25, 50), **leg("R", 40, 20))),
        (18, pose(spine1=(14, 0, 0), spine2=(10, 0, 0), hips=(0, 0, -4),
                  **arm("L", 0, 55, 75), **arm("R", 0, 55, 75), **leg("L", 15, 85), **leg("R", 15, 60))),
        (24, pose(spine1=(14, 0, 0), spine2=(10, 0, 0), chest=(4, 0, 0),
                  **arm("L", -40, 55, 70), **arm("R", 45, 50, 80), **leg("L", 40, 20), **leg("R", -25, 50))),
    ],
    "jump": [
        (0, pose(spine1=(10, 0, 0), **leg("L", -30, 55), **leg("R", -30, 55),
                 **arm("L", -30, 70, 40), **arm("R", -30, 70, 40))),
        (6, pose(spine1=(-6, 0, 0), **leg("L", 5, 5), **leg("R", 5, 5),
                 **arm("L", 10, 20, 10), **arm("R", 10, 20, 10))),
        (14, pose(**leg("L", 30, 50), **leg("R", 20, 40), **arm("L", -20, 10, 20), **arm("R", -20, 10, 20))),
        (18, pose(**leg("L", 20, 40), **leg("R", 15, 35), **arm("L", -15, 25, 25), **arm("R", -15, 25, 25))),
    ],
    "fall": [
        (0, pose(spine1=(-8, 0, 0), head=(6, 0, 0), **arm("L", -15, -10, 25), **arm("R", -15, -10, 25),
                 **leg("L", 20, 30), **leg("R", 10, 45))),
        (16, pose(spine1=(-4, 0, 0), **arm("L", 10, -15, 20), **arm("R", 10, -15, 20),
                  **leg("L", 25, 20), **leg("R", 15, 55))),
    ],
    "land": [
        (0, pose(spine1=(14, 0, 0), **leg("L", 20, 45), **leg("R", 20, 45),
                 **arm("L", -25, 40, 50), **arm("R", -25, 40, 50))),
        (4, pose(spine1=(18, 0, 0), head=(-8, 0, 0), **leg("L", 12, 55), **leg("R", 12, 55),
                 **arm("L", -10, 45, 60), **arm("R", -10, 45, 60))),
        (14, pose()),
    ],
    "jab": [
        (0, pose(**arm("L", 10, 62, 70), **arm("R", 30, 58, 80))),
        (3, pose(hips=(0, 0, -6), spine1=(4, 0, 0), **arm("L", -10, 62, 80), **arm("R", 35, 58, 85))),
        (6, pose(hips=(0, 0, 10), spine1=(6, 0, -10), head=(-2, 0, 4),
                 **arm("L", 85, 10, 6), **arm("R", 20, 60, 85))),
        (8, pose(hips=(0, 0, 10), spine1=(6, 0, -10), **arm("L", 82, 12, 8), **arm("R", 20, 60, 85))),
        (12, pose(**arm("L", 10, 58, 70), **arm("R", 30, 58, 80))),
    ],
    "heavy_punch": [
        (0, pose(**arm("L", 20, 60, 80), **arm("R", 10, 60, 70))),
        (5, pose(hips=(0, 0, 18), spine1=(0, 0, 14), head=(0, 0, -6),
                 **arm("L", 30, 58, 85), **arm("R", -30, 60, 90))),
        (10, pose(hips=(0, 0, -16), spine1=(8, 0, -12), head=(-2, 0, 6),
                  **arm("L", 20, 60, 80), **arm("R", 95, 6, 5))),
        (13, pose(hips=(0, 0, -18), spine1=(9, 0, -13), **arm("L", 20, 60, 80), **arm("R", 98, 8, 6))),
        (20, pose(**arm("L", 20, 60, 80), **arm("R", 10, 60, 70))),
    ],
    "front_kick": [
        (0, pose(**arm("L", 25, 58, 70), **arm("R", 20, 60, 75))),
        (6, pose(spine1=(-6, 0, 0), **leg("R", 55, 75, 10), **arm("L", 10, 55, 60), **arm("R", -10, 55, 50))),
        (12, pose(spine1=(-12, 0, 0), hips=(0, 0, 6), **leg("R", 80, 10, -10),
                  **arm("L", -20, 50, 60), **arm("R", 25, 55, 40))),
        (15, pose(spine1=(-13, 0, 0), **leg("R", 82, 8, -12), **arm("L", -22, 50, 60), **arm("R", 26, 55, 40))),
        (18, pose()),
    ],
    "spinning_kick": [
        (0, pose(**arm("L", 20, 60, 70), **arm("R", 15, 60, 70))),
        (6, pose(hips=(0, 0, 35), spine1=(0, 0, 20), **leg("L", 30, 60), **leg("R", -10, 30),
                 **arm("L", -30, 50, 40), **arm("R", 40, 50, 60))),
        (12, pose(hips=(0, 0, 80), spine1=(0, 0, 35), **leg("R", 70, 15, -10), **leg("L", -15, 25),
                  **arm("L", -50, 40, 30), **arm("R", 60, 40, 20))),
        (16, pose(hips=(0, 0, 95), spine1=(0, 0, 38), **leg("R", 72, 12, -12), **leg("L", -18, 28),
                  **arm("L", -55, 40, 30), **arm("R", 62, 40, 20))),
        (24, pose()),
    ],
    "hit_light": [
        (0, pose()),
        (3, pose(spine1=(-8, 0, 0), spine2=(-6, 0, 0), chest=(-4, 0, 0), head=(10, 0, 10),
                 **arm("L", -10, 55, 60), **arm("R", -10, 55, 60), **leg("L", -2, 12), **leg("R", -6, 16))),
        (10, pose(spine1=(-2, 0, 0), head=(3, 0, 3))),
    ],
    "hit_heavy": [
        (0, pose()),
        (4, pose(spine1=(-16, 0, 0), spine2=(-12, 0, 0), chest=(-8, 0, 0), head=(16, 0, 14),
                 **arm("L", -30, 45, 50), **arm("R", -30, 45, 50), **leg("L", -12, 26), **leg("R", -14, 30))),
        (12, pose(spine1=(-10, 0, 0), head=(8, 0, 6), **leg("R", 14, 40), **leg("L", -6, 20))),
        (24, pose()),
    ],
    "knockdown": [
        (0, pose()),
        (6, pose(spine1=(-22, 0, 0), spine2=(-16, 0, 0), chest=(-10, 0, 0), head=(20, 0, 10),
                 **arm("L", -40, 35, 40), **arm("R", -40, 35, 40), **leg("L", -20, 50), **leg("R", -24, 60))),
        (16, pose(spine1=(-34, 0, 0), spine2=(-22, 0, 0), head=(24, 0, 0),
                  **leg("L", 45, 80), **leg("R", 50, 85), **arm("L", -50, 25, 30), **arm("R", -50, 25, 30))),
        (28, pose(spine1=(-20, 0, 0), spine2=(-10, 0, 0), **leg("L", 25, 60), **leg("R", 30, 65),
                  **arm("L", -20, 40, 40), **arm("R", -20, 40, 40))),
    ],
    "block": [
        (0, pose(spine1=(4, 0, 0), head=(-4, 0, 0), **arm("L", 45, 45, 95), **arm("R", 45, 45, 95))),
        (12, pose(spine1=(5, 0, 0), head=(-5, 0, 0), **arm("L", 48, 43, 98), **arm("R", 48, 43, 98))),
    ],
    "victory": [
        (0, pose()),
        (12, pose(spine1=(-6, 0, 0), head=(-6, 0, 0), **leg("L", -8, 20), **leg("R", -8, 20),
                  **arm("L", 20, 30, 60), **arm("R", 20, 30, 60))),
        (24, pose(spine1=(-10, 0, 0), head=(-10, 0, 0), **leg("L", -6, 10), **leg("R", -6, 10),
                  **arm("L", 10, 60, 50), **arm("R", -5, -40, 20))),
        (32, pose(spine1=(-12, 0, 0), head=(-12, 0, 0), **arm("L", 10, 60, 50), **arm("R", -5, -45, 15))),
        (40, pose(spine1=(-10, 0, 0), head=(-8, 0, 0), **arm("L", 10, 60, 50), **arm("R", 0, -40, 20))),
    ],
    "defeat": [
        (0, pose()),
        (14, pose(spine1=(22, 0, 0), spine2=(14, 0, 0), chest=(8, 0, 0), head=(18, 0, 0),
                  **leg("L", -25, 60), **leg("R", -25, 60), **arm("L", 10, 75, 20), **arm("R", 10, 75, 20))),
        (36, pose(spine1=(30, 0, 0), spine2=(18, 0, 0), head=(24, 0, 0),
                  **leg("L", -35, 75), **leg("R", -35, 75), **arm("L", 20, 80, 10), **arm("R", 20, 80, 10))),
    ],
    "rasengan": [
        (0, pose()),
        (8, pose(hips=(0, 0, 20), spine1=(0, 0, 14), head=(0, 0, -8), **leg("R", 6, 30), **leg("L", -10, 20),
                 **arm("R", -40, 50, 60), **arm("L", 15, 60, 60))),
        (16, pose(hips=(0, 0, 10), spine1=(0, 0, 8), **arm("R", 30, 30, 90), **arm("L", 20, 55, 70))),
        (28, pose(hips=(0, 0, -20), spine1=(10, 0, -16), head=(-2, 0, 8), **leg("R", 30, 20), **leg("L", -10, 25),
                  **arm("R", 95, 5, 5), **arm("L", -25, 55, 50))),
        (34, pose(hips=(0, 0, -22), spine1=(11, 0, -17), **arm("R", 98, 6, 4), **arm("L", -28, 55, 50))),
        (40, pose()),
    ],
    "shadow_clone": [
        (0, pose()),
        (6, pose(spine1=(8, 0, 0), head=(4, 0, 0), **arm("L", 60, 35, 110), **arm("R", 60, 35, 110))),
        (14, pose(spine1=(10, 0, 0), head=(6, 0, 0), **arm("L", 70, 30, 120), **arm("R", 70, 30, 120))),
        (22, pose(spine1=(-4, 0, 0), head=(-4, 0, 0), **arm("L", 10, 20, 40), **arm("R", 10, 20, 40))),
        (28, pose()),
    ],
    "transformation": [
        (0, pose()),
        (8, pose(spine1=(16, 0, 0), head=(10, 0, 0), **leg("L", -20, 45), **leg("R", -20, 45),
                 **arm("L", -30, 65, 70), **arm("R", -30, 65, 70))),
        (16, pose(spine1=(10, 0, 0), head=(-4, 0, 0), **leg("L", -14, 35), **leg("R", -14, 35),
                  **arm("L", -10, 50, 90), **arm("R", -10, 50, 90))),
        (24, pose(spine1=(-14, 0, 0), head=(-14, 0, 0), **leg("L", -4, 10), **leg("R", -4, 10),
                  **arm("L", -20, 10, 25), **arm("R", -20, 10, 25))),
        (30, pose(spine1=(-16, 0, 0), head=(-16, 0, 0), **arm("L", -24, 4, 18), **arm("R", -24, 4, 18))),
        (36, pose()),
    ],
}


def apply_pose(armature, rotations, frame):
    for friendly, (rx, ry, rz) in rotations.items():
        bone_name = BONES[friendly]
        pose_bone = armature.pose.bones.get(bone_name)
        if pose_bone is None:
            raise SystemExit("rig has no bone named " + bone_name)
        rest = pose_bone.bone.matrix_local.to_3x3()
        rotation = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_matrix()
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (rest.inverted() @ rotation @ rest).to_quaternion()
        pose_bone.keyframe_insert("rotation_quaternion", frame=frame)


def build(armature):
    scene = bpy.context.scene
    scene.render.fps = FPS
    armature.animation_data_create()
    actions = []
    for name, keys in CLIPS.items():
        action = bpy.data.actions.new(name)
        action.use_fake_user = True
        armature.animation_data.action = action
        for frame, rotations in keys:
            apply_pose(armature, rotations, frame)
        for fcurve in action.fcurves:
            for keyframe in fcurve.keyframe_points:
                keyframe.interpolation = "BEZIER"
                keyframe.handle_left_type = "AUTO_CLAMPED"
                keyframe.handle_right_type = "AUTO_CLAMPED"
        # A non-looping clip needs an explicit range or the exporter guesses from whichever bone it
        # visits first, which silently truncates long clips like victory and defeat.
        action.frame_start = keys[0][0]
        action.frame_end = keys[-1][0]
        actions.append(action)
    armature.animation_data.action = None
    return actions


def to_nla(armature, actions):
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


def main():
    base.clear()
    naruto, rig = base.import_and_split()
    restored = base.restore_textures(naruto.data)
    base.strip_outline(naruto)
    base.normalise_scale(naruto, rig)
    actions = build(rig)
    to_nla(rig, actions)
    base.export(naruto, rig)
    print("TEXTURES " + ",".join(name for name, _, size in restored if size[0]))
    print("CLIPS " + ", ".join(a.name + ":" + str(int(a.frame_end - a.frame_start) + 1) + "f" for a in actions))
    print("TOTAL %d clips, %d bytes" % (len(actions), os.path.getsize(base.OUT)))


main()
