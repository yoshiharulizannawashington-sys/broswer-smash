"""Author Naruto's kunai throw on his own imported rig.

    bash scripts/blender.sh -b --python assets/blender/naruto_kunai_animation.py

Output defaults to public/models/characters/naruto_uzumaki/naruto_kunai.glb: a clip-only GLB
exported from the body's own skeleton. The source body is never written, and the runtime binds the
clip by bone name onto the mounted mesh, so geometry, materials and textures stay untouched.

This is the same armature-space authoring as the Infantry attack and reaction passes
(`rig_authoring.apply_pose`): poses are written in armature space (-Y forward, +Z up) and converted
per bone, which is what makes the numbers readable on a Rigify chain with rolled rest axes.

The throw is a real fighting-game motion, not a label:
  draw      weight shifts to the back foot, right hand comes up beside the ear
  windup    torso coils away from the target, left hand points at it
  release   hips and chest snap through, right arm extends, front knee takes the weight
  follow    arm crosses the body, shoulders keep rotating
  recover   stance
No root displacement: the game owns position, so leaving the root at the origin keeps foot contact
under the existing locator.
"""
import os
import sys

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import rig_authoring as ra

DEFAULT_SOURCE = "public/models/characters/naruto_uzumaki/naruto_uzumaki.glb"
DEFAULT_OUT = "public/models/characters/naruto_uzumaki/naruto_kunai.glb"
DEFAULT_PREFIX = "Naruto_"

# Same neutral stance as the reaction pass: knees soft, arms heavy, weight even.
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
    "kunai": [
        # Settle: sink into the back leg and start the hand moving to the draw.
        (0, pose()),
        (3, pose(Hips=(-4, 0, -10), Spine02=(4, 0, -8), Spine01=(3, 0, -5),
                 neck=(0, 0, 6), Head=(0, 0, 5),
                 RightArm=(-34, 18, 0), RightForeArm=(-58, 0, 0),
                 LeftArm=(18, -12, 0), LeftForeArm=(-22, 0, 0),
                 LeftUpLeg=(-10, 0, 0), RightUpLeg=(2, 0, 0), LeftLeg=(18, 0, 0), RightLeg=(12, 0, 0))),
        # Full coil: hand beside the ear, chest rotated away, eyes still on the target.
        (6, pose(Hips=(-8, 0, -22), Spine02=(8, 0, -18), Spine01=(6, 0, -12), Spine=(4, 0, -6),
                 neck=(0, 0, 14), Head=(0, 0, 12),
                 RightArm=(-72, 34, 0), RightForeArm=(-96, 0, 0), RightHand=(0, 0, -18),
                 LeftArm=(46, -16, 0), LeftForeArm=(-18, 0, 0),
                 LeftUpLeg=(-18, 0, 0), RightUpLeg=(6, 0, 0),
                 LeftLeg=(30, 0, 0), RightLeg=(16, 0, 0),
                 LeftFoot=(-10, 0, 0), RightFoot=(-6, 0, 0))),
        # Release: hips lead, chest whips through, arm extends at shoulder height.
        (9, pose(Hips=(2, 0, 12), Spine02=(-6, 0, 22), Spine01=(-4, 0, 16), Spine=(-2, 0, 8),
                 neck=(2, 0, -10), Head=(1, 0, -8),
                 RightArm=(84, 6, 0), RightForeArm=(-6, 0, 0), RightHand=(0, 0, 8),
                 LeftArm=(-26, -10, 0), LeftForeArm=(-48, 0, 0),
                 LeftUpLeg=(-22, 0, 0), RightUpLeg=(10, 0, 0),
                 LeftLeg=(34, 0, 0), RightLeg=(10, 0, 0),
                 LeftFoot=(-8, 0, 0), RightFoot=(-4, 0, 0))),
        # Follow-through: the throwing arm crosses the body and the shoulders keep turning.
        (13, pose(Hips=(0, 0, 18), Spine02=(-2, 0, 20), Spine01=(-1, 0, 14),
                  neck=(1, 0, -8), Head=(0, 0, -6),
                  RightArm=(52, -24, 0), RightForeArm=(-38, 0, 0),
                  LeftArm=(-10, -8, 0), LeftForeArm=(-40, 0, 0),
                  LeftUpLeg=(-14, 0, 0), RightUpLeg=(4, 0, 0), LeftLeg=(24, 0, 0), RightLeg=(14, 0, 0))),
        # Recover: square up and return to the stance the state machine blends from.
        (18, pose()),
    ],
}


def main():
    args = ra.parse_args(
        "Author Naruto's kunai throw on his imported rig.",
        DEFAULT_SOURCE, DEFAULT_OUT, DEFAULT_PREFIX,
    )
    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    armature = ra.import_model(args.source)
    bone_map = ra.resolve_bone_map(armature, args.rig, ra.bone_overrides(args.bones))
    print("RIG " + args.rig + " | bones " + ", ".join(sorted(set(bone_map.values()))))
    actions = ra.build_actions(armature, CLIPS, args.prefix, bone_map)
    ra.to_nla(armature, actions)
    ra.drop_geometry()
    ra.export(armature, args.out)
    print("ACTIONS " + ", ".join(a.name + ":" + str((a.frame_start, a.frame_end)) for a in actions))


if __name__ == "__main__":
    main()
