"""Author bespoke combat clips for Superman, Goku and Spider-Man on the 19-bone roster rig.

The roster bodies share one armature and one baked locomotion set, which is why their melee used to
read as the same move with a different colour. This script authors seven clips per fighter in
armature space (-Y forward, +Z up, character right -X), using the proven conversion in
`rig_authoring.py`. It never re-exports the body: each output is a clip-only GLB bound to the
existing skeleton at runtime.

    bash scripts/blender.sh -b --python assets/blender/roster_bespoke_animations.py -- \
        --fighter superman

    # all three
    for fighter in superman goku spider_man; do
      bash scripts/blender.sh -b --python assets/blender/roster_bespoke_animations.py -- --fighter "$fighter"
    done

The three pose tables are deliberately not shared:
  * Superman: upright, wide, long anticipation, heavy follow-through.
  * Goku: compact guard, fast chamber-to-contact, deep hip rotation.
  * Spider-Man: low crouch, rotational kicks, short recoil.
Every clip starts and ends in that fighter's guard so it blends back into locomotion.
"""
import argparse
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

import rig_authoring as ra  # noqa: E402

FPS = 24
BASE = {
    "Hips": (0, 0, 0),
    "Spine": (3, 0, 0), "Chest": (2, 0, 0),
    "Neck": (-3, 0, 0), "Head": (-2, 0, 0),
    "LeftShoulder": (0, 0, -3), "RightShoulder": (0, 0, 3),
    "LeftArm": (-14, -6, 0), "RightArm": (-16, 6, 0),
    "LeftForeArm": (-38, 0, 0), "RightForeArm": (-40, 0, 0),
    "LeftHand": (0, 0, 0), "RightHand": (0, 0, 0),
    "LeftUpLeg": (-5, 0, 0), "RightUpLeg": (-5, 0, 0),
    "LeftLeg": (11, 0, 0), "RightLeg": (12, 0, 0),
    "LeftFoot": (-5, 0, 0), "RightFoot": (-6, 0, 0),
}


def stance(**changes):
    out = dict(BASE)
    out.update(changes)
    return out


def p(base, **changes):
    """Guard plus readable per-bone deltas, as in the Infantry/Naruto authoring tables."""
    out = {bone: tuple(rot) for bone, rot in base.items()}
    for bone, rot in changes.items():
        before = out.get(bone, (0, 0, 0))
        out[bone] = (before[0] + rot[0], before[1] + rot[1], before[2] + rot[2])
    return out


SUPERMAN = stance(
    Spine=(-2, 0, 0), Chest=(-3, 0, 0), Neck=(-2, 0, 0), Head=(-1, 0, 0),
    LeftArm=(-8, -12, 0), RightArm=(-10, 12, 0),
    LeftForeArm=(-28, 0, 0), RightForeArm=(-30, 0, 0),
    LeftUpLeg=(-4, 0, -4), RightUpLeg=(-4, 0, 4),
    LeftLeg=(10, 0, 0), RightLeg=(10, 0, 0),
    LeftFoot=(-4, 0, 0), RightFoot=(-4, 0, 0),
)

GOKU = stance(
    Spine=(5, 0, 0), Chest=(4, 0, 0), Neck=(-4, 0, 0), Head=(-3, 0, 0),
    LeftArm=(-24, -8, 0), RightArm=(-26, 8, 0),
    LeftForeArm=(-58, 0, 0), RightForeArm=(-60, 0, 0),
    LeftUpLeg=(-8, 0, 0), RightUpLeg=(-8, 0, 0),
    LeftLeg=(16, 0, 0), RightLeg=(16, 0, 0),
    LeftFoot=(-7, 0, 0), RightFoot=(-7, 0, 0),
)

SPIDER = stance(
    Hips=(-2, 0, 0), Spine=(6, 0, 0), Chest=(3, 0, 0), Neck=(-5, 0, 0), Head=(-4, 0, 0),
    LeftShoulder=(0, 0, -6), RightShoulder=(0, 0, 6),
    LeftArm=(-12, -18, 0), RightArm=(-14, 18, 0),
    LeftForeArm=(-32, 0, 0), RightForeArm=(-34, 0, 0),
    LeftUpLeg=(-10, 0, 0), RightUpLeg=(-10, 0, 0),
    LeftLeg=(22, 0, 0), RightLeg=(22, 0, 0),
    LeftFoot=(-9, 0, 0), RightFoot=(-9, 0, 0),
)

