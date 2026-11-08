"""Author reaction clips (idle, jump, land, hit, knockback, KO, recovery, victory) on any imported rig.

    bash scripts/blender.sh -b --python assets/blender/reaction_animations.py
    bash scripts/blender.sh -b --python assets/blender/reaction_animations.py -- \
        --source public/models/characters/naruto_uzumaki/naruto_uzumaki.glb \
        --out public/models/characters/naruto_uzumaki/naruto_reactions.glb \
        --prefix Naruto_ --rig rigify

Output defaults to public/models/characters/roster_hd/infantry_reactions.glb: a clip-only GLB,
exported from the imported body's own skeleton. The source model is never written.

Poses are armature space (-Y forward, +Z up, character right -X) and converted per bone by
`rig_authoring.apply_pose`, so a rolled rest orientation cannot turn a readable pose into a
different move. Clip names are lower-case suffixes after the prefix, matching the runtime's state
lookup (`hit_light`, `hit_heavy`, `knockdown`, `get_up`, `victory`, `defeat`, `idle`, `jump`,
`land`).

Authoring rules, same as the attack pass:
  * anticipation -> contact -> follow-through -> recovery, whole body involved;
  * no root displacement (the game owns position) and no floor penetration;
  * every clip starts and ends near the shared stance so it blends instead of snapping.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import rig_authoring as ra

DEFAULT_SOURCE = "public/models/characters/roster_hd/infantry_cc0.glb"
DEFAULT_OUT = "public/models/characters/roster_hd/infantry_reactions.glb"
DEFAULT_PREFIX = "Infantry_"

# A neutral, slightly ready stance: knees soft, arms heavy at the sides, weight even.
STANCE = {
    "Hips": (0, 0, 0),
    "Spine": (2, 0, 0), "Spine01": (3, 0, 0), "Spine02": (3, 0, 0),
    "neck": (-2, 0, 0), "Head": (-2, 0, 0),
    "LeftShoulder": (0, 0, -3), "RightShoulder": (0, 0, 3),
    "LeftArm": (-12, -5, 0), "RightArm": (-13, 5, 0),
    "LeftForeArm": (-30, 0, 0), "RightForeArm": (-32, 0, 0),
    "LeftHand": (0, 0, 0), "RightHand": (0, 0, 0),
    "LeftUpLeg": (-4, 0, 0), "RightUpLeg": (-4, 0, 0),
    "LeftLeg": (10, 0, 0), "RightLeg": (10, 0, 0),
    "LeftFoot": (-5, 0, 0), "RightFoot": (-5, 0, 0),
}


def pose(**overrides):
    out = {bone: tuple(rot) for bone, rot in STANCE.items()}
    for bone, rot in overrides.items():
        base = out.get(bone, (0, 0, 0))
        out[bone] = (base[0] + rot[0], base[1] + rot[1], base[2] + rot[2])
    return out


CLIPS = {
    # Idle: one slow breath cycle. Chest lifts, shoulders settle, head drifts a degree or two.
    "idle": [
        (0, pose()),
        (12, pose(Spine02=(-1.5, 0, 0), Spine01=(-1, 0, 0), neck=(1, 0, 1.5), Head=(0.5, 0, 1),
                  LeftArm=(1.5, 0, 0), RightArm=(1.5, 0, 0), LeftShoulder=(0, 0, -1), RightShoulder=(0, 0, 1))),
        (24, pose(Spine02=(1, 0, 0), neck=(-1, 0, -1), Head=(-0.5, 0, -1),
                  LeftArm=(-1, 0, 0), RightArm=(-1, 0, 0))),
        (36, pose(Spine02=(-1, 0, 0), neck=(0.5, 0, 1), Head=(0, 0, 1.5), LeftArm=(1, 0, 0))),
        (48, pose()),
    ],
    # Jump: load the knees, drive the arms up, leave the floor extended, land already tucking.
    "jump": [
        (0, pose()),
        (3, pose(Hips=(-8, 0, 0), Spine02=(10, 0, 0), Spine01=(8, 0, 0), neck=(-4, 0, 0),
                 LeftUpLeg=(-26, 0, 0), RightUpLeg=(-26, 0, 0), LeftLeg=(44, 0, 0), RightLeg=(44, 0, 0),
                 LeftFoot=(-14, 0, 0), RightFoot=(-14, 0, 0), LeftArm=(-24, -8, 0), RightArm=(-24, 8, 0))),
        (6, pose(Hips=(2, 0, 0), Spine02=(-6, 0, 0), neck=(3, 0, 0),
                 LeftUpLeg=(4, 0, 0), RightUpLeg=(4, 0, 0), LeftLeg=(-6, 0, 0), RightLeg=(-6, 0, 0),
                 LeftFoot=(12, 0, 0), RightFoot=(12, 0, 0), LeftArm=(46, -14, 0), RightArm=(46, 14, 0),
                 LeftForeArm=(-16, 0, 0), RightForeArm=(-16, 0, 0))),
        (11, pose(Hips=(-4, 0, 0), Spine02=(4, 0, 0),
                  LeftUpLeg=(-34, 0, 0), RightUpLeg=(-18, 0, 0), LeftLeg=(52, 0, 0), RightLeg=(28, 0, 0),
                  LeftFoot=(-8, 0, 0), RightFoot=(-4, 0, 0), LeftArm=(30, -10, 0), RightArm=(30, 10, 0))),
        (16, pose(Hips=(-2, 0, 0), Spine02=(2, 0, 0), LeftUpLeg=(-14, 0, 0), RightUpLeg=(-12, 0, 0),
                  LeftLeg=(26, 0, 0), RightLeg=(24, 0, 0), LeftArm=(10, -4, 0), RightArm=(10, 4, 0))),
    ],
    # Land: contact compression, a beat of absorb, then push back to stance.
    "land": [
        (0, pose(Hips=(-2, 0, 0), LeftUpLeg=(-18, 0, 0), RightUpLeg=(-16, 0, 0),
                 LeftLeg=(30, 0, 0), RightLeg=(28, 0, 0), LeftFoot=(6, 0, 0), RightFoot=(6, 0, 0))),
        (3, pose(Hips=(-12, 0, 0), Spine02=(16, 0, 0), Spine01=(12, 0, 0), Spine=(8, 0, 0),
                 neck=(-8, 0, 0), LeftUpLeg=(-40, 0, 0), RightUpLeg=(-38, 0, 0),
                 LeftLeg=(64, 0, 0), RightLeg=(62, 0, 0), LeftFoot=(-14, 0, 0), RightFoot=(-14, 0, 0),
                 LeftArm=(-30, -12, 0), RightArm=(-30, 12, 0), LeftForeArm=(-18, 0, 0), RightForeArm=(-18, 0, 0))),
        (7, pose(Hips=(-9, 0, 0), Spine02=(12, 0, 0), Spine01=(9, 0, 0),
                 LeftUpLeg=(-30, 0, 0), RightUpLeg=(-28, 0, 0), LeftLeg=(50, 0, 0), RightLeg=(48, 0, 0),
                 LeftArm=(-22, -8, 0), RightArm=(-22, 8, 0))),
        (12, pose(Hips=(-3, 0, 0), Spine02=(4, 0, 0), LeftUpLeg=(-12, 0, 0), RightUpLeg=(-10, 0, 0),
                  LeftLeg=(22, 0, 0), RightLeg=(20, 0, 0), LeftArm=(-8, -3, 0), RightArm=(-8, 3, 0))),
        (16, pose()),
    ],
    # Light hit: the head snaps, the chest folds a little, the feet stay planted.
    "hit_light": [
        (0, pose()),
        (2, pose(Hips=(4, 0, -6), Spine02=(-14, 0, -8), Spine01=(-10, 0, -6), Spine=(-6, 0, -4),
                 neck=(12, 0, 8), Head=(8, 0, 6), LeftArm=(16, -10, 0), RightArm=(10, 8, 0),
                 LeftForeArm=(-14, 0, 0), RightForeArm=(-10, 0, 0))),
        (5, pose(Hips=(2, 0, -3), Spine02=(-8, 0, -4), Spine01=(-6, 0, -3), neck=(7, 0, 4),
                 LeftArm=(9, -6, 0), RightArm=(6, 4, 0))),
        (9, pose(Spine02=(-2, 0, -1), neck=(2, 0, 1), LeftArm=(2, -2, 0))),
        (12, pose()),
    ],
    # Heavy hit: whole body rotates away, the back foot drags, the arms trail.
    "hit_heavy": [
        (0, pose()),
        (3, pose(Hips=(10, 0, -16), Spine02=(-24, 0, -18), Spine01=(-18, 0, -14), Spine=(-12, 0, -10),
                 neck=(20, 0, 14), Head=(12, 0, 10), LeftArm=(30, -16, 0), RightArm=(20, 14, 0),
                 LeftForeArm=(-24, 0, 0), RightForeArm=(-18, 0, 0), LeftUpLeg=(-10, 0, 0),
                 RightUpLeg=(6, 0, 0), RightLeg=(14, 0, 0))),
        (7, pose(Hips=(7, 0, -12), Spine02=(-18, 0, -13), Spine01=(-14, 0, -10), neck=(15, 0, 10),
                 LeftArm=(22, -12, 0), RightArm=(15, 10, 0), LeftUpLeg=(-7, 0, 0), RightUpLeg=(4, 0, 0))),
        (12, pose(Hips=(4, 0, -6), Spine02=(-10, 0, -6), Spine01=(-8, 0, -5), neck=(8, 0, 5),
                  LeftArm=(12, -6, 0), RightArm=(8, 5, 0))),
        (18, pose(Spine02=(-2, 0, -2), neck=(2, 0, 1), LeftArm=(2, 0, 0))),
        (22, pose()),
    ],
    # Knockdown: launched backwards, hits the floor, settles flat, one bounce of the shoulders.
    "knockdown": [
        (0, pose(Hips=(-6, 0, 0), Spine02=(8, 0, 0), LeftArm=(20, -8, 0), RightArm=(20, 8, 0))),
        (4, pose(Hips=(-24, 0, 0), Spine02=(22, 0, 0), Spine01=(16, 0, 0), neck=(-14, 0, 0),
                 LeftUpLeg=(-46, 0, 0), RightUpLeg=(-40, 0, 0), LeftLeg=(30, 0, 0), RightLeg=(26, 0, 0),
                 LeftArm=(48, -18, 0), RightArm=(46, 18, 0), LeftForeArm=(-30, 0, 0), RightForeArm=(-30, 0, 0))),
        (10, pose(Hips=(-72, 0, 0), Spine02=(26, 0, 0), Spine01=(18, 0, 0), neck=(-18, 0, 0),
                  Head=(-12, 0, 0), LeftUpLeg=(-40, 0, 0), RightUpLeg=(-34, 0, 0),
                  LeftLeg=(24, 0, 0), RightLeg=(20, 0, 0), LeftArm=(64, -26, 0), RightArm=(62, 26, 0),
                  LeftForeArm=(-20, 0, 0), RightForeArm=(-20, 0, 0))),
        (16, pose(Hips=(-78, 0, 0), Spine02=(20, 0, 0), Spine01=(14, 0, 0), neck=(-14, 0, 0),
                  Head=(-8, 0, 0), LeftUpLeg=(-30, 0, 0), RightUpLeg=(-26, 0, 0),
                  LeftLeg=(18, 0, 0), RightLeg=(16, 0, 0), LeftArm=(58, -24, 0), RightArm=(56, 24, 0))),
        (22, pose(Hips=(-76, 0, 0), Spine02=(22, 0, 0), Spine01=(16, 0, 0), neck=(-16, 0, 0),
                  LeftUpLeg=(-32, 0, 0), RightUpLeg=(-28, 0, 0), LeftLeg=(20, 0, 0), RightLeg=(18, 0, 0),
                  LeftArm=(60, -25, 0), RightArm=(58, 25, 0))),
        (26, pose(Hips=(-77, 0, 0), Spine02=(21, 0, 0), Spine01=(15, 0, 0), neck=(-15, 0, 0),
                  LeftUpLeg=(-31, 0, 0), RightUpLeg=(-27, 0, 0), LeftLeg=(19, 0, 0), RightLeg=(17, 0, 0),
                  LeftArm=(59, -24, 0), RightArm=(57, 24, 0))),
    ],
    # Get-up: roll onto a hand, knee under the hips, push to stance.
    "get_up": [
        (0, pose(Hips=(-74, 0, 0), Spine02=(24, 0, 0), Spine01=(16, 0, 0), neck=(-16, 0, 0),
                 LeftUpLeg=(-34, 0, 0), RightUpLeg=(-30, 0, 0), LeftLeg=(22, 0, 0), RightLeg=(18, 0, 0),
                 LeftArm=(60, -24, 0), RightArm=(58, 24, 0))),
        (6, pose(Hips=(-52, 0, 0), Spine02=(30, 0, 0), Spine01=(22, 0, 0), neck=(-20, 0, 0),
                 LeftUpLeg=(-60, 0, 0), RightUpLeg=(-20, 0, 0), LeftLeg=(70, 0, 0), RightLeg=(30, 0, 0),
                 LeftArm=(52, -20, 0), RightArm=(40, 18, 0), LeftForeArm=(-34, 0, 0))),
        (13, pose(Hips=(-28, 0, 0), Spine02=(24, 0, 0), Spine01=(18, 0, 0), neck=(-14, 0, 0),
                  LeftUpLeg=(-52, 0, 0), RightUpLeg=(-24, 0, 0), LeftLeg=(72, 0, 0), RightLeg=(44, 0, 0),
                  LeftArm=(30, -14, 0), RightArm=(24, 12, 0))),
        (19, pose(Hips=(-12, 0, 0), Spine02=(12, 0, 0), Spine01=(9, 0, 0),
                  LeftUpLeg=(-26, 0, 0), RightUpLeg=(-16, 0, 0), LeftLeg=(40, 0, 0), RightLeg=(28, 0, 0),
                  LeftArm=(12, -6, 0), RightArm=(10, 5, 0))),
        (24, pose()),
    ],
    # Victory: both arms up, chest open, head back. Held on the last pose.
    "victory": [
        (0, pose()),
        (6, pose(Hips=(2, 0, 0), Spine02=(-10, 0, 0), Spine01=(-8, 0, 0), neck=(-6, 0, 0),
                 Head=(-6, 0, 0), LeftArm=(120, -22, 0), RightArm=(120, 22, 0),
                 LeftForeArm=(-30, 0, 0), RightForeArm=(-30, 0, 0),
                 LeftUpLeg=(-8, 0, 0), RightUpLeg=(-8, 0, 0), LeftLeg=(14, 0, 0), RightLeg=(14, 0, 0))),
        (12, pose(Hips=(1, 0, 0), Spine02=(-13, 0, 0), Spine01=(-10, 0, 0), neck=(-8, 0, 0),
                  Head=(-8, 0, 0), LeftArm=(134, -26, 0), RightArm=(134, 26, 0),
                  LeftForeArm=(-22, 0, 0), RightForeArm=(-22, 0, 0))),
        (20, pose(Hips=(1, 0, 0), Spine02=(-11, 0, 0), Spine01=(-9, 0, 0), neck=(-6, 0, 0),
                  Head=(-6, 0, 0), LeftArm=(128, -24, 0), RightArm=(128, 24, 0),
                  LeftForeArm=(-26, 0, 0), RightForeArm=(-26, 0, 0))),
        (30, pose(Spine02=(-12, 0, 0), neck=(-7, 0, 0), Head=(-7, 0, 0),
                  LeftArm=(131, -25, 0), RightArm=(131, 25, 0),
                  LeftForeArm=(-24, 0, 0), RightForeArm=(-24, 0, 0))),
    ],
    # Defeat: knees buckle, torso folds, then the body settles onto the floor.
    "defeat": [
        (0, pose()),
        (6, pose(Hips=(-14, 0, 0), Spine02=(18, 0, 0), Spine01=(14, 0, 0), neck=(-10, 0, 0),
                 LeftUpLeg=(-34, 0, 0), RightUpLeg=(-32, 0, 0), LeftLeg=(58, 0, 0), RightLeg=(56, 0, 0),
                 LeftArm=(-6, -10, 0), RightArm=(-6, 10, 0), LeftForeArm=(-44, 0, 0), RightForeArm=(-44, 0, 0))),
        (14, pose(Hips=(-32, 0, 0), Spine02=(38, 0, 0), Spine01=(30, 0, 0), neck=(-22, 0, 0),
                  Head=(-14, 0, 0), LeftUpLeg=(-70, 0, 0), RightUpLeg=(-68, 0, 0),
                  LeftLeg=(96, 0, 0), RightLeg=(94, 0, 0), LeftFoot=(-16, 0, 0), RightFoot=(-16, 0, 0),
                  LeftArm=(16, -14, 0), RightArm=(16, 14, 0), LeftForeArm=(-30, 0, 0), RightForeArm=(-30, 0, 0))),
        (24, pose(Hips=(-58, 0, 0), Spine02=(46, 0, 0), Spine01=(36, 0, 0), neck=(-26, 0, 0),
                  Head=(-18, 0, 0), LeftUpLeg=(-84, 0, 0), RightUpLeg=(-82, 0, 0),
                  LeftLeg=(104, 0, 0), RightLeg=(102, 0, 0), LeftArm=(30, -18, 0), RightArm=(30, 18, 0))),
        (32, pose(Hips=(-70, 0, 0), Spine02=(44, 0, 0), Spine01=(34, 0, 0), neck=(-24, 0, 0),
                  Head=(-16, 0, 0), LeftUpLeg=(-86, 0, 0), RightUpLeg=(-84, 0, 0),
                  LeftLeg=(106, 0, 0), RightLeg=(104, 0, 0), LeftArm=(34, -20, 0), RightArm=(34, 20, 0))),
    ],
}


def main():
    args = ra.parse_args(
        "Author reaction clips on an imported fighter rig.",
        DEFAULT_SOURCE, DEFAULT_OUT, DEFAULT_PREFIX,
    )
    bpy_clear()
    armature = ra.import_model(args.source)
    bone_map = ra.resolve_bone_map(armature, args.rig, ra.bone_overrides(args.bones))
    print("RIG " + args.rig + " | bones " + ", ".join(sorted(set(bone_map.values()))))
    actions = ra.build_actions(armature, CLIPS, args.prefix, bone_map)
    ra.to_nla(armature, actions)
    ra.drop_geometry()
    ra.export(armature, args.out)
    print("ACTIONS " + ", ".join(a.name + ":" + str((a.frame_start, a.frame_end)) for a in actions))


def bpy_clear():
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)


if __name__ == "__main__":
    main()