# --------------------------------------------------------------------------- Superman
# Long lever, committed weight. The jab takes 20 frames; the hammer takes 32 because the whole
# torso has to load and recover, not because the playback speed was lowered.
SUPERMAN_CLIPS = {
    "Jab": [
        (0, p(SUPERMAN)),
        (4, p(SUPERMAN, Hips=(0, 0, -10), Spine=(-2, 0, -8), Chest=(-2, 0, -6),
                  RightArm=(28, 10, 0), RightForeArm=(24, 0, 0),
                  LeftArm=(-6, -4, 0), LeftForeArm=(-10, 0, 0), Head=(0, 0, -4))),
        (8, p(SUPERMAN, Hips=(2, 0, 14), Spine=(4, 0, 12), Chest=(5, 0, 10),
                  RightShoulder=(0, 0, 8), RightArm=(-88, -8, 0), RightForeArm=(-8, 0, 0),
                  LeftArm=(10, 0, 0), LeftForeArm=(18, 0, 0), Head=(-4, 0, 6),
                  LeftLeg=(6, 0, 0), RightLeg=(4, 0, 0))),
        (11, p(SUPERMAN, Hips=(2, 0, 15), Spine=(5, 0, 13), Chest=(6, 0, 11),
                   RightArm=(-92, -6, 0), RightForeArm=(-6, 0, 0),
                   LeftArm=(10, 0, 0), LeftForeArm=(18, 0, 0), Head=(-4, 0, 7))),
        (16, p(SUPERMAN, Hips=(1, 0, 4), Spine=(2, 0, 3), RightArm=(-35, 0, 0),
                   RightForeArm=(-45, 0, 0), LeftArm=(-8, -2, 0))),
        (20, p(SUPERMAN)),
    ],
    "Kick": [
        (0, p(SUPERMAN)),
        (6, p(SUPERMAN, Hips=(0, 0, -8), Spine=(-4, 0, -6),
                   RightUpLeg=(-58, 0, 0), RightLeg=(88, 0, 0), RightFoot=(10, 0, 0),
                   LeftLeg=(16, 0, 0), LeftArm=(14, -4, 0), RightArm=(12, 4, 0),
                   LeftForeArm=(16, 0, 0), RightForeArm=(12, 0, 0))),
        (12, p(SUPERMAN, Hips=(2, 0, 10), Spine=(-8, 0, 8), Chest=(-4, 0, 5),
                   RightUpLeg=(-78, 0, 0), RightLeg=(-62, 0, 0), RightFoot=(-12, 0, 0),
                   LeftLeg=(18, 0, 0), LeftArm=(20, -8, 0), RightArm=(18, 8, 0),
                   LeftForeArm=(20, 0, 0), Head=(2, 0, -5))),
        (15, p(SUPERMAN, Hips=(2, 0, 11), Spine=(-9, 0, 9),
                   RightUpLeg=(-80, 0, 0), RightLeg=(-64, 0, 0), RightFoot=(-12, 0, 0),
                   LeftLeg=(18, 0, 0), LeftArm=(20, -8, 0), RightArm=(18, 8, 0))),
        (20, p(SUPERMAN, Hips=(0, 0, 2), Spine=(-2, 0, 2),
                   RightUpLeg=(-28, 0, 0), RightLeg=(30, 0, 0), RightFoot=(2, 0, 0),
                   LeftArm=(8, -4, 0), RightArm=(8, 4, 0))),
        (26, p(SUPERMAN)),
    ],
    "Heavy": [
        (0, p(SUPERMAN)),
        (8, p(SUPERMAN, Hips=(-4, 0, -16), Spine=(-12, 0, -12), Chest=(-10, 0, -8),
                  Neck=(4, 0, 4), Head=(4, 0, 4),
                  LeftArm=(-130, -8, 0), RightArm=(-132, 8, 0),
                  LeftForeArm=(-40, 0, 0), RightForeArm=(-42, 0, 0),
                  LeftUpLeg=(-12, 0, 0), RightUpLeg=(-12, 0, 0),
                  LeftLeg=(24, 0, 0), RightLeg=(24, 0, 0))),
        (15, p(SUPERMAN, Hips=(8, 0, 14), Spine=(28, 0, 10), Chest=(20, 0, 8),
                   Neck=(-10, 0, -4), Head=(10, 0, -4),
                   LeftArm=(-8, -2, 0), RightArm=(-6, 2, 0),
                   LeftForeArm=(-6, 0, 0), RightForeArm=(-4, 0, 0),
                   LeftUpLeg=(-20, 0, 0), RightUpLeg=(-20, 0, 0),
                   LeftLeg=(38, 0, 0), RightLeg=(38, 0, 0), LeftFoot=(-8, 0, 0), RightFoot=(-8, 0, 0))),
        (18, p(SUPERMAN, Hips=(8, 0, 14), Spine=(30, 0, 10), Chest=(22, 0, 8),
                   LeftArm=(-8, -2, 0), RightArm=(-6, 2, 0),
                   LeftForeArm=(-6, 0, 0), RightForeArm=(-4, 0, 0),
                   LeftLeg=(40, 0, 0), RightLeg=(40, 0, 0))),
        (24, p(SUPERMAN, Hips=(3, 0, 4), Spine=(10, 0, 3), Chest=(6, 0, 2),
                   LeftArm=(-30, 0, 0), RightArm=(-28, 0, 0),
                   LeftForeArm=(-30, 0, 0), RightForeArm=(-28, 0, 0),
                   LeftLeg=(18, 0, 0), RightLeg=(18, 0, 0))),
        (32, p(SUPERMAN)),
    ],
    "Air": [
        (0, p(SUPERMAN, LeftUpLeg=(-28, 0, 0), RightUpLeg=(-28, 0, 0),
                  LeftLeg=(55, 0, 0), RightLeg=(55, 0, 0),
                  LeftArm=(-35, -6, 0), RightArm=(-35, 6, 0),
                  LeftForeArm=(-55, 0, 0), RightForeArm=(-55, 0, 0))),
        (5, p(SUPERMAN, Hips=(-16, 0, 0), Spine=(-10, 0, 0), Chest=(-8, 0, 0),
                  Head=(-6, 0, 0), LeftArm=(-120, -8, 0), RightArm=(-120, 8, 0),
                  LeftForeArm=(-30, 0, 0), RightForeArm=(-30, 0, 0),
                  LeftUpLeg=(-40, 0, 0), RightUpLeg=(-40, 0, 0),
                  LeftLeg=(75, 0, 0), RightLeg=(75, 0, 0))),
        (10, p(SUPERMAN, Hips=(22, 0, 0), Spine=(18, 0, 0), Chest=(12, 0, 0),
                   Head=(8, 0, 0), LeftArm=(-85, -4, 0), RightArm=(-85, 4, 0),
                   LeftForeArm=(-5, 0, 0), RightForeArm=(-5, 0, 0),
                   LeftUpLeg=(-10, 0, 0), RightUpLeg=(-10, 0, 0),
                   LeftLeg=(15, 0, 0), RightLeg=(15, 0, 0))),
        (13, p(SUPERMAN, Hips=(24, 0, 0), Spine=(20, 0, 0), Chest=(14, 0, 0),
                   Head=(9, 0, 0), LeftArm=(-90, -4, 0), RightArm=(-90, 4, 0),
                   LeftForeArm=(-4, 0, 0), RightForeArm=(-4, 0, 0))),
        (20, p(SUPERMAN, Hips=(4, 0, 0), Spine=(6, 0, 0), LeftArm=(-30, -4, 0),
                   RightArm=(-30, 4, 0), LeftForeArm=(-40, 0, 0), RightForeArm=(-40, 0, 0),
                   LeftUpLeg=(-20, 0, 0), RightUpLeg=(-20, 0, 0), LeftLeg=(40, 0, 0), RightLeg=(40, 0, 0))),
        (26, p(SUPERMAN)),
    ],
    "HitLight": [
        (0, p(SUPERMAN)),
        (2, p(SUPERMAN, Hips=(0, 0, -5), Spine=(-12, 0, -4), Chest=(-8, 0, -2),
                  Neck=(8, 0, 3), Head=(8, 0, 4), LeftArm=(10, -5, 0), RightArm=(8, 4, 0),
                  LeftForeArm=(8, 0, 0), RightForeArm=(6, 0, 0))),
        (5, p(SUPERMAN, Spine=(-6, 0, -2), Neck=(4, 0, 1), Head=(4, 0, 2),
                  LeftArm=(5, -2, 0), RightArm=(4, 2, 0))),
        (9, p(SUPERMAN)),
    ],
    "HitHeavy": [
        (0, p(SUPERMAN)),
        (3, p(SUPERMAN, Hips=(8, 0, -14), Spine=(-28, 0, -12), Chest=(-18, 0, -8),
                  Neck=(18, 0, 8), Head=(16, 0, 8),
                  LeftArm=(26, -12, 0), RightArm=(20, 10, 0),
                  LeftForeArm=(12, 0, 0), RightForeArm=(10, 0, 0),
                  LeftUpLeg=(-10, 0, 0), RightUpLeg=(4, 0, 0), RightLeg=(10, 0, 0))),
        (8, p(SUPERMAN, Hips=(5, 0, -10), Spine=(-18, 0, -8), Chest=(-12, 0, -5),
                  Neck=(12, 0, 5), Head=(10, 0, 5), LeftArm=(18, -8, 0), RightArm=(14, 7, 0))),
        (14, p(SUPERMAN, Hips=(2, 0, -4), Spine=(-8, 0, -3), Neck=(5, 0, 2), Head=(4, 0, 2),
                   LeftArm=(8, -3, 0), RightArm=(6, 3, 0))),
        (20, p(SUPERMAN)),
    ],
    "Special": [
        (0, p(SUPERMAN)),
        (6, p(SUPERMAN, Hips=(-6, 0, 0), Spine=(-8, 0, 0), Chest=(-5, 0, 0),
                  Neck=(4, 0, 0), Head=(2, 0, 0), LeftArm=(25, -4, 0), RightArm=(25, 4, 0),
                  LeftForeArm=(-70, 0, 0), RightForeArm=(-70, 0, 0),
                  LeftUpLeg=(-12, 0, -3), RightUpLeg=(-12, 0, 3),
                  LeftLeg=(24, 0, 0), RightLeg=(24, 0, 0))),
        (10, p(SUPERMAN, Hips=(-8, 0, 0), Spine=(-12, 0, 0), Chest=(-8, 0, 0),
                   Neck=(6, 0, 0), Head=(4, 0, 0), LeftArm=(35, -6, 0), RightArm=(35, 6, 0),
                   LeftForeArm=(-90, 0, 0), RightForeArm=(-90, 0, 0),
                   LeftLeg=(30, 0, 0), RightLeg=(30, 0, 0))),
        (14, p(SUPERMAN, Hips=(4, 0, 0), Spine=(10, 0, 0), Chest=(8, 0, 0),
                   Neck=(-8, 0, 0), Head=(12, 0, 0), LeftArm=(-20, -4, 0), RightArm=(-20, 4, 0),
                   LeftForeArm=(-40, 0, 0), RightForeArm=(-40, 0, 0),
                   LeftLeg=(20, 0, 0), RightLeg=(20, 0, 0))),
        (20, p(SUPERMAN, Hips=(3, 0, 0), Spine=(8, 0, 0), Chest=(7, 0, 0),
                   Neck=(-6, 0, 0), Head=(14, 0, 0), LeftArm=(-15, -3, 0), RightArm=(-15, 3, 0),
                   LeftForeArm=(-45, 0, 0), RightForeArm=(-45, 0, 0))),
        (26, p(SUPERMAN, Spine=(2, 0, 0), Chest=(2, 0, 0), Head=(4, 0, 0),
                   LeftArm=(-5, -2, 0), RightArm=(-5, 2, 0))),
        (32, p(SUPERMAN)),
    ],
}

# --------------------------------------------------------------------------- Goku
# Compact, fast, hip-driven. The alert guard is deeper than Superman's, the jab is 10 frames, and
# the heavy is a rotational backfist rather than an overhead hammer.
GOKU_CLIPS = {
    "Jab": [
        (0, p(GOKU)),
        (2, p(GOKU, Hips=(0, 0, -8), Spine=(2, 0, -6), RightArm=(20, 6, 0),
                  RightForeArm=(15, 0, 0), LeftArm=(-4, -2, 0), Head=(0, 0, -3))),
        (4, p(GOKU, Hips=(2, 0, 14), Spine=(4, 0, 10), Chest=(3, 0, 6),
                  RightShoulder=(0, 0, 7), RightArm=(-98, -6, 0), RightForeArm=(-4, 0, 0),
                  LeftArm=(8, 0, 0), LeftForeArm=(14, 0, 0), Head=(-3, 0, 5),
                  LeftLeg=(5, 0, 0), RightLeg=(4, 0, 0))),
        (6, p(GOKU, Hips=(2, 0, 15), Spine=(4, 0, 11), RightArm=(-100, -5, 0),
                  RightForeArm=(-3, 0, 0), Head=(-3, 0, 6))),
        (10, p(GOKU)),
    ],
    "Kick": [
        (0, p(GOKU)),
        (3, p(GOKU, Hips=(0, 0, -10), Spine=(-4, 0, -7),
                  RightUpLeg=(-72, 0, 0), RightLeg=(100, 0, 0), RightFoot=(12, 0, 0),
                  LeftLeg=(20, 0, 0), LeftArm=(12, -4, 0), RightArm=(10, 4, 0))),
        (6, p(GOKU, Hips=(1, 0, 18), Spine=(-8, 0, 12), Chest=(-5, 0, 8),
                  RightUpLeg=(-88, 0, 0), RightLeg=(-40, 0, 0), RightFoot=(-10, 0, 0),
                  LeftLeg=(22, 0, 0), LeftArm=(20, -8, 0), RightArm=(18, 8, 0),
                  LeftForeArm=(18, 0, 0), Head=(2, 0, -6))),
        (8, p(GOKU, Hips=(1, 0, 20), Spine=(-9, 0, 13),
                  RightUpLeg=(-90, 0, 0), RightLeg=(-42, 0, 0), LeftLeg=(22, 0, 0))),
        (12, p(GOKU, Hips=(0, 0, 4), Spine=(-2, 0, 3),
                   RightUpLeg=(-30, 0, 0), RightLeg=(40, 0, 0), LeftArm=(8, -3, 0), RightArm=(7, 3, 0))),
        (16, p(GOKU)),
    ],
    "Heavy": [
        (0, p(GOKU)),
        (4, p(GOKU, Hips=(-2, 0, -30), Spine=(-6, 0, -20), Chest=(-6, 0, -12),
                  Neck=(3, 0, 8), Head=(2, 0, 6),
                  RightArm=(35, 10, 0), RightForeArm=(22, 0, 0),
                  LeftArm=(20, -8, 0), LeftForeArm=(12, 0, 0),
                  LeftUpLeg=(-12, 0, 0), LeftLeg=(22, 0, 0))),
        (8, p(GOKU, Hips=(5, 0, 50), Spine=(8, 0, 28), Chest=(6, 0, 18),
                  Neck=(-5, 0, -12), Head=(-4, 0, -8),
                  RightArm=(-82, -10, 0), RightForeArm=(-6, 0, 0),
                  LeftArm=(10, -4, 0), LeftForeArm=(14, 0, 0),
                  LeftUpLeg=(-4, 0, 0), LeftLeg=(14, 0, 0))),
        (10, p(GOKU, Hips=(6, 0, 54), Spine=(9, 0, 30), RightArm=(-86, -8, 0),
                   RightForeArm=(-4, 0, 0), Head=(-4, 0, -10))),
        (14, p(GOKU, Hips=(2, 0, 16), Spine=(3, 0, 9), RightArm=(-30, 0, 0),
                   RightForeArm=(-30, 0, 0))),
        (22, p(GOKU)),
    ],
    "Air": [
        (0, p(GOKU, LeftUpLeg=(-24, 0, 0), RightUpLeg=(-24, 0, 0),
                  LeftLeg=(45, 0, 0), RightLeg=(45, 0, 0), LeftArm=(-30, -4, 0), RightArm=(-30, 4, 0))),
        (3, p(GOKU, Hips=(-12, 0, -6), Spine=(-4, 0, -4),
                  RightUpLeg=(-60, 0, 0), RightLeg=(90, 0, 0),
                  LeftUpLeg=(-20, 0, 0), LeftLeg=(40, 0, 0),
                  LeftArm=(-40, -6, 0), RightArm=(-40, 6, 0))),
        (6, p(GOKU, Hips=(-16, 0, 0), Spine=(8, 0, 0), Chest=(5, 0, 0),
                  RightUpLeg=(-105, 0, 0), RightLeg=(120, 0, 0), RightFoot=(8, 0, 0),
                  LeftUpLeg=(-18, 0, 0), LeftLeg=(50, 0, 0),
                  LeftArm=(24, -10, 0), RightArm=(20, 8, 0), Head=(-5, 0, 0))),
        (8, p(GOKU, Hips=(-18, 0, 0), Spine=(10, 0, 0),
                  RightUpLeg=(-108, 0, 0), RightLeg=(122, 0, 0),
                  LeftUpLeg=(-18, 0, 0), LeftLeg=(50, 0, 0))),
        (12, p(GOKU, Hips=(-6, 0, 0), Spine=(3, 0, 0),
                   RightUpLeg=(-42, 0, 0), RightLeg=(48, 0, 0),
                   LeftUpLeg=(-16, 0, 0), LeftLeg=(30, 0, 0), LeftArm=(10, -4, 0), RightArm=(9, 4, 0))),
        (18, p(GOKU)),
    ],
    "HitLight": [
        (0, p(GOKU)),
        (2, p(GOKU, Hips=(0, 0, -4), Spine=(-10, 0, -4), Chest=(-6, 0, -2),
                  Neck=(9, 0, 3), Head=(12, 0, 5), LeftArm=(12, -6, 0), RightArm=(8, 5, 0),
                  LeftForeArm=(8, 0, 0), RightForeArm=(6, 0, 0))),
        (5, p(GOKU, Spine=(-4, 0, -2), Neck=(4, 0, 1), Head=(5, 0, 2), LeftArm=(5, -2, 0))),
        (8, p(GOKU)),
    ],
    "HitHeavy": [
        (0, p(GOKU)),
        (2, p(GOKU, Hips=(10, 0, -12), Spine=(-24, 0, -10), Chest=(-16, 0, -6),
                  Neck=(18, 0, 8), Head=(20, 0, 8), LeftArm=(30, -14, 0), RightArm=(20, 12, 0),
                  LeftForeArm=(12, 0, 0), RightForeArm=(10, 0, 0),
                  LeftUpLeg=(-10, 0, 0), RightUpLeg=(6, 0, 0), RightLeg=(12, 0, 0))),
        (6, p(GOKU, Hips=(6, 0, -8), Spine=(-14, 0, -6), Neck=(10, 0, 4), Head=(12, 0, 5),
                  LeftArm=(18, -8, 0), RightArm=(12, 7, 0))),
        (10, p(GOKU, Hips=(2, 0, -3), Spine=(-6, 0, -2), Neck=(4, 0, 2), Head=(5, 0, 2),
                   LeftArm=(7, -3, 0), RightArm=(5, 3, 0))),
        (16, p(GOKU)),
    ],
    "Special": [
        (0, p(GOKU)),
        (4, p(GOKU, Hips=(0, 0, 18), Spine=(2, 0, 10), Chest=(2, 0, 6),
                  RightArm=(45, 8, 0), RightForeArm=(-90, 0, 0),
                  LeftArm=(35, -8, 0), LeftForeArm=(-80, 0, 0),
                  LeftUpLeg=(-12, 0, 0), RightUpLeg=(-12, 0, 0),
                  LeftLeg=(24, 0, 0), RightLeg=(24, 0, 0), Head=(0, 0, -4))),
        (8, p(GOKU, Hips=(0, 0, 22), Spine=(4, 0, 12), Chest=(4, 0, 8),
                  RightArm=(55, 8, 0), RightForeArm=(-110, 0, 0),
                  LeftArm=(45, -8, 0), LeftForeArm=(-100, 0, 0),
                  LeftLeg=(30, 0, 0), RightLeg=(30, 0, 0), Head=(0, 0, -5))),
        (12, p(GOKU, Hips=(0, 0, -10), Spine=(8, 0, -4), Chest=(6, 0, -2),
                   RightArm=(-95, -4, 0), RightForeArm=(-4, 0, 0),
                   LeftArm=(-95, 4, 0), LeftForeArm=(-4, 0, 0),
                   LeftLeg=(22, 0, 0), RightLeg=(22, 0, 0), Head=(-4, 0, 0))),
        (18, p(GOKU, Hips=(0, 0, -8), Spine=(7, 0, -3), RightArm=(-92, -3, 0),
                   RightForeArm=(-5, 0, 0), LeftArm=(-92, 3, 0), LeftForeArm=(-5, 0, 0))),
        (22, p(GOKU, Spine=(3, 0, 0), RightArm=(-40, 0, 0), RightForeArm=(-35, 0, 0),
                   LeftArm=(-40, 0, 0), LeftForeArm=(-35, 0, 0))),
        (28, p(GOKU)),
    ],
}

# --------------------------------------------------------------------------- Spider-Man
# Low centre of gravity and rotational kicks. The clips are the shortest of the three; the recoil
# is a whole-torso twist rather than a straight backward fold.
SPIDER_CLIPS = {
    "Jab": [
        (0, p(SPIDER)),
        (2, p(SPIDER, Hips=(0, 0, -10), Spine=(1, 0, -7), RightArm=(24, 8, 0),
                  RightForeArm=(16, 0, 0), LeftArm=(-5, -3, 0), Head=(0, 0, -4))),
        (4, p(SPIDER, Hips=(2, 0, 16), Spine=(3, 0, 10), Chest=(2, 0, 6),
                  RightShoulder=(0, 0, 7), RightArm=(-92, -6, 0), RightForeArm=(-4, 0, 0),
                  LeftArm=(10, 0, 0), LeftForeArm=(16, 0, 0), Head=(-3, 0, 5),
                  LeftLeg=(5, 0, 0), RightLeg=(4, 0, 0))),
        (6, p(SPIDER, Hips=(2, 0, 17), Spine=(3, 0, 11), RightArm=(-95, -5, 0),
                  RightForeArm=(-3, 0, 0))),
        (9, p(SPIDER)),
    ],
    "Kick": [
        (0, p(SPIDER)),
        (3, p(SPIDER, Hips=(-2, 0, -20), Spine=(-2, 0, -14),
                  RightUpLeg=(-70, 0, 0), RightLeg=(100, 0, 0), RightFoot=(12, 0, 0),
                  LeftLeg=(26, 0, 0), LeftArm=(14, -6, 0), RightArm=(12, 6, 0))),
        (6, p(SPIDER, Hips=(2, 0, 35), Spine=(-6, 0, 22), Chest=(-4, 0, 14), Neck=(3, 0, -8),
                  RightUpLeg=(-95, 0, 0), RightLeg=(-35, 0, 0), RightFoot=(-12, 0, 0),
                  LeftLeg=(28, 0, 0), LeftArm=(22, -10, 0), RightArm=(18, 8, 0),
                  LeftForeArm=(18, 0, 0), Head=(2, 0, -8))),
        (8, p(SPIDER, Hips=(2, 0, 38), Spine=(-7, 0, 24),
                  RightUpLeg=(-98, 0, 0), RightLeg=(-38, 0, 0), LeftLeg=(28, 0, 0))),
        (11, p(SPIDER, Hips=(0, 0, 8), Spine=(-2, 0, 5),
                   RightUpLeg=(-32, 0, 0), RightLeg=(45, 0, 0), LeftArm=(8, -4, 0), RightArm=(7, 3, 0))),
        (14, p(SPIDER)),
    ],
    "Heavy": [
        (0, p(SPIDER)),
        (4, p(SPIDER, Hips=(-2, 0, -40), Spine=(-4, 0, -26), Chest=(-4, 0, -16),
                  Neck=(3, 0, 10), Head=(2, 0, 8),
                  RightArm=(30, 10, 0), RightForeArm=(20, 0, 0),
                  LeftArm=(18, -8, 0), LeftForeArm=(12, 0, 0),
                  LeftUpLeg=(-14, 0, 0), LeftLeg=(26, 0, 0))),
        (8, p(SPIDER, Hips=(4, 0, 65), Spine=(6, 0, 32), Chest=(4, 0, 20),
                  Neck=(-4, 0, -14), Head=(-4, 0, -10),
                  RightUpLeg=(-100, 0, 0), RightLeg=(-30, 0, 0), RightFoot=(-10, 0, 0),
                  LeftLeg=(30, 0, 0), LeftArm=(26, -14, 0), RightArm=(-20, 8, 0),
                  LeftForeArm=(22, 0, 0))),
        (10, p(SPIDER, Hips=(5, 0, 70), Spine=(7, 0, 34),
                   RightUpLeg=(-104, 0, 0), RightLeg=(-32, 0, 0), LeftLeg=(30, 0, 0))),
        (14, p(SPIDER, Hips=(1, 0, 18), Spine=(2, 0, 8),
                   RightUpLeg=(-35, 0, 0), RightLeg=(48, 0, 0), LeftArm=(10, -5, 0), RightArm=(8, 4, 0))),
        (18, p(SPIDER)),
    ],
    "Air": [
        (0, p(SPIDER, LeftUpLeg=(-30, 0, 0), RightUpLeg=(-30, 0, 0),
                  LeftLeg=(60, 0, 0), RightLeg=(60, 0, 0), LeftArm=(-30, -10, 0), RightArm=(-30, 10, 0))),
        (3, p(SPIDER, Hips=(-14, 0, -8), Spine=(2, 0, -5),
                  RightUpLeg=(-65, 0, 0), RightLeg=(100, 0, 0),
                  LeftUpLeg=(-25, 0, 0), LeftLeg=(60, 0, 0), LeftArm=(-45, -12, 0), RightArm=(-40, 12, 0))),
        (6, p(SPIDER, Hips=(-18, 0, 8), Spine=(6, 0, 6), Chest=(4, 0, 4),
                  RightUpLeg=(-95, 0, 0), RightLeg=(-25, 0, 0), RightFoot=(-8, 0, 0),
                  LeftUpLeg=(25, 0, 0), LeftLeg=(60, 0, 0),
                  LeftArm=(40, -18, 0), RightArm=(-20, 18, 0), Head=(4, 0, 6))),
        (8, p(SPIDER, Hips=(-20, 0, 10), Spine=(7, 0, 7),
                  RightUpLeg=(-98, 0, 0), RightLeg=(-28, 0, 0),
                  LeftUpLeg=(28, 0, 0), LeftLeg=(62, 0, 0))),
        (12, p(SPIDER, Hips=(-6, 0, 2), Spine=(2, 0, 2),
                   RightUpLeg=(-35, 0, 0), RightLeg=(50, 0, 0),
                   LeftUpLeg=(-10, 0, 0), LeftLeg=(30, 0, 0), LeftArm=(12, -5, 0), RightArm=(10, 5, 0))),
        (16, p(SPIDER)),
    ],
    "HitLight": [
        (0, p(SPIDER)),
        (2, p(SPIDER, Hips=(0, 0, -6), Spine=(-10, 0, -5), Chest=(-6, 0, -3),
                  Neck=(9, 0, 4), Head=(14, 0, 6), LeftArm=(14, -8, 0), RightArm=(10, 6, 0),
                  LeftForeArm=(8, 0, 0), RightForeArm=(6, 0, 0))),
        (5, p(SPIDER, Spine=(-4, 0, -2), Neck=(4, 0, 2), Head=(6, 0, 3), LeftArm=(6, -3, 0))),
        (8, p(SPIDER)),
    ],
    "HitHeavy": [
        (0, p(SPIDER)),
        (2, p(SPIDER, Hips=(10, 0, -18), Spine=(-26, 0, -14), Chest=(-18, 0, -8),
                  Neck=(20, 0, 10), Head=(22, 0, 10), LeftArm=(32, -16, 0), RightArm=(24, 14, 0),
                  LeftForeArm=(14, 0, 0), RightForeArm=(12, 0, 0),
                  LeftUpLeg=(-12, 0, 0), RightUpLeg=(8, 0, 0), RightLeg=(14, 0, 0))),
        (5, p(SPIDER, Hips=(6, 0, -12), Spine=(-16, 0, -9), Neck=(12, 0, 6), Head=(14, 0, 7),
                  LeftArm=(20, -10, 0), RightArm=(15, 9, 0))),
        (9, p(SPIDER, Hips=(2, 0, -5), Spine=(-7, 0, -3), Neck=(5, 0, 3), Head=(6, 0, 3),
                  LeftArm=(8, -4, 0), RightArm=(6, 4, 0))),
        (14, p(SPIDER)),
    ],
    "Special": [
        (0, p(SPIDER)),
        (2, p(SPIDER, Hips=(-2, 0, -12), Spine=(-4, 0, -8), Chest=(-3, 0, -5),
                  LeftArm=(30, -10, 0), LeftForeArm=(18, 0, 0),
                  RightArm=(-8, 6, 0), RightForeArm=(-8, 0, 0), Head=(0, 0, -4))),
        (4, p(SPIDER, Hips=(1, 0, 14), Spine=(4, 0, 8), Chest=(3, 0, 5),
                  LeftShoulder=(0, 0, 6), LeftArm=(-95, -4, 0), LeftForeArm=(-2, 0, 0),
                  RightArm=(20, 6, 0), RightForeArm=(10, 0, 0), Head=(-2, 0, 5),
                  LeftLeg=(5, 0, 0), RightLeg=(4, 0, 0))),
        (6, p(SPIDER, Hips=(1, 0, 16), Spine=(4, 0, 9), LeftArm=(-98, -3, 0),
                  LeftForeArm=(-1, 0, 0), Head=(-2, 0, 6))),
        (10, p(SPIDER, Hips=(0, 0, 4), Spine=(2, 0, 2), LeftArm=(-35, 0, 0),
                   LeftForeArm=(-30, 0, 0), RightArm=(-20, 0, 0), RightForeArm=(-30, 0, 0))),
        (16, p(SPIDER)),
    ],
}

PROFILES = {
    "superman": {
        "prefix": "Superman_",
        "source": "public/models/characters/roster/superman.glb",
        "out": "public/models/characters/bespoke/superman_bespoke.glb",
        "clips": SUPERMAN_CLIPS,
    },
    "goku": {
        "prefix": "Goku_",
        "source": "public/models/characters/roster/goku.glb",
        "out": "public/models/characters/bespoke/goku_bespoke.glb",
        "clips": GOKU_CLIPS,
    },
    "spider_man": {
        "prefix": "SpiderMan_",
        "source": "public/models/characters/roster/spider_man.glb",
        "out": "public/models/characters/bespoke/spider_man_bespoke.glb",
        "clips": SPIDER_CLIPS,
    },
}


def main():
    parser = argparse.ArgumentParser(description="Author bespoke combat clips on the 19-bone roster rig.")
    parser.add_argument("--fighter", required=True, choices=sorted(PROFILES))
    parser.add_argument("--source", default=None)
    parser.add_argument("--out", default=None)
    parser.add_argument("--prefix", default=None)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])

    profile = PROFILES[args.fighter]
    source = args.source or profile["source"]
    out = args.out or profile["out"]
    prefix = args.prefix or profile["prefix"]

    import bpy
    bpy.ops.wm.read_factory_settings(use_empty=True)
    armature = ra.import_model(source)
    bone_map = ra.resolve_bone_map(armature, "roster19")
    print("RIG roster19 | " + ", ".join(sorted(set(bone_map.values()))))
    actions = ra.build_actions(armature, profile["clips"], prefix, bone_map)
    ra.to_nla(armature, actions)
    ra.drop_geometry()
    ra.export(armature, out)
    print("ACTIONS " + ", ".join(a.name + ":" + str((a.frame_start, a.frame_end)) for a in actions))


if __name__ == "__main__":
    main()
