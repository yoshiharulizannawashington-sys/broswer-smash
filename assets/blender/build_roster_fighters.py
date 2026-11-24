# Build a rigged, skinned, animated GLB for every fighter on the roster.
#
#   bash scripts/blender.sh -b --python assets/blender/build_roster_fighters.py -- \
#        --out-dir public/models/characters/roster --group launch
#
# Why this exists
# ---------------
# Kaze (assets/blender/build_anime_fighter.py) is the reference fighter: real lofted volumes,
# layered garments, a measured face, a 19-bone armature, hybrid skin weights and eight clips. He
# went through Phase 7 and the geometry kernel behind him is now repaired and regression-tested
# (scripts/test-geometry-kernel.py, npm run test:kaze).
#
# Every other roster fighter was still built at runtime as a primitive assembly - boxes for the
# torso, cylinders for the limbs, spheres for the shoulders (public/js/models.js,
# makeProceduralCharacter) - or, for three of them, as an unskinned Three.js group
# (public/js/characters/sculpted.js). None of those are skinned models, so none of them can be
# driven by the clip system.
#
# This script gives the whole roster the Kaze treatment without forking his anatomy. It imports
# the reference module directly (which is import-safe - its main() is guarded) and reuses:
#
#   * the repaired geometry kernel (loft/shell with real depth and outward winding),
#   * the anatomy: torso with pectorals, one continuous arm and leg tube blended across the
#     joint, modelled hands with curled fingers and an opposed thumb, boots with heel and sole,
#   * the 19-bone armature, the hybrid weighting, and the eight clip actions,
#   * sRGB-correct PBR materials with the surface names the form system matches on.
#
# What varies per fighter is the part that should read as that fighter: the palette, the garment
# layer (wrapped gi / plated armour / suit / robe), the head (bare face, helmet, mask), the hair
# silhouette, signature extras (cape, reactor, pauldrons, emblem, hat, headband, eyewear) and the
# overall build. Garment and head layers are substituted rather than re-authored, so every fighter
# shares the same verified body underneath.
#
# Every export is validated afterwards by scripts/inspect-character-glb.mjs; the roster-wide
# assertions live in scripts/test-roster-models.mjs.

import json
import math

import bmesh
import os
import re
import sys

import bpy

_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# The reference fighter, imported as a library. Guarded main(), so nothing is built on import.
import build_anime_fighter as kernel  # noqa: E402
import roster_phase22 as p22  # noqa: E402  (Phase 22 face and equipment)


ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in ARGV:
        index = ARGV.index(name)
        if index + 1 < len(ARGV):
            return ARGV[index + 1]
    return default


OUT_DIR = arg('--out-dir', 'public/models/characters/roster')
GROUP = arg('--group', 'launch')
ONLY = arg('--only', None)
REPORT = arg('--report', None)
TAU = math.pi * 2
R = math.radians


# --------------------------------------------------------------------------- specs
#
# Archetype is what decides the default design, taken from the roster table in public/js/main.js.
ARCHETYPE = {
    'superman': 'warrior', 'iron_man_tony_stark': 'cyborg', 'hulk_bruce_banner': 'brawler',
    'green_lantern_hal_jordan': 'mage', 'wonder_woman': 'warrior',
    'professor_x_charles_xavier': 'mage', 'the_flash_barry_allen': 'ninja', 'aquaman': 'warrior',
    'doctor_strange': 'mage', 'arnold_schwarzenegger': 'brawler', 'goku': 'warrior',
    'naruto_uzumaki': 'ninja', 'vegeta': 'warrior', 'saitama': 'brawler',
    'l_death_note_style': 'cyborg', 'all_might': 'brawler', 'edward_elric': 'mage',
    'levi_ackerman': 'ninja', 'mario': 'warrior', 'luigi': 'ninja', 'kratos': 'brawler',
    'link': 'ninja', 'master_chief': 'cyborg', 'thor': 'warrior', 'aang': 'mage',
    'madara_uchiha': 'warrior', 'hashirama_senju': 'warrior', 'lord_voldemort': 'mage',
    'sasuke_uchiha': 'ninja', 'edna_mode': 'cyborg', 'captain_jack_sparrow': 'ninja',
    'spider_man': 'ninja', 'iron_spider': 'cyborg', 'kaze': 'warrior',
    'the_rock': 'brawler', 'samuel_l_jackson': 'cyborg', 'bruce_lee': 'ninja',
    'jean_claude_van_damme': 'warrior', 'lucy_liu': 'ninja', 'sigourney_weaver': 'cyborg',
    'keanu_reeves': 'ninja', 'burt_reynolds': 'brawler', 'grace_jones': 'ninja',
    'wolverine_logan': 'ninja', 'roronoa_zoro': 'ninja', 'jotaro_kujo': 'brawler',
    'solid_snake': 'cyborg', 'geralt_of_rivia': 'warrior', 'lara_croft': 'ninja',
    'sephiroth': 'mage', 'doom_slayer': 'brawler', 'shrek': 'brawler', 'aladdin': 'ninja',
    'ariel': 'mage', 'ursula': 'mage', 'sesshomaru': 'mage', 'norman_bates': 'ninja',
    'han_solo': 'cyborg', 'indiana_jones': 'ninja',
}

LAUNCH = [
    'superman', 'iron_man_tony_stark', 'hulk_bruce_banner', 'green_lantern_hal_jordan',
    'wonder_woman', 'professor_x_charles_xavier', 'the_flash_barry_allen', 'aquaman',
    'doctor_strange', 'arnold_schwarzenegger', 'goku', 'naruto_uzumaki', 'vegeta', 'saitama',
    'l_death_note_style', 'all_might', 'edward_elric', 'levi_ackerman', 'mario', 'luigi',
    'kratos', 'link', 'master_chief', 'thor', 'aang', 'madara_uchiha', 'hashirama_senju',
    'lord_voldemort', 'sasuke_uchiha', 'edna_mode', 'captain_jack_sparrow', 'spider_man',
    'iron_spider', 'kaze',
]


def _launch_colours():
    """The launch roster's colours, copied from the `looks` table in public/js/models.js so the
    imported body matches the body it replaces rather than inventing a new palette.

    Values are (garment, secondary, accent, skin, hair); None means \"use the default\".
    """
    return {
        'superman': (0x1653A3, 0x16478F, 0xC62B3B, 0xE8B48C, 0x232028),
        'iron_man_tony_stark': (0x8B1B20, 0xB72B27, 0xE6B64A, 0xC7A18B, None),
        'hulk_bruce_banner': (0x452454, 0x2E1240, 0x75C45B, 0x39894A, 0x24301F),
        'green_lantern_hal_jordan': (0x123D34, 0x1C5745, 0x62F4A6, 0xE8B48C, 0x3A2A22),
        'wonder_woman': (0x87252C, 0x233B75, 0xE0B84E, 0xE8B48C, 0x241A14),
        'professor_x_charles_xavier': (0x303946, 0x56606E, 0x7BCAD7, 0xE8B48C, None),
        'the_flash_barry_allen': (0x941F26, 0xB52A31, 0xE7BF42, 0xE8B48C, None),
        'aquaman': (0x185747, 0xB57926, 0xD7AF51, 0xE8B48C, 0xC9A24E),
        'doctor_strange': (0x3B2424, 0x6F2E2C, 0xD9A746, 0xE8B48C, 0x2A2028),
        'arnold_schwarzenegger': (0x171B22, 0x424B56, 0xB8C4CD, 0xD8A98A, 0x2B2118),
        'goku': (0xE36B20, 0x2864AD, 0xFFC43E, 0xE8B48C, 0x17171B),
        'naruto_uzumaki': (0xE97920, 0x24466E, 0x328ADD, 0xE8B48C, 0xE0C24A),
        'vegeta': (0x1D3459, 0xE0E3E1, 0x3D70BD, 0xE8B48C, 0x16161C),
        'saitama': (0xE2BB36, 0xD8C9A5, 0xA92C2C, 0xE8B48C, None),
        'l_death_note_style': (0xF1EEE6, 0x22232A, 0x596276, 0xE8B48C, 0x1E1B1A),
        'all_might': (0x1B3158, 0xC49A35, 0xBE3440, 0xE8B48C, 0xE9BA47),
        'edward_elric': (0x8F202A, 0x2A2D34, 0xC8BD9B, 0xE8B48C, 0xE4C86A),
        'levi_ackerman': (0x283B4C, 0x526A49, 0xBFC9C9, 0xE8B48C, 0x1F1A18),
        'mario': (0x2C4F9A, 0xD12E29, 0xE9C44A, 0xE8B48C, 0x3A2418),
        'luigi': (0x2E5A41, 0x365DA0, 0xE9C44A, 0xE8B48C, 0x3F2A16),
        'kratos': (0x5E4138, 0x34353A, 0xB32B30, 0xE2DED2, None),
        'link': (0x3E7B3D, 0x326A45, 0xC8B86C, 0xE8B48C, 0xD8BC6A),
        'master_chief': (0x48543A, 0x5A6748, 0xD1BA6C, None, None),
        'thor': (0x1A2B44, 0x8F9AA4, 0xE3BE58, 0xE8B48C, 0xC99E61),
        # Air Nomad blue, not the roster's cyan accent: the arrow is ink on skin, and cyan rendered
        # as a washed-out pale band against a bald head.
        'aang': (0xE1A24F, 0xB86C36, 0x2E6FD0, 0xD2A783, None),
        'madara_uchiha': (0x492E32, 0x7C3D3A, 0xB79362, 0xE8B48C, 0x2A2226),
        'hashirama_senju': (0x325A46, 0x5B3D2F, 0x8A9873, 0xE8B48C, 0x2E241C),
        'lord_voldemort': (0x17181B, 0x2E3035, 0xB6AD9C, 0xD4D0C5, None),
        'sasuke_uchiha': (0x17213B, 0x353D55, 0x5A9CE1, 0xE8B48C, 0x171820),
        'edna_mode': (0x11151B, 0x2A3038, 0xE8E5DF, 0xE8B48C, 0x1A1C22),
        'captain_jack_sparrow': (0x68513E, 0x272E38, 0xB98F52, 0xD8A98A, 0x2A2018),
        'spider_man': (0xC62930, 0x154B91, 0xE54244, 0x8C99A7, None),
        'iron_spider': (0xB81F27, 0xD8A640, 0xFFCF63, 0x8C99A7, None),
        'the_rock': (0x13161C, 0x292E37, 0xE0B94F, 0xC08C63, 0x1A1A1E),
        'samuel_l_jackson': (0x111720, 0x232C38, 0x5C88BC, 0xC08C63, 0x2CB0B4),
        'bruce_lee': (0xF0BD20, 0x171A1E, 0xF8D64D, 0xD8A87C, 0x1C1720),
        'jean_claude_van_damme': (0x6F1720, 0x9B2937, 0xE8D9BB, 0xE8B48C, 0x2A2018),
        'lucy_liu': (0xE4E0D5, 0xF3F0E8, 0x9D1C2D, 0xE8B48C, 0x1A1519),
        'sigourney_weaver': (0x586247, 0x303C34, 0xB7A05C, 0xE8B48C, 0x35271C),
        'keanu_reeves': (0x24405C, 0x2A303B, 0xC93844, 0xE8B48C, 0x1C1C24),
        'burt_reynolds': (0x861E2A, 0xE7E2DA, 0xCA3541, 0xE8B48C, 0x3A2A1C),
        'grace_jones': (0x16151C, 0x34313B, 0xC7A150, 0x7E5C46, 0x14131A),
        'wolverine_logan': (0x174F9D, 0xD3AD26, 0xE7BE35, 0xE8B48C, 0x211A18),
        'roronoa_zoro': (0x246345, 0x2B4638, 0x9AC578, 0xE8B48C, 0x458344),
        'jotaro_kujo': (0x222B52, 0x3D456D, 0xD8B34D, 0xE8B48C, 0x181A22),
        'solid_snake': (0x465363, 0x58616B, 0x8E9CA7, 0xE8B48C, 0x3A3A32),
        'geralt_of_rivia': (0x181C24, 0x41464C, 0x9DB4C7, 0xE8B48C, 0xDFDCD0),
        'lara_croft': (0x9C6B3D, 0x303D44, 0x92784D, 0xE8B48C, 0x3A2618),
        'sephiroth': (0x171A24, 0x2E333C, 0xD8DEE5, 0xE8B48C, 0xE7E6E1),
        'doom_slayer': (0x314538, 0x3E5347, 0x99AD9D, None, None),
        'shrek': (0x6B583B, 0x4A3A24, 0xB0A17A, 0x72A34B, None),
        'aladdin': (0x28634D, 0x70402B, 0xBF9D4C, 0xD8A87C, 0x1E1720),
        'ariel': (0x22806F, 0x6C376F, 0xF2BD5B, 0xF0C7AD, 0xC54435),
        'ursula': (0x482760, 0x3B214F, 0xB89BDB, 0x8871B0, None),
        'sesshomaru': (0xE6E1D5, 0xE8E1D1, 0x9973AD, 0xE6D8C9, 0xEEEAE0),
        'norman_bates': (0x454B55, 0x6C6558, 0xC4BAA3, 0xE8B48C, 0x33261A),
        'han_solo': (0xE6E1D4, 0x28313C, 0xB78E4F, 0xE8B48C, 0x3A2A1A),
        'indiana_jones': (0x65432E, 0x46322A, 0x8C6B42, 0xE8B48C, 0x33241A),
    }


COLOURS = _launch_colours()


def _designs():
    """Per-fighter design: (style, head, hair, extras, build, hat colour, hair colour override).

    Only the fighters that differ from their archetype default need an entry; the default below is
    what an unlisted fighter of that archetype gets. Styles:

      gi     the wrapped jacket over an undershirt, sash, knot, tails and skirt panels (Kaze's)
      armor  a plated shell: chest plate, collar, abdominal bands, pauldrons, bracers, belt
      suit   the body surface itself (no jacket): belt plus optional emblem
      robe   a suit plus a long cape

    Heads: face (bare, with hair), helmet (closed helm, faceplate, visor), mask (masked head with
    lenses), bald (bare, no hair). Extras: cape, pauldrons, emblem, reactor, belt, hat, headband,
    eyewear, beard, ponytail.
    """
    return {
        # ---- launch roster
        'superman': ('suit', 'face', 'short', ['cape', 'emblem'], (1.06, 1.0, 1.08), None, None),
        'iron_man_tony_stark': ('armor', 'helmet', 'none', ['reactor', 'pauldrons'], (1.08, 1.02, 1.02), None, None),
        'hulk_bruce_banner': ('suit', 'face', 'messy', [], (1.34, 1.14, 1.32), None, 0x24301F),
        'green_lantern_hal_jordan': ('suit', 'face', 'short', ['lantern'], (1.0, 1.0, 1.0), None, None),
        'wonder_woman': ('armor', 'face', 'long', ['cape', 'belt'], (1.0, 1.0, 1.03), None, None),
        'professor_x_charles_xavier': ('suit', 'bald', 'none', [], (1.0, 1.0, 1.0), None, None),
        'the_flash_barry_allen': ('suit', 'helmet', 'none', ['emblem'], (1.0, 1.0, 1.0), None, None),
        'aquaman': ('armor', 'face', 'long', ['belt', 'scales', 'collar', 'beard'], (1.04, 1.0, 1.02), None, 0xC9A24E),
        'doctor_strange': ('robe', 'face', 'short', ['cape', 'belt'], (1.0, 1.0, 1.0), None, None),
        'arnold_schwarzenegger': ('armor', 'face', 'short', ['pauldrons'], (1.14, 1.06, 1.12), None, 0x2B2118),
        'goku': ('gi', 'face', 'spikes', [], (1.04, 1.0, 1.04), None, 0x17171B),
        'naruto_uzumaki': ('gi', 'face', 'spikes', ['headband'], (1.0, 1.0, 1.0), None, 0xE0C24A),
        'vegeta': ('armor', 'face', 'widow', ['pauldrons'], (1.04, 1.0, 1.0), None, 0x16161C),
        'saitama': ('suit', 'bald', 'none', ['cape'], (1.04, 1.0, 1.0), None, None),
        'l_death_note_style': ('suit', 'face', 'messy', [], (1.0, 1.0, 1.0), None, 0x1E1B1A),
        'all_might': ('armor', 'face', 'spikes', ['cape', 'pauldrons'], (1.24, 1.06, 1.24), None, 0xE9BA47),
        'edward_elric': ('robe', 'face', 'long', ['cape'], (0.98, 1.0, 1.0), None, 0xE4C86A),
        'levi_ackerman': ('armor', 'face', 'short', ['pauldrons', 'belt'], (0.98, 1.0, 1.0), None, 0x1F1A18),
        'mario': ('suit', 'face', 'short', ['hat', 'beard'], (0.96, 1.02, 0.98), 0xC72E2E, 0x3A2418),
        'luigi': ('suit', 'face', 'short', ['hat', 'beard'], (0.98, 1.0, 1.04), 0x34804A, 0x3F2A16),
        'kratos': ('suit', 'bald', 'none', ['beard', 'pauldrons'], (1.14, 1.0, 1.16), None, None),
        'link': ('gi', 'face', 'long', ['hat'], (0.98, 1.0, 1.0), 0x3E7B3D, 0xD8BC6A),
        'master_chief': ('armor', 'helmet', 'none', ['pauldrons'], (1.12, 1.04, 1.14), None, None),
        'thor': ('armor', 'face', 'long', ['cape', 'pauldrons', 'asgard'], (1.12, 1.02, 1.1), None, 0xC99E61),
        'aang': ('gi', 'bald', 'none', ['emblem'], (0.92, 0.98, 0.94), None, None),
        'madara_uchiha': ('armor', 'face', 'wild', ['pauldrons'], (1.2, 1.02, 1.22), None, 0x2A2226),
        'hashirama_senju': ('armor', 'face', 'long', ['cape'], (1.2, 1.02, 1.22), None, 0x2E241C),
        'lord_voldemort': ('robe', 'bald', 'none', [], (1.06, 0.98, 1.06), None, None),
        'sasuke_uchiha': ('gi', 'face', 'widow', [], (1.0, 1.0, 1.0), None, 0x171820),
        'edna_mode': ('suit', 'face', 'bob', [], (0.84, 0.94, 0.86), None, 0x1A1C22),
        'captain_jack_sparrow': ('robe', 'face', 'dreads', ['headband', 'belt'], (1.0, 1.0, 1.0), None, 0x2A2018),
        'spider_man': ('suit', 'mask', 'none', ['emblem'], (1.0, 1.0, 1.0), None, None),
        'iron_spider': ('armor', 'mask', 'none', ['emblem'], (1.04, 1.0, 1.04), None, None),
        # ---- DLC roster
        'the_rock': ('suit', 'face', 'bald', ['belt'], (1.12, 1.04, 1.1), None, None),
        'samuel_l_jackson': ('armor', 'face', 'short', ['eyewear'], (1.0, 1.0, 1.0), None, None),
        'bruce_lee': ('gi', 'face', 'short', ['belt'], (0.94, 1.0, 0.96), None, 0x1C1720),
        'jean_claude_van_damme': ('suit', 'face', 'short', ['belt'], (1.04, 1.0, 1.02), None, 0x2A2018),
        'lucy_liu': ('suit', 'face', 'long', ['belt'], (0.98, 1.0, 0.98), None, 0x1A1519),
        'sigourney_weaver': ('armor', 'face', 'short', ['pauldrons'], (1.02, 1.0, 1.02), None, 0x35271C),
        'keanu_reeves': ('robe', 'face', 'long', ['cape'], (1.0, 1.0, 1.0), None, 0x1C1C24),
        'burt_reynolds': ('suit', 'face', 'short', ['beard'], (1.08, 1.02, 1.06), None, 0x3A2A1C),
        'grace_jones': ('suit', 'face', 'short', ['belt'], (1.0, 1.0, 1.04), None, 0x14131A),
        'wolverine_logan': ('armor', 'face', 'widow', ['pauldrons'], (1.0, 1.0, 0.98), None, 0x211A18),
        'roronoa_zoro': ('gi', 'face', 'short', ['headband', 'belt'], (1.02, 1.0, 1.0), None, 0x458344),
        'jotaro_kujo': ('suit', 'face', 'wild', ['cape'], (1.18, 1.04, 1.18), None, 0x181A22),
        'solid_snake': ('armor', 'face', 'short', ['headband'], (1.04, 1.0, 1.02), None, 0x3A3A32),
        'geralt_of_rivia': ('armor', 'face', 'long', ['pauldrons'], (1.04, 1.02, 1.02), None, 0xDFDCD0),
        'lara_croft': ('suit', 'face', 'ponytail', ['belt'], (1.0, 1.0, 1.0), None, 0x3A2618),
        'sephiroth': ('robe', 'face', 'long', ['cape', 'pauldrons'], (1.12, 1.0, 1.16), None, 0xE7E6E1),
        'doom_slayer': ('armor', 'helmet', 'none', ['pauldrons'], (1.16, 1.06, 1.16), None, None),
        'shrek': ('suit', 'bald', 'none', [], (1.2, 1.08, 1.16), None, None),
        'aladdin': ('gi', 'face', 'short', ['hat', 'belt'], (0.96, 0.98, 0.96), 0xB72D32, 0x1E1720),
        'ariel': ('suit', 'face', 'long', [], (0.96, 0.98, 0.98), None, 0xC54435),
        'ursula': ('robe', 'bald', 'none', ['cape'], (1.24, 1.16, 1.18), None, None),
        'sesshomaru': ('robe', 'face', 'long', ['cape', 'pauldrons'], (1.1, 1.0, 1.12), None, 0xEEEAE0),
        'norman_bates': ('suit', 'face', 'short', ['belt'], (1.0, 0.98, 1.0), None, 0x33261A),
        'han_solo': ('suit', 'face', 'short', ['belt'], (1.0, 1.0, 1.0), None, 0x3A2A1A),
        'indiana_jones': ('armor', 'face', 'short', ['hat', 'belt'], (1.02, 1.0, 1.02), 0x65432E, 0x33241A),
    }


DESIGNS = _designs()

# Archetype defaults for any fighter without an explicit design.
ARCHETYPE_DEFAULTS = {
    'warrior': ('armor', 'face', 'short', ['pauldrons'], (1.0, 1.0, 1.0), None, None),
    'ninja': ('suit', 'face', 'short', ['belt'], (1.0, 1.0, 1.0), None, None),
    'brawler': ('suit', 'face', 'messy', [], (1.08, 1.02, 1.06), None, None),
    'mage': ('robe', 'face', 'short', ['cape'], (1.0, 1.0, 1.0), None, None),
    'cyborg': ('armor', 'helmet', 'none', ['pauldrons'], (1.04, 1.0, 1.02), None, None),
}

DEFAULT_SKIN = 0xE8B48C
DEFAULT_HAIR = 0x1B1C22


def design_for(slug):
    archetype = ARCHETYPE.get(slug, 'warrior')
    base = DESIGNS.get(slug) or ARCHETYPE_DEFAULTS[archetype]
    return base, archetype


# --------------------------------------------------------------------------- palette


def _hex(value):
    return ((value >> 16 & 255) / 255.0, (value >> 8 & 255) / 255.0, (value & 255) / 255.0)


def _shade(color, factor):
    return tuple(max(0.0, min(1.0, channel * factor)) for channel in color)


def palette_for(slug):
    """Map the fighter's identity colours onto the reference body's material slots.

    Material names are not labels: public/js/anim/form_presentation.js matches `fighter-hair` and
    `fighter-accent` by name, so a transformation retints real surfaces on the imported model.
    """
    garment, secondary, accent, skin, hair = COLOURS.get(
        slug, (0x6A6F7A, 0x3A3F49, 0x62CAFF, DEFAULT_SKIN, DEFAULT_HAIR))
    design, _ = design_for(slug)
    style, head, _hair_style, _extras, _build, _hat, hair_override = design
    if design[6] is not None:
        hair = design[6]
    if skin is None:
        skin = DEFAULT_SKIN
    if hair is None:
        hair = DEFAULT_HAIR
    skin_rgb = _hex(skin)
    hair_rgb = _hex(hair)
    garment_rgb = _hex(garment)
    secondary_rgb = _hex(secondary)
    accent_rgb = _hex(accent)
    # Fabric characters get a dark trouser tone; armoured ones carry the plate colour down the
    # legs so the silhouette reads as one suit of armour rather than armour over jeans.
    leg_rgb = _shade(secondary_rgb, 0.62) if style == 'gi' else _shade(garment_rgb, 0.82)
    # Identity corrections a garment/secondary pair cannot express. L wore white trousers because
    # the non-gi leg rule shades the garment; his jeans are blue. Kratos is ash-white, not tan, and
    # Aang's Air Nomad robe is orange over a darker under-robe.
    trouser_rgb = leg_rgb
    if slug == 'l_death_note_style':
        skin_rgb = _hex(0xF3DBC9)
        trouser_rgb = _hex(0x2C4A72)
    elif slug == 'kratos':
        # Ash-white, not paper-white: the old value clipped to the background under the preview's
        # three-point key, so the head read as a blank mannequin even though the face was there.
        skin_rgb = _hex(0xCFCDC6)
    elif slug == 'aang':
        garment_rgb = _hex(0xDD8A2E)
        secondary_rgb = _hex(0xBE601C)
    elif slug == 'lord_voldemort':
        # Pale grey-flesh: the default tan read as a man in a costume rather than as the Dark Lord.
        skin_rgb = _hex(0xC9C7BF)
    elif slug == 'arnold_schwarzenegger':
        skin_rgb = _hex(0xD8AE8B)
    return {
        'skin': kernel.make_material('fighter-skin', skin_rgb, 0.0, 0.56),
        'skin_dark': kernel.make_material('fighter-skin-shade', _shade(skin_rgb, 0.76), 0.0, 0.62),
        # Hair, beards, brows and eyelashes all share this slot. It was authored as a semi-metal
        # (metalness 0.12, roughness 0.34), which put a hard specular sheen on every hairstyle -
        # L, Edna Mode and Arnold read as moulded plastic at head scale. Keratin is dielectric and
        # matte; the material name is unchanged so form_presentation.js still retints it.
        'hair': kernel.make_material('fighter-hair', hair_rgb, 0.0, 0.62),
        'gi': kernel.make_material('fighter-gi', garment_rgb, 0.06, 0.62),
        'gi_shade': kernel.make_material('fighter-gi-shade', _shade(garment_rgb, 0.68), 0.08, 0.58),
        'trouser': kernel.make_material('fighter-trousers', trouser_rgb, 0.06, 0.64),
        'shirt': kernel.make_material('fighter-undershirt', secondary_rgb, 0.05, 0.66),
        'sash': kernel.make_material('fighter-sash', _shade(secondary_rgb, 0.72), 0.1, 0.6),
        'boot': kernel.make_material('fighter-boot', _shade(hair_rgb, 0.7), 0.26, 0.4),
        'trim': kernel.make_material('fighter-trim', accent_rgb, 0.82, 0.26),
        'eye': kernel.make_material('fighter-eye', (0.930, 0.945, 0.965), 0.0, 0.24),
        'iris': kernel.make_material('fighter-iris', (0.070, 0.290, 0.320), 0.05, 0.22),
        # The emissive band that a transformation lights up.
        'accent': kernel.make_material('fighter-accent', accent_rgb, 0.18, 0.3,
                                       emission=accent_rgb, emission_strength=1.7),
        # Ink for markings painted on skin (Aang's arrow, Kratos's tattoo). It is the same hue as
        # the accent but matte and non-emissive: reuse of 'accent' made every tattoo glow, which is
        # why Aang's blue arrow rendered as pale cyan bars and Kratos's stripe as flat red.
        'ink': kernel.make_material('fighter-ink', accent_rgb, 0.0, 0.64),
        # Beards are coarser and rougher than scalp hair. Sharing 'fighter-hair' left Kratos's beard
        # with a broad specular hot-spot that read as polished plastic at head scale, so it gets its
        # own matte slot at 1.25x the hair value (near-black hair lifts to a visible dark grey).
        # A beard that is only 1.25x the hair is invisible on a blond (Aquaman's gold hair lifted to
        # a pale tone that merged with his skin). Darkening the beard slot for him gives the jaw a
        # real edge at gameplay distance without touching anyone else's.
        'beard': kernel.make_material('fighter-beard',
                                      _shade(hair_rgb, 0.62 if slug == 'aquaman' else 1.25), 0.0, 0.92),
    }


# --------------------------------------------------------------------------- head and hair

FACE_PARTS = ('head', 'eye-', 'iris-', 'pupil-', 'lash-', 'brow-', 'ear-', 'nose', 'mouth',
              'hair', 'fringe', 'sideburn', 'cheek-', 'chin')


def is_face_part(name):
    return name.startswith(FACE_PARTS)


def is_garment_part(name):
    return name.startswith(('gi-jacket', 'lapel-', 'collar', 'sash', 'skirt'))


def drop(parts, predicate):
    """Remove parts from the build *and* delete the Blender objects.

    Dropping an entry from the Python list does not unlink the object: it stays in the collection,
    is never selected for the join, and is then exported as its own static mesh - a second head, or
    twenty hair locks, sitting unweighted at the fighter's origin while the animated body walks away
    from them. That is exactly what the first roster export contained (33 meshes, 13 skinned, 20
    static), and it was invisible to a check that only asks whether *a* skinned mesh exists. Every
    layer substitution below deletes the object it replaces.
    """
    keep = []
    removed = []
    for part in parts:
        (removed if predicate(part.name) else keep).append(part)
    for part in removed:
        mesh = part.data
        bpy.data.objects.remove(part, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    return keep


def build_hair(style, palette):
    """Hair silhouettes layered over the same skull. `locks` is the reference fighter's own set;
    the rest are authored here from the same primitives so no hairstyle is a bare dome."""
    hair = palette['hair']
    if style in ('none', 'bald'):
        return []
    parts = []
    salt = {'short': 0.62, 'bob': 0.78, 'messy': 1.0, 'spikes': 1.22, 'wild': 1.4,
            'widow': 1.1, 'long': 1.3, 'dreads': 1.5, 'ponytail': 1.15}.get(style, 1.0)

    # Scalp: a cap that closes the crown and reaches down to the hairline without covering the face.
    # Hair volume is varied in the ring radii, NOT with object.scale: these parts are built in
    # world space, so scaling the object scales about the world origin. The old `cap.scale` pulled a
    # 'short' cap (salt 0.62 -> z factor 0.939) about 10 cm down the head and put the closed shell
    # over the eyes as a glossy black plate - visible on Superman, Green Lantern, Doctor Strange,
    # Levi and Arnold in artifacts/roster-identity/*/head-front.png - while a 'spikes' cap (1.22)
    # was lifted clear, which is why Goku never showed the band.
    spread = salt * 0.35 + 0.65
    cap = kernel.shell('hair-cap', [
        {'z': 1.660, 'rx': 0.091 * spread, 'ry': 0.107 * spread, 'gap': 1.54},
        {'z': 1.688, 'rx': 0.093 * spread, 'ry': 0.108 * spread, 'gap': 0.98},
        {'z': 1.716, 'rx': 0.089 * spread, 'ry': 0.102 * spread, 'gap': 0.40},
        {'z': 1.740, 'rx': 0.062 * spread, 'ry': 0.072 * spread, 'gap': 0.0},
        {'z': 1.756, 'rx': 0.030 * spread, 'ry': 0.034 * spread, 'gap': 0.0},
    ], hair, segments=26, thickness=0.016, uv_tiles=(2.0, 1.4))
    parts.append(cap)
    # Nape wrap: without it there is a bald band between the cap's rim and the ears.
    if style not in ('spikes', 'widow'):
        parts.append(kernel.shell('hair-nape', [
            {'z': 1.578, 'rx': 0.087, 'ry': 0.101, 'gap': 2.40},
            {'z': 1.626, 'rx': 0.091, 'ry': 0.106, 'gap': 2.42},
            {'z': 1.664, 'rx': 0.093, 'ry': 0.108, 'gap': 2.44},
            {'z': 1.682, 'rx': 0.086, 'ry': 0.101, 'gap': 2.18},
        ], hair, segments=26, thickness=0.011, uv_tiles=(2.0, 1.0)))

    # Blades. A long style hangs, a spiked style stands up, a bob sits round the jaw.
    count = 15 if style in ('long', 'dreads') else 13
    for index in range(count):
        angle = math.radians(-64 + index * (128.0 / max(1, count - 1)))
        base_r = 0.074
        bx, by = math.cos(angle) * base_r, math.sin(angle) * base_r * 0.98
        width = (0.019 + (index % 3) * 0.004) * (1.35 if style == 'spikes' else 1.0)
        drop = {'short': 0.030, 'bob': 0.052, 'messy': 0.040, 'long': 0.118, 'dreads': 0.132,
                'ponytail': 0.062, 'widow': 0.086, 'wild': 0.070}.get(style, 0.078)
        rise = {'spikes': 0.052, 'widow': 0.030, 'wild': 0.044}.get(style, 0.006)
        # Front blades hang over the forehead; on 'long'/'dreads' they reached z 1.568, below the
        # eyes at 1.630. That was the black band still crossing the face on Green Lantern, Levi,
        # Edward, Strange and Arnold after the cap fix. A lock in the front sector is shortened to
        # the brow line and swept up and outward instead of down the face.
        front = max(0.0, -by) / 0.074
        if front > 0.20:
            drop = min(drop, 0.026)
            rise += 0.030 * front
            by -= 0.006 * front
        parts.append(kernel.loft(f'hair-lock-{index}', [
            {'x': bx, 'y': by, 'z': 1.686, 'rx': width, 'ry': width * 0.62},
            {'x': bx * 1.04, 'y': by * 1.04 + 0.004, 'z': 1.700, 'rx': width * 1.10, 'ry': width * 0.60},
            {'x': bx * 1.10, 'y': by * 1.10 - drop * 0.4, 'z': 1.700 - drop * 0.42,
             'rx': width * 0.80, 'ry': width * 0.44},
            {'x': bx * (1.13 + rise), 'y': by * (1.09 + rise) - drop, 'z': 1.706 - drop,
             'rx': width * 0.16, 'ry': width * 0.11},
        ], hair, segments=8, uv_tiles=(1.0, 1.0)))

    # Inner row: shorter clumps filling the gaps between the long blades. One ring of blades left
    # strips of bare cap visible between them under the preview/key lighting.
    for index in range(11):
        angle = math.radians(-78 + index * 15.6)
        bx, by = math.cos(angle) * 0.066, math.sin(angle) * 0.066 * 0.98
        width = 0.0125 + (index % 3) * 0.0028
        drop = 0.024 + (index % 4) * 0.007
        parts.append(kernel.loft(f'hair-lock-inner-{index}', [
            {'x': bx * 0.94, 'y': by * 0.94, 'z': 1.690, 'rx': width, 'ry': width * 0.60},
            {'x': bx * 1.02, 'y': by * 1.02, 'z': 1.708, 'rx': width * 1.10, 'ry': width * 0.62},
            {'x': bx * 1.10, 'y': by * 1.06 - drop * 0.5, 'z': 1.716 - drop * 0.5,
             'rx': width * 0.74, 'ry': width * 0.42},
            {'x': bx * 1.16, 'y': by * 1.08 - drop, 'z': 1.720 - drop,
             'rx': width * 0.16, 'ry': width * 0.11},
        ], hair, segments=8, uv_tiles=(1.0, 1.0)))

    # Sideburns: the locks that tie the hair mass to the jaw instead of ending at the ear.
    if style not in ('bob', 'dreads'):
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.loft(f'sideburn-{tag}', [
                {'x': side * 0.074, 'y': kernel.head_front_y(side * 0.062, 1.680) - 0.004, 'z': 1.686,
                 'rx': 0.0125, 'ry': 0.0105},
                {'x': side * 0.077, 'y': kernel.head_front_y(side * 0.060, 1.646) - 0.004, 'z': 1.646,
                 'rx': 0.0105, 'ry': 0.0086},
                {'x': side * 0.079, 'y': kernel.head_front_y(side * 0.058, 1.612) - 0.003, 'z': 1.612,
                 'rx': 0.0058, 'ry': 0.0048},
            ], hair, segments=8, uv_tiles=(0.8, 1.0)))

    if style == 'ponytail':
        parts.append(kernel.loft('hair-tie', [
            {'y': 0.086, 'z': 1.690, 'rx': 0.030, 'ry': 0.026},
            {'y': 0.100, 'z': 1.664, 'rx': 0.026, 'ry': 0.022},
            {'y': 0.112, 'z': 1.596, 'rx': 0.020, 'ry': 0.017},
            {'y': 0.118, 'z': 1.520, 'rx': 0.012, 'ry': 0.010},
        ], hair, segments=10, uv_tiles=(1.0, 1.4)))
    if style in ('spikes', 'wild', 'widow'):
        # The standing crown that makes an anime silhouette read at fighting distance.
        for index in range(7):
            angle = math.radians(-70 + index * 23)
            bx, by = math.cos(angle) * 0.058, math.sin(angle) * 0.058 * 0.9
            height = 0.072 + (index % 3) * 0.030
            parts.append(kernel.loft(f'hair-spike-{index}', [
                {'x': bx, 'y': by - 0.004, 'z': 1.734, 'rx': 0.022, 'ry': 0.015},
                {'x': bx * 1.3, 'y': by * 1.1, 'z': 1.774, 'rx': 0.017, 'ry': 0.011},
                {'x': bx * 1.7, 'y': by * 1.2, 'z': 1.774 + height, 'rx': 0.005, 'ry': 0.004},
            ], hair, segments=7, uv_tiles=(0.8, 1.0)))
    if style != 'spikes':
        # Fringe: short blades across the hairline, above the brows.
        for index in range(5):
            fx = (index - 2) * 0.026
            lean = (index - 2) * 0.010
            parts.append(kernel.loft(f'fringe-{index}', [
                {'x': fx * 0.72, 'y': kernel.head_front_y(fx * 0.72, 1.712) - 0.006, 'z': 1.712,
                 'rx': 0.017, 'ry': 0.011},
                {'x': fx * 0.92 + lean, 'y': kernel.head_front_y(fx * 0.92 + lean, 1.694) - 0.009,
                 'z': 1.694, 'rx': 0.016, 'ry': 0.010},
                {'x': fx + lean * 1.6, 'y': kernel.head_front_y(fx + lean * 1.6, 1.678) - 0.008,
                 'z': 1.678, 'rx': 0.010, 'ry': 0.007},
            ], hair, segments=10, uv_tiles=(1.0, 1.0)))
    return parts


def build_helmet(palette, closed=True):
    """A closed helm over the same skull, plus a gold faceplate, an emissive visor slit and a crest.
    Used for Master Chief, Doom Slayer, Iron Man, Arnold and the Flash's cowl."""
    plate = palette['gi']
    trim = palette['trim']
    accent = palette['accent']
    parts = []
    parts.append(kernel.loft('head-helmet', [
        {'z': 1.498, 'rx': 0.058, 'ry': 0.070, 'front': 1.06},
        {'z': 1.526, 'rx': 0.074, 'ry': 0.088, 'front': 1.04},
        {'z': 1.562, 'rx': 0.088, 'ry': 0.100, 'front': 1.02, 'back': 1.04},
        {'z': 1.610, 'rx': 0.096, 'ry': 0.106, 'front': 0.99, 'back': 1.06},
        {'z': 1.664, 'rx': 0.094, 'ry': 0.102, 'front': 0.97, 'back': 1.05},
        {'z': 1.712, 'rx': 0.078, 'ry': 0.084},
        {'z': 1.744, 'rx': 0.046, 'ry': 0.050},
    ], plate, segments=26, uv_tiles=(2.0, 1.8)))
    # Faceplate: its own shell so the mask reads as a separate plate rather than a smooth egg.
    parts.append(kernel.loft('head-faceplate', [
        {'z': 1.508, 'rx': 0.050, 'ry': 0.062, 'front': 1.22},
        {'z': 1.552, 'rx': 0.066, 'ry': 0.080, 'front': 1.18},
        {'z': 1.600, 'rx': 0.074, 'ry': 0.084, 'front': 1.12},
        {'z': 1.646, 'rx': 0.066, 'ry': 0.076, 'front': 1.04},
    ], trim, segments=20, cap_start=False, cap_end=False, uv_tiles=(1.6, 1.0)))
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        parts.append(kernel.box(f'eye-slit-{tag}', (0.044, 0.014, 0.016),
                                (side * 0.032, -0.098, 1.604), accent, rotation=(0, side * 0.16, side * -0.12)))
        parts.append(kernel.box(f'head-pod-{tag}', (0.030, 0.056, 0.080),
                                (side * 0.094, 0.004, 1.578), plate))
        parts.append(kernel.box(f'head-pod-light-{tag}', (0.014, 0.014, 0.014),
                                (side * 0.106, -0.016, 1.596), accent))
    parts.append(kernel.box('head-vent', (0.052, 0.014, 0.016), (0.0, -0.096, 1.524), trim))
    if closed:
        parts.append(kernel.box('head-crest', (0.024, 0.090, 0.032), (0.0, -0.004, 1.734), trim,
                                rotation=(0.12, 0, 0)))
    return parts


def build_mask(palette):
    """A masked head: suit shell, raised rim, angular lenses and seam lines (Spider-Man,
    Iron Spider, the Flash's cowl when masked)."""
    suit = palette['gi']
    trim = palette['trim']
    lens = palette['eye']
    parts = []
    parts.append(kernel.loft('head-mask', [
        {'z': 1.498, 'rx': 0.056, 'ry': 0.066, 'front': 1.06},
        {'z': 1.526, 'rx': 0.076, 'ry': 0.090, 'front': 1.04},
        {'z': 1.564, 'rx': 0.090, 'ry': 0.102, 'front': 1.02, 'back': 1.04},
        {'z': 1.614, 'rx': 0.096, 'ry': 0.106, 'front': 0.99, 'back': 1.06},
        {'z': 1.666, 'rx': 0.092, 'ry': 0.100, 'front': 0.97, 'back': 1.05},
        {'z': 1.714, 'rx': 0.076, 'ry': 0.082},
        {'z': 1.742, 'rx': 0.044, 'ry': 0.048},
    ], suit, segments=26, uv_tiles=(2.0, 1.8)))
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        parts.append(kernel.box(f'brow-rim-{tag}', (0.066, 0.030, 0.018),
                                (side * 0.038, -0.090, 1.600),
                                palette['gi_shade'], rotation=(0, side * 0.20, side * -0.20)))
        parts.append(kernel.box(f'eye-lens-{tag}', (0.050, 0.020, 0.013),
                                (side * 0.038, -0.098, 1.598),
                                lens, rotation=(0, side * 0.20, side * -0.20)))
    parts.append(kernel.box('mask-brow', (0.052, 0.012, 0.013), (0.0, -0.094, 1.634), trim,
                            rotation=(0.18, 0, 0)))
    return parts


# --------------------------------------------------------------------------- garment layers


def build_armour_layer(palette, extras, gloves=True):
    """The plated alternative to the wrapped gi: chest shell, collar, abdominal bands, back plate,
    a belt and - when the design asks for them - pauldrons and a reactor.

    `gloves` closes the arm. The reference body wears a short gi sleeve over skin forearms, which is
    right for a martial artist and wrong for a suit of armour: without the bracer below, an armoured
    fighter would show bare hands and forearms under nine plates.
    """
    plate = palette['gi']
    plate_dark = palette['gi_shade']
    trim = palette['trim']
    accent = palette['accent']
    parts = []
    # The shell has to clear the torso it covers, not merely sit beside it. The reference body's
    # chest swells to rx 0.190 around z=1.33 and then falls away fast to 0.128 by the shoulder
    # shelf, so a breastplate of rx 0.184 put the undershirt straight through the chest plate.
    # These radii hold 8-19 mm of clearance at every band, and the last ring stops below the
    # shelf instead of chasing the shoulder taper.
    parts.append(kernel.shell('torso-plate', [
        {'z': 0.985, 'rx': 0.158, 'ry': 0.112, 'gap': 0.0},
        {'z': 1.075, 'rx': 0.156, 'ry': 0.108, 'gap': 0.0},
        {'z': 1.180, 'rx': 0.172, 'ry': 0.118, 'gap': 0.0, 'front': 1.04},
        {'z': 1.286, 'rx': 0.199, 'ry': 0.126, 'gap': 0.0, 'front': 1.06},
        {'z': 1.360, 'rx': 0.207, 'ry': 0.122, 'gap': 0.0, 'front': 1.02},
        {'z': 1.416, 'rx': 0.168, 'ry': 0.104, 'gap': 0.0},
    ], plate, segments=28, thickness=0.013, uv_tiles=(2.2, 2.0)))
    # The collar wraps the neck *above* the torso's shoulder shelf. The first version sat at
    # rx 0.118 across z 1.396-1.452, which is inside a torso that is still 0.186 wide there - it
    # was built, exported and completely invisible.
    parts.append(kernel.shell('collar-plate', [
        {'z': 1.436, 'rx': 0.106, 'ry': 0.088, 'gap': 0.0},
        {'z': 1.462, 'rx': 0.094, 'ry': 0.080, 'gap': 0.0},
        {'z': 1.480, 'rx': 0.076, 'ry': 0.068, 'gap': 0.0},
    ], plate_dark, segments=22, thickness=0.010, uv_tiles=(1.6, 0.8)))
    # Abdominal bands read as segmented armour rather than one smooth cylinder. Aquaman's scale
    # mail replaces them: the first pass built the scales on top of these gold bands and the two
    # rows of gold edges showed through the gaps, so the chest read as a ribbed vest with curls on
    # it instead of as armour. No bands, one surface.
    for row in (() if 'scales' in extras else range(3)):
        half = 0.152 - row * 0.010
        parts.append(kernel.box(f'torso-ab-{row}', (half * 1.5, 0.055, 0.060),
                                (0.0, -0.100 + row * 0.006, 1.196 - row * 0.062), trim,
                                rotation=(0.05, 0, 0)))
    # Thor: the three flat abdominal bands above are the generic armour read. On Asgard's prince
    # they are replaced visually by a six-plate stack - paired raised plates per row, each with a
    # gold divider down the centre line and a bevel that catches the key light. Same z range and the
    # same 10 mm of clearance over the bands, so nothing can intersect the torso shell.
    if 'asgard' in extras:
        # Sectional read needs its own materials: gold plates at a darker brass value than the
        # breastplate, and a near-black seam, so each of the six sections is separated by shadow
        # rather than by a 6 mm line that disappears at six metres.
        ab_gold = kernel.make_material('thor-ab-gold', (0.60, 0.45, 0.19), 0.92, 0.34)
        ab_seam = kernel.make_material('thor-ab-seam', (0.05, 0.045, 0.04), 0.45, 0.82)
        for row in range(3):
            z = 1.196 - row * 0.062
            half_w = 0.096 - row * 0.006
            for side in (-1, 1):
                tag = 'L' if side < 0 else 'R'
                # Gold section, not a navy plate over a gold band: the gold cross-hatch came from
                # the generic bands showing between dark plates. Gold plates close over them and a
                # 6 mm dark seam is all that shows between sections.
                parts.append(kernel.box(f'torso-ab-plate-{row}-{tag}', (half_w, 0.030, 0.049),
                                        (side * (half_w * 0.5 + 0.007), -0.127 + row * 0.006, z),
                                        ab_gold, rotation=(0.05, 0, side * -0.05)))
            parts.append(kernel.box(f'torso-ab-ridge-{row}', (0.010, 0.036, 0.050),
                                    (0.0, -0.127 + row * 0.006, z), ab_seam))
            # Horizontal seam between sections: without it the three rows fused into one slab.
            parts.append(kernel.box(f'torso-ab-seam-{row}', (0.205 - row * 0.014, 0.036, 0.010),
                                    (0.0, -0.127 + row * 0.006, z + 0.030), ab_seam))
        # Oblique plates over the lower ribs close the gap between the ab stack and the belt.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-oblique-{tag}', (0.030, 0.026, 0.086),
                                    (side * 0.142, -0.112, 1.058), plate_dark,
                                    rotation=(0.05, 0, side * 0.28)))
    if 'scales' in extras:
        # Atlantean scale mail. The three flat gold bands under this block are the generic armour
        # read and at six metres they look like luggage straps; overlapping scales in two greens with
        # a gold border say "Aquaman" before the trident is legible. Smaller scales were tried in
        # the first pass and vanished into a shimmer at gameplay distance, so each plate is 6 cm
        # wide and 4 cm tall with a 4 mm gold edge.
        scale_a = kernel.make_material('aqua-scale', (0.13, 0.42, 0.34), 0.35, 0.36)
        scale_b = kernel.make_material('aqua-scale-dark', (0.08, 0.29, 0.24), 0.30, 0.42)
        for row in range(5):
            z = 1.330 - row * 0.062
            half = 0.150 - row * 0.008
            count = 5 if row < 3 else 4
            step = (half * 2) / count
            for col in range(count):
                x = -half + step * (col + 0.5) + (step * 0.5 if row % 2 else 0.0)
                if abs(x) > 0.168:
                    continue
                material = scale_a if (row + col) % 2 == 0 else scale_b
                parts.append(kernel.sphere(f'torso-scale-{row}-{col}', 0.034,
                                           (x, -0.136 - row * 0.002, z), material,
                                           scale=(1.06, 0.34, 0.66), segments=14, rings=8))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-scale-border-{tag}', (0.012, 0.030, 0.150),
                                    (side * 0.166, -0.116, 1.196), trim,
                                    rotation=(0, 0, side * 0.06)))
        parts.append(kernel.box('torso-scale-top', (0.176, 0.030, 0.012), (0.0, -0.120, 1.368), trim))
    if 'collar' in extras:
        # A raised Atlantean gorget over the breastplate collar, with a V at the sternum.
        parts.append(kernel.shell('torso-collar-gorget', [
            {'z': 1.438, 'rx': 0.124, 'ry': 0.104},
            {'z': 1.478, 'rx': 0.110, 'ry': 0.092},
            {'z': 1.506, 'rx': 0.086, 'ry': 0.075},
        ], trim, segments=24, thickness=0.011, uv_tiles=(1.8, 0.8)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-collar-v-{tag}', (0.014, 0.026, 0.086),
                                    (side * 0.040, -0.118, 1.424), trim,
                                    rotation=(0, 0, side * 0.42)))
    parts.append(kernel.box('torso-back-plate', (0.210, 0.060, 0.215), (0.0, 0.108, 1.300), plate,
                            rotation=(-0.05, 0, 0)))
    if 'reactor' in extras:
        parts.append(kernel.torus('torso-reactor-housing', 0.062, 0.015, (0.0, -0.124, 1.330),
                                  trim, rotation=(math.radians(90), 0, 0)))
        reactor = kernel.make_material('arc-reactor', (0.85, 0.97, 1.0), 0.2, 0.18,
                                       emission=(0.45, 0.85, 1.0), emission_strength=3.0)
        parts.append(kernel.sphere('torso-reactor-lens', 0.043, (0.0, -0.128, 1.330), reactor,
                                   scale=(1.0, 0.45, 1.0), segments=18, rings=10))
    elif 'emblem' in extras:
        parts.append(kernel.box('torso-emblem', (0.100, 0.052, 0.115), (0.0, -0.118, 1.302), trim))
    if 'pauldrons' in extras:
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.sphere(f'upperarm-pauldron-{tag}', 0.082,
                                       (side * kernel.SHOULDER_X, 0.004, 1.398), plate,
                                       scale=(1.30, 1.02, 1.06), segments=18, rings=11))
            parts.append(kernel.box(f'upperarm-pauldron-trim-{tag}', (0.100, 0.034, 0.112),
                                    (side * (kernel.SHOULDER_X + 0.014), 0.004, 1.352), trim,
                                    rotation=(0, 0, side * -0.14)))
    # The belt is not an optional extra on an armoured fighter: it closes the gap between the chest
    # shell and the plate skirt, so it is always built.
    parts.append(kernel.shell('sash-belt', [
        {'z': 0.908, 'rx': 0.156, 'ry': 0.112},
        {'z': 0.936, 'rx': 0.163, 'ry': 0.117},
        {'z': 0.966, 'rx': 0.160, 'ry': 0.115},
        {'z': 0.988, 'rx': 0.148, 'ry': 0.107},
    ], palette['sash'], segments=26, thickness=0.012, uv_tiles=(2.0, 0.6)))
    parts.append(kernel.box('torso-belt-buckle', (0.062, 0.030, 0.056), (0.0, -0.116, 0.944), trim))
    if gloves:
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'forearm-bracer-{tag}', [
                {'x': base + side * 0.016, 'z': 1.108, 'rx': 0.052, 'ry': 0.053},
                {'x': base + side * 0.018, 'z': 1.042, 'rx': 0.053, 'ry': 0.054},
                {'x': base + side * 0.020, 'z': 0.958, 'rx': 0.046, 'ry': 0.047},
                {'x': base + side * 0.021, 'z': 0.886, 'rx': 0.037, 'ry': 0.038},
            ], plate, segments=20, thickness=0.008, uv_tiles=(1.6, 1.0)))
            parts.append(kernel.sphere(f'forearm-elbow-plate-{tag}', 0.050,
                                       (base + side * 0.014, 0.004, 1.112), plate_dark,
                                       scale=(1.02, 1.0, 1.0), segments=14, rings=9))
            parts.append(kernel.shell(f'palm-gauntlet-{tag}', [
                {'x': base + side * 0.022, 'z': 0.868, 'rx': 0.031, 'ry': 0.033},
                {'x': base + side * 0.023, 'z': 0.828, 'rx': 0.035, 'ry': 0.043},
                {'x': base + side * 0.024, 'z': 0.790, 'rx': 0.035, 'ry': 0.044},
            ], trim, segments=16, thickness=0.007, uv_tiles=(1.0, 1.0)))
    # Plate skirt over the hips, matching the gi's panels so armoured hips stay covered.
    for name, px, py, rx, ry in [('skirt-back', 0.0, 0.100, 0.112, 0.013),
                                 ('skirt-front', 0.0, -0.098, 0.106, 0.012)]:
        parts.append(kernel.loft(name, [
            {'x': px, 'y': py * 0.96, 'z': 0.906, 'rx': rx * 0.94, 'ry': ry},
            {'x': px, 'y': py, 'z': 0.856, 'rx': rx, 'ry': ry},
            {'x': px, 'y': py * 1.04, 'z': 0.802, 'rx': rx * 1.02, 'ry': ry * 1.05},
            {'x': px, 'y': py * 1.06, 'z': 0.764, 'rx': rx * 0.88, 'ry': ry},
        ], plate, segments=16, uv_tiles=(1.2, 1.4)))
    return parts


def build_signature_details(slug, palette):
    """Per-identity details the shared archetype layers cannot express.

    The launch bodies are generated from one anatomy plus a garment/head/hair/extra spec, so two
    fighters with the same spec are the same model in another colour. Goku and Iron Man are the
    visual benchmarks for the roster, and the details that make each of them readable at fighting
    distance are identity-specific rather than archetype-specific:

      goku   a forward anime fringe over the brow (the `spikes` hairstyle deliberately skips the
             shared fringe), sideburn locks framing the face, and blue wrist wraps closing the gi
             sleeve onto the forearm the way the reference design does
      iron   the emissive palm repulsors: two lit lenses and their housings on the hands, so the
      man    suit reads as powered armour rather than a red-and-gold statue, and the flight and
             repulsor animations have a visible emitter to fire from

    Part names follow the weighting contract in `kernel.bone_for_part`: `head-`/`fringe`/`sideburn`
    ride the head bone, `wrap-` rides the forearm, `palm-` rides the hand.
    """
    parts = []
    if slug == 'goku':
        hair = palette['hair']
        # Forward fringe: five tapered blades on the measured brow line, falling away from the
        # crown. The spikes give the silhouette; without this the forehead is bare under them.
        for index in range(5):
            fx = (index - 2) * 0.022
            lean = (index - 2) * 0.012
            parts.append(kernel.loft(f'fringe-blade-{index}', [
                {'x': fx * 0.70, 'y': kernel.head_front_y(fx * 0.70, 1.722) - 0.004, 'z': 1.722,
                 'rx': 0.016, 'ry': 0.010},
                {'x': fx * 0.94 + lean * 0.5, 'y': kernel.head_front_y(fx * 0.94, 1.700) - 0.011,
                 'z': 1.700, 'rx': 0.017, 'ry': 0.011},
                {'x': fx + lean, 'y': kernel.head_front_y(fx + lean, 1.680) - 0.010,
                 'z': 1.680, 'rx': 0.011, 'ry': 0.008},
                {'x': fx + lean * 1.5, 'y': kernel.head_front_y(fx + lean * 1.5, 1.668) - 0.006,
                 'z': 1.668, 'rx': 0.004, 'ry': 0.003},
            ], hair, segments=9, uv_tiles=(1.0, 1.0)))
        # Sideburns: the locks that tie the hair mass to the jaw instead of stopping at the ear.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.loft(f'sideburn-{tag}', [
                {'x': side * 0.082, 'y': 0.006, 'z': 1.648, 'rx': 0.012, 'ry': 0.016},
                {'x': side * 0.080, 'y': 0.004, 'z': 1.612, 'rx': 0.010, 'ry': 0.013},
                {'x': side * 0.077, 'y': 0.002, 'z': 1.586, 'rx': 0.005, 'ry': 0.007},
            ], hair, segments=8, uv_tiles=(1.0, 1.0)))
        # Wrist wraps: a closed band over the sleeve end with a knot on the outer side. The gi's
        # forearm is bare skin on the reference body, which is right for a martial artist only if
        # the wraps close it.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'forearm-wrap-{tag}', [
                {'x': base + side * 0.018, 'z': 1.020, 'rx': 0.050, 'ry': 0.051},
                {'x': base + side * 0.019, 'z': 0.975, 'rx': 0.049, 'ry': 0.050},
                {'x': base + side * 0.020, 'z': 0.930, 'rx': 0.043, 'ry': 0.044},
                {'x': base + side * 0.021, 'z': 0.898, 'rx': 0.036, 'ry': 0.037},
            ], palette['shirt'], segments=20, thickness=0.007, uv_tiles=(1.4, 0.8)))
            parts.append(kernel.sphere(f'forearm-wrap-knot-{tag}', 0.016,
                                       (base + side * 0.060, -0.014, 0.952), palette['sash'],
                                       scale=(0.70, 0.90, 1.30), segments=12, rings=8))
    if slug == 'iron_man_tony_stark':
        # Palm repulsor: a recessed housing ring around a lit lens that faces the palm's forward
        # side, so a firing pose points a visible emitter at the target.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * (kernel.SHOULDER_X + 0.022)
            parts.append(kernel.torus(f'palm-repulsor-housing-{tag}', 0.028, 0.008,
                                      (base, -0.010, 0.828), palette['trim'],
                                      rotation=(math.radians(90), 0, 0)))
            parts.append(kernel.sphere(f'palm-repulsor-lens-{tag}', 0.023,
                                       (base, -0.014, 0.828), palette['accent'],
                                       scale=(1.0, 0.30, 1.0), segments=16, rings=9))
            parts.append(kernel.box(f'palm-repulsor-slit-{tag}', (0.034, 0.010, 0.006),
                                    (base, -0.018, 0.856), palette['trim']))
        # Chest vents: three dark slits under the reactor, so the breastplate reads as machined
        # panel work instead of one smooth shell lit by a single glow.
        for row in range(3):
            parts.append(kernel.box(f'torso-chest-vent-{row}', (0.050, 0.012, 0.006),
                                    (0.0, -0.126 + row * 0.002, 1.246 - row * 0.020),
                                    palette['gi_shade']))
    if slug == 'vegeta':
        # Scouter: the accessory that makes Vegeta readable in one silhouette. A brass ring over
        # the left eye, a lit lens behind it, and a temple arm that runs back to the ear.
        parts.append(kernel.torus('head-scouter-rim', 0.022, 0.006, (0.044, -0.093, 1.601),
                                  palette['trim'], rotation=(math.radians(90), 0, math.radians(-14))))
        parts.append(kernel.sphere('head-scouter-lens', 0.017, (0.044, -0.096, 1.601),
                                   palette['accent'], scale=(1.0, 0.36, 1.0), segments=16, rings=9))
        parts.append(kernel.box('head-scouter-arm', (0.078, 0.012, 0.012), (0.074, -0.026, 1.604),
                                palette['trim'], rotation=(0, 0, math.radians(-6))))
        parts.append(kernel.box('head-scouter-hinge', (0.014, 0.020, 0.022), (0.090, -0.050, 1.602),
                                palette['gi_shade']))
        # White-and-gold Saiyan armour over the navy suit. The shared armour layer paints the chest
        # in the garment colour, so without these plates Vegeta reads as a blue mannequin.
        #
        # These were flat boxes (a 0.176 x 0.030 x 0.190 placard floating in front of the sternum,
        # plus a second navy box on top of it) which is why the chest read as a blue signboard: a
        # plate that does not follow the surface only covers a rectangle of it, and the navy torso
        # shell showed through around the edges. They are now lofted shells at the torso's own
        # radii, held 6-10 mm proud of the suit, with the trim as its own curved band.
        plate_white = kernel.make_material('fighter-armor-white', (0.91, 0.92, 0.90), 0.15, 0.38)
        gold = kernel.make_material('fighter-armor-gold', (0.80, 0.62, 0.22), 0.85, 0.30)
        parts.append(kernel.shell('torso-saiyan-breastplate', [
            {'z': 0.990, 'rx': 0.196, 'ry': 0.126, 'gap': 0.0},
            {'z': 1.072, 'rx': 0.201, 'ry': 0.129, 'gap': 0.0},
            {'z': 1.180, 'rx': 0.213, 'ry': 0.135, 'gap': 0.0, 'front': 1.04},
            {'z': 1.292, 'rx': 0.223, 'ry': 0.140, 'gap': 0.0, 'front': 1.06},
            {'z': 1.368, 'rx': 0.217, 'ry': 0.133, 'gap': 0.0, 'front': 1.02},
            {'z': 1.418, 'rx': 0.178, 'ry': 0.114, 'gap': 0.0},
        ], plate_white, segments=28, thickness=0.012, uv_tiles=(2.2, 1.8)))
        # Raised sternum ridge: the vertical panel that makes the cuirass read as layered rather
        # than as one smooth shell under a light.
        parts.append(kernel.loft('torso-saiyan-sternum', [
            {'y': -0.146, 'z': 1.128, 'rx': 0.052, 'ry': 0.013},
            {'y': -0.154, 'z': 1.222, 'rx': 0.064, 'ry': 0.016},
            {'y': -0.156, 'z': 1.318, 'rx': 0.058, 'ry': 0.015},
            {'y': -0.146, 'z': 1.392, 'rx': 0.034, 'ry': 0.009},
        ], plate_white, segments=16, uv_tiles=(1.2, 1.6)))
        # Gold bands: collar and the pectoral seam, both curved with the plate they sit on.
        parts.append(kernel.shell('torso-saiyan-collar', [
            {'z': 1.404, 'rx': 0.186, 'ry': 0.120, 'gap': 0.0},
            {'z': 1.428, 'rx': 0.160, 'ry': 0.106, 'gap': 0.0},
            {'z': 1.446, 'rx': 0.124, 'ry': 0.086, 'gap': 0.0},
        ], gold, segments=26, thickness=0.009, uv_tiles=(1.8, 0.5)))
        parts.append(kernel.shell('torso-saiyan-seam', [
            {'z': 1.196, 'rx': 0.218, 'ry': 0.138, 'gap': 0.0, 'front': 1.05},
            {'z': 1.214, 'rx': 0.219, 'ry': 0.139, 'gap': 0.0, 'front': 1.05},
        ], gold, segments=26, thickness=0.006, uv_tiles=(1.6, 0.3)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            # Shoulder plates: a shaped loft that runs over the deltoid and rounds off downward.
            # The sphere it replaces read as a white ball stuck to the arm because it was
            # symmetric in every direction; this one is wide across the shoulder and thin
            # front-to-back, so it has a plate's silhouette from every angle.
            shoulder_x = side * kernel.SHOULDER_X
            parts.append(kernel.loft(f'upperarm-saiyan-pauldron-{tag}', [
                {'x': shoulder_x - side * 0.012, 'y': 0.0, 'z': 1.424, 'rx': 0.066, 'ry': 0.056},
                {'x': shoulder_x + side * 0.008, 'y': 0.0, 'z': 1.394, 'rx': 0.104, 'ry': 0.080},
                {'x': shoulder_x + side * 0.018, 'y': 0.0, 'z': 1.356, 'rx': 0.112, 'ry': 0.083},
                {'x': shoulder_x + side * 0.022, 'y': 0.0, 'z': 1.318, 'rx': 0.096, 'ry': 0.069},
            ], plate_white, segments=20, uv_tiles=(1.6, 1.2)))
            parts.append(kernel.loft(f'upperarm-saiyan-pauldron-rim-{tag}', [
                {'x': shoulder_x + side * 0.022, 'y': 0.0, 'z': 1.320, 'rx': 0.098, 'ry': 0.071},
                {'x': shoulder_x + side * 0.024, 'y': 0.0, 'z': 1.302, 'rx': 0.089, 'ry': 0.064},
            ], gold, segments=20, uv_tiles=(1.4, 0.4)))
            parts.append(kernel.loft(f'torso-saiyan-strap-{tag}', [
                {'x': side * 0.056, 'y': -0.140, 'z': 1.410, 'rx': 0.030, 'ry': 0.012},
                {'x': side * 0.082, 'y': -0.132, 'z': 1.372, 'rx': 0.034, 'ry': 0.013},
                {'x': side * 0.104, 'y': -0.112, 'z': 1.336, 'rx': 0.032, 'ry': 0.012},
            ], gold, segments=12, uv_tiles=(1.0, 0.8)))
        # Standing crown: the flame-shaped hair is the other half of the silhouette, and the shared
        # 'widow' style alone tops out at 3 cm of rise.
        #
        # Five blades 3 cm apart merged into one dark mass at gameplay distance. Seven blades on a
        # fan that also spreads front-to-back (y -0.034 ... +0.050) and in height (0.086 ... 0.165)
        # keep separate tips and separate gaps, which is what makes the shape read.
        hair = palette['hair']
        for index in range(7):
            spread = (index - 3) / 3.0
            bx = spread * 0.047
            by = 0.014 - spread * 0.038
            height = 0.086 + abs(spread) * 0.038 + (0.030 if index == 3 else 0.0)
            parts.append(kernel.loft(f'hair-crown-{index}', [
                {'x': bx, 'y': by, 'z': 1.738, 'rx': 0.015, 'ry': 0.011},
                {'x': bx * 1.34, 'y': by - 0.014, 'z': 1.780, 'rx': 0.010, 'ry': 0.008},
                {'x': bx * 1.70, 'y': by - 0.030, 'z': 1.780 + height, 'rx': 0.003, 'ry': 0.002},
            ], hair, segments=7, uv_tiles=(0.8, 1.0)))
        # Expression: Vegeta's scowl is a brow line that drops toward the nose, and the face is
        # otherwise the shared measured face - smooth. Two angled blades over the eyes give the
        # head a readable expression without touching the shared face kernel.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'head-brow-{tag}', (0.040, 0.014, 0.011),
                                    (side * 0.040, kernel.head_front_y(side * 0.040, 1.632) - 0.004,
                                     1.632), hair, rotation=(0, 0, side * 0.30)))
        # Widow's peak: the hairline point between the brows, so the forehead reads as part of
        # the hair silhouette rather than a bare dome under seven floating blades.
        parts.append(kernel.loft('head-widows-peak', [
            {'x': 0.0, 'y': kernel.head_front_y(0.0, 1.706) - 0.004, 'z': 1.706, 'rx': 0.036, 'ry': 0.012},
            {'x': 0.0, 'y': kernel.head_front_y(0.0, 1.688) - 0.006, 'z': 1.688, 'rx': 0.024, 'ry': 0.010},
            {'x': 0.0, 'y': kernel.head_front_y(0.0, 1.670) - 0.005, 'z': 1.670, 'rx': 0.009, 'ry': 0.005},
        ], hair, segments=10, uv_tiles=(1.0, 1.0)))
    if slug == 'iron_spider':
        # Back harness for the four mechanical legs the runtime hinges at (side 0.3, 1.5, -0.3):
        # a plated pack over the shoulder blades with four gold sockets, so the legs emerge from
        # hardware rather than growing out of the suit's surface.
        parts.append(kernel.box('torso-spider-harness', (0.232, 0.038, 0.184), (0.0, 0.116, 1.330),
                                palette['trim'], rotation=(-0.04, 0, 0)))
        parts.append(kernel.box('torso-spider-harness-spine', (0.044, 0.020, 0.196), (0.0, 0.140, 1.330),
                                palette['gi_shade']))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            for row, dz in enumerate((0.062, -0.022)):
                parts.append(kernel.torus(f'torso-spider-socket-{tag}-{row}', 0.026, 0.008,
                                          (side * 0.086, 0.136, 1.330 + dz), palette['accent'],
                                          rotation=(math.radians(90), 0, 0)))
            parts.append(kernel.box(f'palm-spider-emitter-{tag}', (0.030, 0.016, 0.018),
                                    (side * (kernel.SHOULDER_X + 0.022), -0.022, 0.822),
                                    palette['trim']))
    return parts


def build_suit_layer(palette, extras, gloves=False):
    """No jacket: the body surface is the outfit. A belt, and an emblem where the design wants one.

    `gloves` is off for the bare-armed brawlers (Hulk, Kratos, Shrek, Saitama), whose skin arms are
    the character, and on for the costumed fighters, whose suit has to reach the wrist.
    """
    parts = []
    if gloves:
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'forearm-sleeve-{tag}', [
                {'x': base + side * 0.016, 'z': 1.112, 'rx': 0.050, 'ry': 0.051},
                {'x': base + side * 0.018, 'z': 1.042, 'rx': 0.051, 'ry': 0.052},
                {'x': base + side * 0.020, 'z': 0.958, 'rx': 0.044, 'ry': 0.045},
                {'x': base + side * 0.021, 'z': 0.886, 'rx': 0.035, 'ry': 0.036},
            ], palette['gi'], segments=20, thickness=0.007, uv_tiles=(1.6, 1.0)))
            parts.append(kernel.shell(f'palm-glove-{tag}', [
                {'x': base + side * 0.022, 'z': 0.866, 'rx': 0.030, 'ry': 0.032},
                {'x': base + side * 0.023, 'z': 0.826, 'rx': 0.034, 'ry': 0.042},
                {'x': base + side * 0.024, 'z': 0.788, 'rx': 0.034, 'ry': 0.043},
            ], palette['gi'], segments=16, thickness=0.006, uv_tiles=(1.0, 1.0)))
    if 'lantern' in extras:
        # Closed green gloves with a white cuff: the bare forearms that ship with the suit read as a
        # generic bodysuit, and Hal's gloves are half his silhouette when he throws a construct.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'forearm-glove-{tag}', [
                {'x': base + side * 0.016, 'z': 1.112, 'rx': 0.053, 'ry': 0.054},
                {'x': base + side * 0.018, 'z': 1.036, 'rx': 0.054, 'ry': 0.055},
                {'x': base + side * 0.020, 'z': 0.946, 'rx': 0.046, 'ry': 0.047},
                {'x': base + side * 0.021, 'z': 0.884, 'rx': 0.037, 'ry': 0.038},
            ], palette['gi_shade'], segments=20, thickness=0.008, uv_tiles=(1.6, 1.0)))
            parts.append(kernel.torus(f'forearm-cuff-{tag}', 0.050, 0.009,
                                      (base + side * 0.019, -0.004, 1.106),
                                      palette['eye']))
            parts.append(kernel.torus(f'forearm-glove-top-{tag}', 0.045, 0.007,
                                      (base + side * 0.021, -0.004, 0.898),
                                      palette['gi_shade']))
    if 'belt' in extras or 'emblem' in extras or 'lantern' in extras:
        parts.append(kernel.shell('sash-belt', [
            {'z': 0.912, 'rx': 0.150, 'ry': 0.106},
            {'z': 0.936, 'rx': 0.158, 'ry': 0.112},
            {'z': 0.966, 'rx': 0.156, 'ry': 0.110},
            {'z': 0.988, 'rx': 0.146, 'ry': 0.103},
        ], palette['sash'], segments=26, thickness=0.011, uv_tiles=(2.0, 0.6)))
    if 'lantern' in extras:
        # Hal's badge is a ring with the lantern glyph inside it, not a coloured rectangle. The
        # generic emblem on this suit rendered as a pale slab roughly a third of the chest width,
        # which read as a bib rather than as a Green Lantern. Geometry, not a painted decal: a white
        # disc, a green ring proud of it, two glyph bars and the lamp's upper ring.
        gl_white = kernel.make_material('gl-emblem-white', (0.94, 0.96, 0.93), 0.05, 0.32)
        gl_green = kernel.make_material('gl-emblem-green', (0.18, 0.78, 0.34), 0.15, 0.30)
        parts.append(kernel.loft('torso-emblem-disc', [
            {'x': 0.0, 'y': -0.146, 'z': 1.302, 'rx': 0.074, 'rz': 0.074},
            {'x': 0.0, 'y': -0.154, 'z': 1.302, 'rx': 0.072, 'rz': 0.072},
        ], gl_white, segments=26, axis='Y', uv_tiles=(1.2, 1.2)))
        parts.append(kernel.torus('torso-emblem-ring', 0.074, 0.011, (0.0, -0.152, 1.302),
                                  gl_green, rotation=(math.radians(90), 0, 0)))
        for index, z in enumerate((1.322, 1.302, 1.284)):
            half = 0.046 if index < 2 else 0.030
            parts.append(kernel.box(f'torso-emblem-glyph-{index}', (half, 0.010, 0.010),
                                    (0.0, -0.158, z), gl_green))
        parts.append(kernel.torus('torso-emblem-lamp', 0.022, 0.007, (0.0, -0.158, 1.340),
                                  gl_green, rotation=(math.radians(90), 0, 0)))
    elif 'emblem' in extras:
        parts.append(kernel.box('torso-emblem', (0.104, 0.048, 0.120), (0.0, -0.104, 1.300),
                                palette['trim']))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-emblem-leg-{tag}', (0.030, 0.030, 0.090),
                                    (side * 0.052, -0.104, 1.280), palette['trim'],
                                    rotation=(0, 0, side * 0.55)))
    if 'pauldrons' in extras:
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.sphere(f'upperarm-pauldron-{tag}', 0.078,
                                       (side * kernel.SHOULDER_X, 0.004, 1.396),
                                       palette['gi_shade'], scale=(1.24, 1.0, 1.04), segments=16, rings=10))
    return parts


def build_identity_rebuild(slug, palette):
    """Identity geometry for the fighters the shared body cannot describe.

    Every part built here uses a name prefix the shared weighting already understands - `head-`,
    `hair-`, `torso-`, `upperarm-`, `wrap-`, `skirt-`, `palm-` - so nothing is added that the rig
    cannot drive. These are real meshes, not textures painted over the block-out.

      l_death_note_style   messy overgrown black hair, under-eye shadows, long-sleeve white shirt,
                           collar and cuffs (the jeans come from the palette override)
      edna_mode            chin-length bob with a heavy fringe, oversized round glasses with real
                           rims, lenses and temples, and a flared black dress
      aang                 blue arrow on the crown and brow, robe sash, skirt and a hand-held staff
      kratos               the red tattoo across the eye, scalp and shoulder
      arnold_schwarzenegger  dark glasses and a leather jacket over the armour frame
    """
    parts = []
    hair = palette['hair']
    skin = palette['skin']
    garment = palette['gi']
    accent = palette['accent']

    if slug == 'l_death_note_style':
        # Overgrown, uneven: long blades with a few hanging over the brow. A tidy cap is the one
        # thing this hairstyle must not be.
        for index in range(17):
            angle = math.radians(-96 + index * 12.0)
            radius = 0.070 + (index % 4) * 0.004
            bx, by = math.cos(angle) * radius, math.sin(angle) * radius * 0.98
            width = 0.0140 + (index % 3) * 0.0045
            length = 0.052 + (index % 5) * 0.016
            lift = 0.020 + (index % 3) * 0.014
            parts.append(kernel.loft(f'hair-l-strand-{index}', [
                {'x': bx * 0.90, 'y': by * 0.90, 'z': 1.694, 'rx': width, 'ry': width * 0.58},
                {'x': bx * 1.00, 'y': by * 1.02, 'z': 1.716 + lift * 0.5, 'rx': width * 1.06,
                 'ry': width * 0.60},
                {'x': bx * 1.14, 'y': by * 1.12 - length * 0.35, 'z': 1.722 + lift - length * 0.3,
                 'rx': width * 0.66, 'ry': width * 0.38},
                {'x': bx * 1.22, 'y': by * 1.18 - length * 0.7, 'z': 1.726 + lift - length,
                 'rx': width * 0.14, 'ry': width * 0.10},
            ], hair, segments=7, uv_tiles=(0.9, 1.0)))
        # Heavy uneven fringe: five strands at different lengths, the middle pair at the brow.
        for index in range(5):
            fx = (index - 2) * 0.030
            length = 0.044 + (index % 2) * 0.020
            parts.append(kernel.loft(f'hair-l-fringe-{index}', [
                {'x': fx * 0.70, 'y': kernel.head_front_y(fx * 0.70, 1.712) - 0.008, 'z': 1.712,
                 'rx': 0.018, 'ry': 0.012},
                {'x': fx * 0.90, 'y': kernel.head_front_y(fx * 0.90, 1.694) - 0.011, 'z': 1.694,
                 'rx': 0.016, 'ry': 0.010},
                {'x': fx, 'y': kernel.head_front_y(fx, 1.694 - length) - 0.008,
                 'z': 1.694 - length, 'rx': 0.009, 'ry': 0.006},
            ], hair, segments=8, uv_tiles=(0.8, 1.0)))
        # Under-eye shadows: the other half of the silhouette everyone recognises.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.sphere(f'head-eye-bag-{tag}', 0.0165,
                                       (side * 0.037, kernel.head_front_y(side * 0.037, 1.606) - 0.002,
                                        1.606),
                                       palette['skin_dark'], scale=(1.0, 0.16, 0.34), segments=12,
                                       rings=6))
        # Long-sleeve white shirt over the suit body, with collar and cuffs.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'upperarm-shirt-{tag}', [
                {'x': base + side * 0.002, 'z': 1.418, 'rx': 0.046, 'ry': 0.046},
                {'x': base + side * 0.008, 'z': 1.330, 'rx': 0.060, 'ry': 0.061},
                {'x': base + side * 0.014, 'z': 1.200, 'rx': 0.052, 'ry': 0.053},
            ], garment, segments=18, thickness=0.008, uv_tiles=(1.6, 1.2)))
            parts.append(kernel.shell(f'wrap-shirt-{tag}', [
                {'x': base + side * 0.016, 'z': 1.150, 'rx': 0.050, 'ry': 0.051},
                {'x': base + side * 0.019, 'z': 1.020, 'rx': 0.049, 'ry': 0.050},
                {'x': base + side * 0.021, 'z': 0.930, 'rx': 0.040, 'ry': 0.041},
                {'x': base + side * 0.022, 'z': 0.892, 'rx': 0.034, 'ry': 0.035},
            ], garment, segments=18, thickness=0.007, uv_tiles=(1.5, 1.1)))
            parts.append(kernel.torus(f'wrap-cuff-{tag}', 0.034, 0.006,
                                      (base + side * 0.022, -0.002, 0.894), palette['gi_shade'],
                                      rotation=(math.radians(6), 0, 0)))
        parts.append(kernel.torus('torso-shirt-collar', 0.052, 0.010, (0.0, 0.002, 1.446),
                                  palette['gi_shade'], rotation=(math.radians(10), 0, 0)))

    if slug == 'edna_mode':
        # Bob: a heavy chin-length mass on both sides plus the back panel, which is what makes the
        # silhouette read at preview size.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.loft(f'hair-bob-side-{tag}', [
                {'x': side * 0.072, 'y': 0.010, 'z': 1.706, 'rx': 0.030, 'ry': 0.052},
                {'x': side * 0.084, 'y': 0.006, 'z': 1.664, 'rx': 0.030, 'ry': 0.056},
                {'x': side * 0.086, 'y': 0.000, 'z': 1.606, 'rx': 0.026, 'ry': 0.050},
                {'x': side * 0.082, 'y': -0.004, 'z': 1.566, 'rx': 0.020, 'ry': 0.040},
            ], hair, segments=12, uv_tiles=(1.0, 1.4)))
        parts.append(kernel.loft('hair-bob-back', [
            {'x': 0.0, 'y': 0.074, 'z': 1.702, 'rx': 0.078, 'ry': 0.030},
            {'x': 0.0, 'y': 0.082, 'z': 1.652, 'rx': 0.084, 'ry': 0.032},
            {'x': 0.0, 'y': 0.080, 'z': 1.586, 'rx': 0.072, 'ry': 0.028},
        ], hair, segments=14, uv_tiles=(1.4, 1.2)))
        for index in range(5):
            fx = (index - 2) * 0.026
            parts.append(kernel.loft(f'hair-bob-fringe-{index}', [
                {'x': fx * 0.72, 'y': kernel.head_front_y(fx * 0.72, 1.716) - 0.010, 'z': 1.716,
                 'rx': 0.016, 'ry': 0.010},
                {'x': fx * 0.92, 'y': kernel.head_front_y(fx * 0.92, 1.700) - 0.013, 'z': 1.700,
                 'rx': 0.014, 'ry': 0.009},
                {'x': fx, 'y': kernel.head_front_y(fx, 1.674) - 0.010, 'z': 1.674,
                 'rx': 0.008, 'ry': 0.006},
            ], hair, segments=8, uv_tiles=(0.8, 1.0)))
        # Oversized round glasses: rim, lens, bridge and temples, all real geometry.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            eye_x = side * 0.041
            face = kernel.head_front_y(eye_x, 1.630)
            parts.append(kernel.torus(f'head-glasses-rim-{tag}', 0.033, 0.0055,
                                      (eye_x, face - 0.020, 1.630), palette['gi_shade'],
                                      rotation=(math.radians(90), 0, 0)))
            parts.append(kernel.sphere(f'head-glasses-lens-{tag}', 0.031,
                                       (eye_x, face - 0.018, 1.630), palette['eye'],
                                       scale=(1.0, 0.10, 1.0), segments=18, rings=8))
            parts.append(kernel.box(f'head-glasses-temple-{tag}', (0.010, 0.070, 0.008),
                                    (side * 0.070, face + 0.016, 1.634), palette['gi_shade'],
                                    rotation=(0, 0, side * 0.10)))
        parts.append(kernel.box('head-glasses-bridge', (0.020, 0.010, 0.008),
                                (0.0, kernel.head_front_y(0.0, 1.630) - 0.020, 1.636),
                                palette['gi_shade']))
        # Flared black dress over the suit body.
        parts.append(kernel.shell('torso-dress', [
            {'z': 1.330, 'rx': 0.150, 'ry': 0.104},
            {'z': 1.180, 'rx': 0.146, 'ry': 0.101},
            {'z': 1.000, 'rx': 0.152, 'ry': 0.106},
        ], garment, segments=26, thickness=0.009, uv_tiles=(2.0, 1.6)))
        parts.append(kernel.shell('skirt-dress', [
            {'z': 0.986, 'rx': 0.150, 'ry': 0.105},
            {'z': 0.900, 'rx': 0.172, 'ry': 0.120},
            {'z': 0.790, 'rx': 0.196, 'ry': 0.138},
            {'z': 0.700, 'rx': 0.206, 'ry': 0.146},
        ], garment, segments=26, thickness=0.009, uv_tiles=(2.0, 1.6)))
        parts.append(kernel.torus('torso-dress-collar', 0.050, 0.008, (0.0, 0.002, 1.442),
                                  palette['gi_shade'], rotation=(math.radians(8), 0, 0)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'upperarm-dress-sleeve-{tag}', [
                {'x': base + side * 0.002, 'z': 1.420, 'rx': 0.046, 'ry': 0.046},
                {'x': base + side * 0.008, 'z': 1.360, 'rx': 0.062, 'ry': 0.062},
                {'x': base + side * 0.012, 'z': 1.300, 'rx': 0.056, 'ry': 0.056},
            ], garment, segments=18, thickness=0.008, uv_tiles=(1.5, 1.1)))

    if slug == 'aang':
        # Blue arrow: crown chevron, tail down the nape, and the small brow arrow.
        # One continuous stripe from the brow, over the crown, down to the nape - the mark is a
        # single arrow, not three decals. The previous version was a 12 cm long box plus two wings
        # centred at z=1.742: longer than the crown itself, so the ends left the skull and the arrow
        # rendered as pale bars floating above a bald head (artifacts/p72/aang-head-front.png). Each
        # section's y is the measured front/back surface of the skull at that height, from
        # HEAD_SECTIONS, so the stripe lies on the head instead of through it.
        # Arrowhead: stacked vertically, not laid across the brow. A wide ring swept along Y sits in
        # one vertical plane, so on a curved forehead its wings leave the skin - the first attempt at
        # a 6 cm head rendered as two blue shards floating off the brow
        # (artifacts/p72/aang-head-front.png, 02:44). Each ring here is centred on the measured
        # surface at its own height, so the triangle grows along the face instead of through it.
        parts.append(kernel.loft('head-arrow-head', [
            {'y': kernel.head_front_y(0.0, 1.672) - 0.003, 'z': 1.672, 'rx': 0.005, 'ry': 0.004},
            {'y': kernel.head_front_y(0.0, 1.680) - 0.003, 'z': 1.680, 'rx': 0.014, 'ry': 0.004},
            {'y': kernel.head_front_y(0.0, 1.688) - 0.003, 'z': 1.688, 'rx': 0.026, 'ry': 0.004},
            {'y': kernel.head_front_y(0.0, 1.696) - 0.003, 'z': 1.696, 'rx': 0.012, 'ry': 0.004},
        ], palette['ink'], segments=14, uv_tiles=(0.8, 0.8)))
        # The shaft continues over the crown and down the back of the skull to the nape as one
        # surface. The separate nape box it replaces sat at a constant y, so it met the crown stripe
        # at an angle and read as two marks; every section here is placed 2 mm outside the measured
        # back-of-skull radius at its own height.
        parts.append(kernel.loft('head-arrow-crown', [
            {'y': -0.086, 'z': 1.699, 'rx': 0.012, 'rz': 0.010},
            {'y': -0.079, 'z': 1.714, 'rx': 0.013, 'rz': 0.010},
            {'y': -0.055, 'z': 1.736, 'rx': 0.013, 'rz': 0.010},
            {'y': -0.020, 'z': 1.744, 'rx': 0.013, 'rz': 0.010},
            {'y': 0.020, 'z': 1.744, 'rx': 0.013, 'rz': 0.010},
            {'y': 0.055, 'z': 1.734, 'rx': 0.012, 'rz': 0.010},
            {'y': 0.092, 'z': 1.706, 'rx': 0.013, 'rz': 0.010},
            {'y': 0.100, 'z': 1.678, 'rx': 0.014, 'rz': 0.010},
            {'y': 0.100, 'z': 1.648, 'rx': 0.013, 'rz': 0.009},
            {'y': 0.099, 'z': 1.620, 'rx': 0.011, 'rz': 0.008},
        ], palette['ink'], segments=10, axis='Y', uv_tiles=(0.6, 1.8)))
        # Robe sash across the chest and the skirt over the trousers.
        parts.append(kernel.loft('torso-robe-sash', [
            {'x': -0.140, 'y': -0.070, 'z': 1.352, 'rx': 0.030, 'ry': 0.014},
            {'x': -0.040, 'y': -0.112, 'z': 1.238, 'rx': 0.034, 'ry': 0.016},
            {'x': 0.080, 'y': -0.108, 'z': 1.120, 'rx': 0.030, 'ry': 0.014},
            {'x': 0.130, 'y': -0.080, 'z': 1.010, 'rx': 0.022, 'ry': 0.012},
        ], palette['gi_shade'], segments=12, uv_tiles=(1.0, 1.6)))
        parts.append(kernel.shell('skirt-robe', [
            {'z': 0.980, 'rx': 0.150, 'ry': 0.106},
            {'z': 0.900, 'rx': 0.170, 'ry': 0.120},
            {'z': 0.800, 'rx': 0.182, 'ry': 0.128},
        ], palette['gi_shade'], segments=24, thickness=0.009, uv_tiles=(1.8, 1.4)))
        # Staff in the right hand: a real shaft plus the two end caps.
        hand_x = kernel.SHOULDER_X + 0.024
        parts.append(kernel.loft('palm-staff-R', [
            {'x': hand_x, 'y': -0.040, 'z': 1.520, 'rx': 0.011, 'ry': 0.011},
            {'x': hand_x, 'y': -0.046, 'z': 1.100, 'rx': 0.012, 'ry': 0.012},
            {'x': hand_x, 'y': -0.050, 'z': 0.700, 'rx': 0.012, 'ry': 0.012},
            {'x': hand_x, 'y': -0.052, 'z': 0.280, 'rx': 0.011, 'ry': 0.011},
        ], palette['boot'], segments=10, uv_tiles=(0.6, 2.4)))
        for z in (0.300, 1.500):
            parts.append(kernel.torus(f'palm-staff-cap-R-{int(z * 1000)}', 0.013, 0.005,
                                      (hand_x, -0.051, z), palette['trim'],
                                      rotation=(0, 0, 0)))

    if slug == 'wonder_woman':
        # Bracers, tiara and the coiled lasso. The shared armour layer closes the wrist with a cuff,
        # so the costume's defining bracers, the tiara over the measured brow and the rope at her hip
        # were simply absent. Each band sits on an axis the body already uses (forearm, forehead).
        for side in (-1, 1):
            arm_x = side * (kernel.SHOULDER_X + 0.024)
            for tag, z, radius in (('upper', 0.980, 0.062), ('lower', 0.900, 0.056)):
                parts.append(kernel.torus('bracer-' + tag + '-' + str(side), radius, 0.009,
                                          (arm_x, -0.004, z), palette['accent']))
        parts.append(kernel.loft('head-tiara', [
            {'x': -0.072, 'y': kernel.head_front_y(-0.072, 1.688) - 0.002, 'z': 1.688, 'rx': 0.010, 'ry': 0.004},
            {'x': -0.030, 'y': kernel.head_front_y(-0.030, 1.700) - 0.002, 'z': 1.700, 'rx': 0.011, 'ry': 0.004},
            {'x': 0.000, 'y': kernel.head_front_y(0.000, 1.702) - 0.002, 'z': 1.702, 'rx': 0.012, 'ry': 0.004},
            {'x': 0.030, 'y': kernel.head_front_y(0.030, 1.700) - 0.002, 'z': 1.700, 'rx': 0.011, 'ry': 0.004},
            {'x': 0.072, 'y': kernel.head_front_y(0.072, 1.688) - 0.002, 'z': 1.688, 'rx': 0.010, 'ry': 0.004},
        ], palette['accent'], segments=14, uv_tiles=(1.2, 0.6)))
        # The coil was tilted 74 degrees and sat behind the skirt plate, so at torso framing it read
        # as a thin gold sliver. Turn it face-on to the camera (90 degrees about X) and hang it in
        # front of the skirt face (front plate sits at y -0.111) on the outer hip, clear of the belt.
        # A lasso you can actually see. The previous coil topped out at a 58 mm radius with a 9 mm
        # rope, tucked 15 mm off the skirt, which at gameplay framing read as a scrape of gold. The
        # rope is now 11.5 mm, the widest ring reaches 72 mm, and the coil sits 23 mm proud of the
        # skirt face so its silhouette breaks the hip line instead of merging with it.
        # The coil used the same gold as the belt and bracers, so it merged into the trim. The rope
        # is now a pale cord material (warm tan, matte) that separates from both the gold belt above
        # it and the maroon skirt behind it, with gold collars at the coil ends to keep it costume.
        rope = kernel.make_material('ww-lasso-rope', (0.88, 0.72, 0.45), 0.04, 0.86)
        rope_dark = kernel.make_material('ww-lasso-shadow', (0.52, 0.39, 0.21), 0.02, 0.92)
        for index, radius in enumerate((0.054, 0.063, 0.072)):
            parts.append(kernel.torus('lasso-coil-' + str(index), radius, 0.0115,
                                      (0.130, -0.134, 0.906 + index * 0.007),
                                      rope, rotation=(math.radians(90), 0, 0)))
            # A second, thinner strand offset off each ring is what makes the coil read as twisted
            # cord rather than three smooth doughnuts.
            parts.append(kernel.torus('lasso-strand-' + str(index), radius + 0.004, 0.0052,
                                      (0.130, -0.140, 0.906 + index * 0.007),
                                      rope_dark, rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.torus('lasso-collar-top', 0.030, 0.0080,
                                  (0.130, -0.141, 0.925), palette['trim'],
                                  rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.torus('lasso-collar-bottom', 0.026, 0.0075,
                                  (0.150, -0.141, 0.884), palette['trim'],
                                  rotation=(math.radians(90), 0, 0)))
        # The loose end hangs off the coil down the thigh; without it the rings float as three
        # separate circles rather than reading as one coiled rope.
        parts.append(kernel.loft('lasso-tail', [
            {'x': 0.150, 'y': -0.138, 'z': 0.884, 'rx': 0.0115, 'rz': 0.0115},
            {'x': 0.158, 'y': -0.140, 'z': 0.836, 'rx': 0.0105, 'rz': 0.0105},
            {'x': 0.150, 'y': -0.136, 'z': 0.792, 'rx': 0.0085, 'rz': 0.0085},
        ], rope, segments=10, uv_tiles=(0.6, 1.2)))

    if slug == 'thor':
        # The three chest discs and the bracers the breastplate does not carry.
        # Thor's breastplate carries discs, not rings, and the three have to stay independently
        # readable: tori clipped into the armour and read as chevrons, then a flat row read as pale
        # studs because the emissive 'accent' slot was used. These are flat trim-metal plates stacked
        # down the sternum with a real gap between edges, sitting proud of the plate face (y -0.147).
        # Three separate discs, not one lump: at 0.066 m centre spacing the old radii (0.042 and
        # 0.038) left the upper and middle plates overlapping by 14 mm, so the sternum read as a
        # single lozenge. Spacing is now 0.080 m with radii 0.040/0.036/0.032, which leaves a 4 mm
        # and a 12 mm gap between edges at this scale. Each disc is domed in three rings (rim, face,
        # crown) rather than a two-ring plug, so the top centre catches the key light.
        # Layered metal, not one gold material: an aged bronze backing plate, a near-black
        # engraved groove and a warmer brushed brass crown. Three distinct roughness/metallic
        # values are what makes the discs read as assembled armour at fighting distance instead of
        # polished gold spheres catching the same highlight.
        disc_plate = kernel.make_material('thor-disc-plate', (0.23, 0.19, 0.14), 0.90, 0.44)
        disc_engrave = kernel.make_material('thor-disc-engrave', (0.06, 0.05, 0.04), 0.50, 0.74)
        disc_brass = kernel.make_material('thor-disc-brass', (0.70, 0.53, 0.23), 0.95, 0.30)
        for tag, radius, z in (('upper', 0.040, 1.372), ('middle', 0.036, 1.292), ('lower', 0.032, 1.212)):
            parts.append(kernel.loft('chest-disc-' + tag, [
                {'x': 0.0, 'y': -0.149, 'z': z, 'rx': radius, 'rz': radius},
                {'x': 0.0, 'y': -0.158, 'z': z, 'rx': radius * 0.995, 'rz': radius * 0.995},
                {'x': 0.0, 'y': -0.160, 'z': z, 'rx': radius * 0.965, 'rz': radius * 0.965},
            ], disc_brass, segments=24, axis='Y', uv_tiles=(1.0, 0.5)))

            # Contrast at combat distance: three gold domes on a gold breastplate merged into one
            # warm field. Each disc now sits inside a dark plate-dark rim ring with four trim rivets,
            # and carries an engraved inner groove, so the silhouette and the metal layering both
            # read when the fighters are two metres apart.
            # A solid plate, not a decorative ring: the plate is only 3 mm proud, the outline is a
            # 3.2 mm engraved line at 0.97 R, and there is no raised crown or oversized dark ring.
            parts.append(kernel.torus('chest-disc-outline-' + tag, radius * 0.97, 0.0032,
                                      (0.0, -0.1615, z), disc_engrave,
                                      rotation=(math.radians(90), 0, 0)))
            for k in range(4):
                angle = math.pi * 0.25 + k * math.pi * 0.5
                parts.append(kernel.box('chest-disc-rivet-' + tag + '-' + str(k), (0.013, 0.011, 0.013),
                                        (math.cos(angle) * radius * 1.30, -0.1485,
                                         z + math.sin(angle) * radius * 1.30), disc_plate))

        for side in (-1, 1):
            arm_x = side * (kernel.SHOULDER_X + 0.024)
            for tag, z, radius in (('upper', 0.970, 0.066), ('lower', 0.890, 0.058)):
                parts.append(kernel.torus('bracer-' + tag + '-' + str(side), radius, 0.010,
                                          (arm_x, -0.004, z), palette['accent']))

    if slug == 'kratos':
        # The red tattoo. Real geometry on the skin, running from the left eye over the scalp and
        # across the shoulder, rather than a tint on the whole body.
        # Tapered and flush. Three near-equal rings read as a red sticky note on the brow
        # (artifacts/phase73/kratos-head-front.png): the stripe has to narrow as it leaves the brow,
        # follow the cheek, and be thin enough (3.5 mm) to lie on the skin instead of standing off it.
        parts.append(kernel.loft('head-tattoo-face', [
            {'x': -0.026, 'y': kernel.head_front_y(-0.026, 1.668) - 0.0025, 'z': 1.668,
             'rx': 0.014, 'ry': 0.0035},
            {'x': -0.032, 'y': kernel.head_front_y(-0.032, 1.652) - 0.0025, 'z': 1.652,
             'rx': 0.015, 'ry': 0.0035},
            {'x': -0.040, 'y': kernel.head_front_y(-0.040, 1.628) - 0.0025, 'z': 1.628,
             'rx': 0.013, 'ry': 0.0035},
            {'x': -0.047, 'y': kernel.head_front_y(-0.047, 1.602) - 0.0025, 'z': 1.602,
             'rx': 0.010, 'ry': 0.0030},
            {'x': -0.050, 'y': kernel.head_front_y(-0.050, 1.580) - 0.0020, 'z': 1.580,
             'rx': 0.006, 'ry': 0.0025},
        ], palette['ink'], segments=10, uv_tiles=(0.6, 1.4)))
        parts.append(kernel.loft('hair-tattoo-scalp', [
            {'x': -0.034, 'y': -0.030, 'z': 1.724, 'rx': 0.014, 'ry': 0.006},
            {'x': -0.040, 'y': 0.020, 'z': 1.736, 'rx': 0.014, 'ry': 0.006},
            {'x': -0.044, 'y': 0.062, 'z': 1.712, 'rx': 0.012, 'ry': 0.005},
        ], palette['ink'], segments=8, uv_tiles=(0.6, 1.2)))
        parts.append(kernel.loft('upperarm-tattoo-L', [
            {'x': -(kernel.SHOULDER_X + 0.004), 'y': -0.040, 'z': 1.404, 'rx': 0.024, 'ry': 0.008},
            {'x': -(kernel.SHOULDER_X + 0.010), 'y': -0.038, 'z': 1.340, 'rx': 0.022, 'ry': 0.008},
            {'x': -(kernel.SHOULDER_X + 0.014), 'y': -0.034, 'z': 1.286, 'rx': 0.016, 'ry': 0.006},
        ], palette['ink'], segments=8, uv_tiles=(0.8, 1.2)))

        # The stripe on the face and scalp above is the tattoo's head half. The body half - the band
        # that runs off the shoulder and across the chest to the opposite hip - was never built, so
        # at gameplay distance Kratos read as a pale man in a black vest rather than as the Ghost of
        # Sparta. This band is 6-7 cm wide and sits 6 mm proud of the chest, which is the size that
        # survives the six-metre shot without becoming a cape.
        parts.append(kernel.loft('torso-tattoo-band', [
            {'x': -0.150, 'y': -0.058, 'z': 1.398, 'rx': 0.030, 'ry': 0.013},
            {'x': -0.092, 'y': -0.106, 'z': 1.312, 'rx': 0.033, 'ry': 0.014},
            {'x': -0.018, 'y': -0.126, 'z': 1.224, 'rx': 0.032, 'ry': 0.014},
            {'x': 0.062, 'y': -0.118, 'z': 1.136, 'rx': 0.029, 'ry': 0.013},
            {'x': 0.126, 'y': -0.084, 'z': 1.052, 'rx': 0.023, 'ry': 0.011},
        ], palette['ink'], segments=12, uv_tiles=(1.0, 1.8)))
        # Leather forearm wraps with red cord: the bare skin forearms are Kratos's hand-to-hand
        # silhouette, but without the wraps he reads as an unarmoured civilian from behind.
        leather = kernel.make_material('kratos-leather', (0.19, 0.12, 0.085), 0.04, 0.74)
        steel = kernel.make_material('kratos-steel', (0.44, 0.41, 0.36), 0.72, 0.40)
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'forearm-wrap-{tag}', [
                {'x': base + side * 0.016, 'z': 1.106, 'rx': 0.052, 'ry': 0.053},
                {'x': base + side * 0.019, 'z': 1.022, 'rx': 0.053, 'ry': 0.054},
                {'x': base + side * 0.021, 'z': 0.930, 'rx': 0.045, 'ry': 0.046},
                {'x': base + side * 0.022, 'z': 0.878, 'rx': 0.036, 'ry': 0.037},
            ], leather, segments=20, thickness=0.009, uv_tiles=(1.4, 1.0)))
            for index, z in enumerate((1.098, 1.022, 0.946)):
                parts.append(kernel.torus(f'forearm-cord-{tag}-{index}', 0.052 - index * 0.005,
                                          0.006, (base + side * 0.020, -0.004, z), palette['ink']))
        # The left shoulder carries the plated guard; the right stays bare, which is what makes the
        # asymmetry read as Spartan rather than as a matching pair of shoulder pads.
        parts.append(kernel.sphere('upperarm-guard-L', 0.090, (-kernel.SHOULDER_X, 0.004, 1.404),
                                   steel, scale=(1.30, 1.06, 1.00), segments=18, rings=10))
        parts.append(kernel.box('upperarm-guard-lip-L', (0.104, 0.034, 0.034),
                                (-kernel.SHOULDER_X - 0.014, 0.004, 1.342), leather,
                                rotation=(0, 0, -0.16)))
        # Red war sash with a hanging tail over the left thigh.
        parts.append(kernel.shell('torso-sash', [
            {'z': 0.898, 'rx': 0.152, 'ry': 0.108},
            {'z': 0.938, 'rx': 0.160, 'ry': 0.114},
            {'z': 0.982, 'rx': 0.149, 'ry': 0.105},
        ], palette['ink'], segments=26, thickness=0.010, uv_tiles=(2.0, 0.6)))
        parts.append(kernel.loft('skirt-sash-tail', [
            {'x': 0.078, 'y': -0.114, 'z': 0.898, 'rx': 0.050, 'ry': 0.013},
            {'x': 0.092, 'y': -0.120, 'z': 0.782, 'rx': 0.046, 'ry': 0.012},
            {'x': 0.086, 'y': -0.116, 'z': 0.692, 'rx': 0.034, 'ry': 0.010},
        ], palette['ink'], segments=12, uv_tiles=(1.2, 1.6)))

    if slug == 'green_lantern_hal_jordan':
        # Hal's domino mask, as a real rim around each eye plus a bridge and the two wings toward the
        # temples. A solid green patch covers the eyes and loses the face at close range; the rim
        # reads as a mask and keeps the eyes, which is what the mask does on the page too.
        mask = kernel.make_material('gl-mask-green', (0.09, 0.40, 0.22), 0.10, 0.44)
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            eye_x = side * 0.042
            eye_z = 1.626
            face = kernel.head_front_y(eye_x, eye_z)
            parts.append(kernel.torus(f'head-mask-rim-{tag}', 0.031, 0.0075,
                                      (eye_x, face - 0.005, eye_z), mask,
                                      rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.box('head-mask-bridge', (0.022, 0.010, 0.011),
                                (0.0, kernel.head_front_y(0.0, 1.630) - 0.005, 1.632), mask))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'head-mask-wing-{tag}', (0.034, 0.012, 0.016),
                                    (side * 0.076, kernel.head_front_y(side * 0.076, 1.634) - 0.004,
                                     1.638), mask, rotation=(0, 0, side * 0.20)))

    if slug == 'edward_elric':
        # The red coat is the character. The robe underneath stays (it is the shirt and trousers
        # read), and the coat is a real outer layer with sleeves, cuffs, a standing collar, a front
        # seam and tails, so the silhouette changes rather than the tint.
        coat = kernel.make_material('ed-coat', (0.50, 0.10, 0.09), 0.05, 0.58)
        coat_dark = kernel.make_material('ed-coat-dark', (0.32, 0.06, 0.06), 0.05, 0.64)
        gold = kernel.make_material('ed-gold', (0.74, 0.59, 0.21), 0.85, 0.30)
        parts.append(kernel.shell('torso-coat', [
            {'z': 0.972, 'rx': 0.162, 'ry': 0.115, 'front': 1.03},
            {'z': 1.120, 'rx': 0.152, 'ry': 0.109, 'front': 1.02},
            {'z': 1.290, 'rx': 0.198, 'ry': 0.129},
            {'z': 1.404, 'rx': 0.192, 'ry': 0.121},
        ], coat, segments=28, thickness=0.013, uv_tiles=(2.0, 2.0)))
        parts.append(kernel.box('torso-coat-seam', (0.010, 0.030, 0.300), (0.0, -0.132, 1.190),
                                coat_dark))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-coat-lapel-{tag}', (0.020, 0.028, 0.170),
                                    (side * 0.062, -0.128, 1.300), coat_dark,
                                    rotation=(0, 0, side * 0.30)))
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'upperarm-coat-sleeve-{tag}', [
                {'x': base + side * 0.002, 'z': 1.420, 'rx': 0.050, 'ry': 0.050},
                {'x': base + side * 0.010, 'z': 1.330, 'rx': 0.070, 'ry': 0.070},
                {'x': base + side * 0.014, 'z': 1.236, 'rx': 0.058, 'ry': 0.058},
            ], coat, segments=18, thickness=0.009, uv_tiles=(1.4, 1.2)))
            parts.append(kernel.shell(f'forearm-coat-cuff-{tag}', [
                {'x': base + side * 0.016, 'z': 1.122, 'rx': 0.056, 'ry': 0.057},
                {'x': base + side * 0.018, 'z': 1.040, 'rx': 0.058, 'ry': 0.059},
            ], coat_dark, segments=18, thickness=0.008, uv_tiles=(1.2, 0.8)))
        parts.append(kernel.shell('torso-coat-collar', [
            {'z': 1.428, 'rx': 0.110, 'ry': 0.094},
            {'z': 1.468, 'rx': 0.098, 'ry': 0.084},
            {'z': 1.498, 'rx': 0.080, 'ry': 0.070},
        ], coat, segments=22, thickness=0.011, uv_tiles=(1.6, 0.8)))
        parts.append(kernel.shell('skirt-coat-tails', [
            {'z': 0.976, 'rx': 0.166, 'ry': 0.120},
            {'z': 0.860, 'rx': 0.182, 'ry': 0.131},
            {'z': 0.698, 'rx': 0.176, 'ry': 0.127},
        ], coat, segments=24, thickness=0.011, uv_tiles=(1.8, 1.4)))
        parts.append(kernel.box('torso-coat-belt', (0.152, 0.042, 0.032), (0.0, -0.122, 1.000), gold))
        parts.append(kernel.box('torso-coat-buckle', (0.034, 0.030, 0.040), (0.0, -0.132, 1.000),
                                coat_dark))

    if slug == 'captain_jack_sparrow':
        # A tricorn, because a pirate captain in a headband reads as a deckhand. Crown plus three
        # up-turned brim plates placed around the skull, then a gold-edged coat over the robe.
        hat = kernel.make_material('jack-hat', (0.13, 0.10, 0.08), 0.04, 0.68)
        hat_gold = kernel.make_material('jack-trim', (0.70, 0.56, 0.23), 0.80, 0.34)
        coat = kernel.make_material('jack-coat', (0.19, 0.15, 0.11), 0.05, 0.64)
        # Tricorn, built as one joined structure instead of three plates bolted around the skull.
        # A triangular crown is the middle; three folded brim wings are lofted up and inward from a
        # brim rim until they meet the crown, so the silhouette closes from every angle. The fold
        # is real thickness (a lofted plate, not a box), and the gold band rings the crown base.
        # Lower and wider than the first pass: 0.07 m of crown over a 0.26 m base instead of 0.10 over
        # 0.22, which was reading as a tall cylinder. A tricorn is a low, broad shape.
        parts.append(kernel.loft('head-hat-crown', [
            {'x': 0.0, 'y': 0.004, 'z': 1.672, 'rx': 0.128, 'ry': 0.130},
            {'x': 0.0, 'y': 0.004, 'z': 1.712, 'rx': 0.124, 'ry': 0.126},
            {'x': 0.0, 'y': 0.004, 'z': 1.742, 'rx': 0.086, 'ry': 0.088},
        ], hat, segments=3, uv_tiles=(1.4, 1.0)))
        # Brim rim: the flat disc the folds turn up from, so the hat has a closed bottom edge.
        # 18 mm thick instead of 12, with the outer face pulled in 8 mm: a felt brim has a visible
        # edge, and the thin version read as paper at gameplay distance.
        parts.append(kernel.loft('head-hat-brim-rim', [
            {'x': 0.0, 'y': 0.004, 'z': 1.656, 'rx': 0.176, 'ry': 0.178},
            {'x': 0.0, 'y': 0.004, 'z': 1.668, 'rx': 0.178, 'ry': 0.180},
            {'x': 0.0, 'y': 0.004, 'z': 1.674, 'rx': 0.170, 'ry': 0.172},
        ], hat, segments=24, uv_tiles=(2.2, 0.3)))
        for index in range(3):
            angle = index * TAU / 3.0
            # Authored facing front (-Y), then turned into place: a wing is a curved, tapered plate
            # that rises from the brim rim to the crown, wide in the middle and pinched at the ends
            # so adjacent wings meet at a corner.
            # Wider and shorter, with a deeper bulge at the fold so the upturn reads as a fold
            # rather than a flat plate standing on the brim.
            # A tricorn corner reads by its crease, not by its width. This profile puts a thick
            # bulge at the fold and a tighter bend above it, so the highlight breaks along a line,
            # and the tip tucks back towards the crown so the corners read from the front too.
            wing = kernel.loft(f'head-hat-wing-{index}', [
                {'x': 0.0, 'y': -0.170, 'z': 1.654, 'rx': 0.132, 'ry': 0.010},
                {'x': 0.0, 'y': -0.180, 'z': 1.681, 'rx': 0.144, 'ry': 0.021},
                {'x': 0.0, 'y': -0.168, 'z': 1.699, 'rx': 0.132, 'ry': 0.012},
                {'x': 0.0, 'y': -0.152, 'z': 1.724, 'rx': 0.112, 'ry': 0.010},
                {'x': 0.0, 'y': -0.116, 'z': 1.746, 'rx': 0.074, 'ry': 0.008},
            ], hat, segments=16, uv_tiles=(1.6, 1.0))
            # The crease itself: a thin raised strip along the fold. Without it the wing is a smooth
            # plate and the three corners only exist mathematically.
            parts.append(kernel.loft(f'head-hat-crease-{index}', [
                {'x': 0.0, 'y': -0.196, 'z': 1.672, 'rx': 0.118, 'ry': 0.005},
                {'x': 0.0, 'y': -0.198, 'z': 1.690, 'rx': 0.122, 'ry': 0.006},
                {'x': 0.0, 'y': -0.186, 'z': 1.706, 'rx': 0.104, 'ry': 0.005},
            ], hat, segments=12, uv_tiles=(1.2, 0.5)))
            wing.rotation_euler = (0.0, 0.0, angle)
            parts.append(wing)
        # The gold band sits on the crown base and stands proud of the felt, so it reads as a
        # separate material rather than a painted stripe.
        parts.append(kernel.torus('head-hat-band', 0.134, 0.011, (0.0, 0.004, 1.678), hat_gold))
        parts.append(kernel.torus('head-hat-band-edge', 0.134, 0.0035, (0.0, 0.004, 1.692), hat_gold))
        parts.append(kernel.shell('torso-coat', [
            {'z': 0.976, 'rx': 0.158, 'ry': 0.112, 'front': 1.02},
            {'z': 1.140, 'rx': 0.150, 'ry': 0.108},
            {'z': 1.300, 'rx': 0.194, 'ry': 0.126},
            {'z': 1.402, 'rx': 0.188, 'ry': 0.119},
        ], coat, segments=28, thickness=0.012, uv_tiles=(2.0, 2.0)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-coat-lapel-{tag}', (0.018, 0.026, 0.190),
                                    (side * 0.066, -0.126, 1.296), hat_gold,
                                    rotation=(0, 0, side * 0.26)))
            parts.append(kernel.sphere(f'torso-coat-button-{tag}', 0.012,
                                       (side * 0.046, -0.134, 1.160), hat_gold,
                                       scale=(1.0, 0.5, 1.0), segments=10, rings=6))
        parts.append(kernel.shell('torso-coat-sash', [
            {'z': 0.910, 'rx': 0.156, 'ry': 0.112},
            {'z': 0.952, 'rx': 0.164, 'ry': 0.118},
            {'z': 0.986, 'rx': 0.152, 'ry': 0.108},
        ], palette['ink'], segments=26, thickness=0.010, uv_tiles=(2.0, 0.6)))

    if slug == 'lord_voldemort':
        # A high, closed collar and a silver clasp: the plain robe read as a hospital gown. The
        # collar is the dark lord's silhouette at any distance, so it is built as outer geometry.
        robe = kernel.make_material('vold-robe', (0.045, 0.065, 0.045), 0.06, 0.74)
        silver = kernel.make_material('vold-trim', (0.36, 0.44, 0.31), 0.72, 0.32)
        parts.append(kernel.shell('torso-collar-high', [
            {'z': 1.424, 'rx': 0.114, 'ry': 0.098},
            {'z': 1.474, 'rx': 0.102, 'ry': 0.088},
            {'z': 1.522, 'rx': 0.088, 'ry': 0.076},
        ], robe, segments=24, thickness=0.013, uv_tiles=(1.6, 1.0)))
        parts.append(kernel.torus('torso-collar-trim', 0.110, 0.007, (0.0, 0.0, 1.428), silver))
        parts.append(kernel.torus('torso-robe-clasp', 0.030, 0.006, (0.0, -0.122, 1.352), silver,
                                  rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.box('torso-robe-panel', (0.150, 0.026, 0.360), (0.0, -0.116, 1.160),
                                robe, rotation=(0.02, 0, 0)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-robe-edge-{tag}', (0.012, 0.028, 0.380),
                                    (side * 0.070, -0.126, 1.160), silver))

    if slug == 'arnold_schwarzenegger':
        # Dark glasses with actual lens geometry: a frame ring, a lens disc seated inside it, a
        # bridge and temples. The previous version was two flat boxes and a bar, which at head scale
        # read as black tape stuck over the eyes
        # (artifacts/p72/arnold_schwarzenegger-head-front.png).
        eye_z = 1.632
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            eye_x = side * 0.040
            face = kernel.head_front_y(eye_x, eye_z)
            # A torus is authored in the XY plane; a 90 deg turn about X stands it up in the face
            # plane, normal along Y. Squashed on its local Y (world Z) so it reads wide, not round.
            rim = kernel.torus(f'head-shades-rim-{tag}', 0.0255, 0.0042,
                               (eye_x, face - 0.009, eye_z), palette['hair'],
                               rotation=(math.radians(90), 0, 0))
            rim.scale = (1.0, 0.82, 1.0)
            parts.append(kernel.loft(f'head-shades-lens-{tag}', [
                {'x': eye_x, 'y': face - 0.0076, 'z': eye_z, 'rx': 0.0228, 'rz': 0.0186},
                {'x': eye_x, 'y': face - 0.0042, 'z': eye_z, 'rx': 0.0228, 'rz': 0.0186},
            ], palette['boot'], segments=18, axis='Y', uv_tiles=(1.0, 1.0)))
            parts.append(rim)
        parts.append(kernel.box('head-shades-bridge', (0.026, 0.008, 0.008),
                                (0.0, kernel.head_front_y(0.0, eye_z) - 0.008, eye_z + 0.005),
                                palette['hair']))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'head-shades-temple-{tag}', (0.008, 0.070, 0.008),
                                    (side * 0.062, kernel.head_front_y(side * 0.040, eye_z) + 0.032,
                                     eye_z + 0.005), palette['hair']))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'torso-jacket-lapel-{tag}', (0.030, 0.020, 0.150),
                                    (side * 0.058, -0.108, 1.300), palette['gi_shade'],
                                    rotation=(0, 0, side * 0.30)))
            base = side * kernel.SHOULDER_X
            parts.append(kernel.shell(f'upperarm-jacket-{tag}', [
                {'x': base + side * 0.002, 'z': 1.420, 'rx': 0.050, 'ry': 0.050},
                {'x': base + side * 0.010, 'z': 1.330, 'rx': 0.068, 'ry': 0.068},
                {'x': base + side * 0.014, 'z': 1.240, 'rx': 0.058, 'ry': 0.058},
            ], palette['gi_shade'], segments=18, thickness=0.009, uv_tiles=(1.6, 1.2)))
        parts.append(kernel.torus('torso-jacket-collar', 0.062, 0.012, (0.0, 0.006, 1.430),
                                  palette['gi_shade'], rotation=(math.radians(12), 0, 0)))

    return parts


def build_extras(palette, extras, hat_colour=None):
    """Signature accessories. Named so the shared weighting maps each to the right bone: `torso-*`
    blends along the spine, `upperarm-*` rides the arm, `head-*` rides the head."""
    parts = []
    if 'cape' in extras:
        parts.append(kernel.loft('torso-cape', [
            {'y': 0.128, 'z': 1.462, 'rx': 0.126, 'ry': 0.016},
            {'y': 0.146, 'z': 1.322, 'rx': 0.168, 'ry': 0.017},
            {'y': 0.158, 'z': 1.120, 'rx': 0.196, 'ry': 0.016},
            {'y': 0.164, 'z': 0.880, 'rx': 0.206, 'ry': 0.014},
            {'y': 0.160, 'z': 0.660, 'rx': 0.186, 'ry': 0.012},
            {'y': 0.150, 'z': 0.470, 'rx': 0.140, 'ry': 0.010},
        ], palette['gi'], segments=18, axis='Z', uv_tiles=(2.0, 2.6)))
    if 'beard' in extras:
        # A beard wraps the jaw; it is not a disc in front of it. The previous version lofted four
        # rings centred at y=-0.078 with rx up to 0.056 - an 11 cm oval floating 3 cm proud of a
        # 9.8 cm chin. From the front it read as a black puck stuck over the mouth (caught in
        # artifacts/p72/kratos-head-front.png), and it swallowed the lower lip that sits at
        # z=1.552. These rings are centred on the skull axis and sized just outside the jaw, so the
        # beard is the jaw surface from the mouth line down, tapering to a point over the neck.
        # Sized just outside the jaw it covers - 3 mm proud, not 12. At rx 0.078 / ry 0.092 the first
        # attempt was an 18 cm ellipsoid: a glossy black balloon from nose to collarbone, which read
        # as a second helmet and covered the chin entirely
        # (artifacts/phase73/kratos-head-front.png). The top ring also drops to 1.540 so the mouth
        # at 1.552 keeps a clear lip line above the beard.
        parts.append(kernel.loft('head-beard', [
            {'y': 0.000, 'z': 1.538, 'rx': 0.056, 'ry': 0.068, 'front': 1.05},
            {'y': 0.000, 'z': 1.514, 'rx': 0.060, 'ry': 0.072, 'front': 1.07},
            {'y': 0.002, 'z': 1.490, 'rx': 0.054, 'ry': 0.066, 'front': 1.09},
            {'y': 0.006, 'z': 1.466, 'rx': 0.040, 'ry': 0.050, 'front': 1.10},
            {'y': 0.010, 'z': 1.442, 'rx': 0.020, 'ry': 0.026, 'front': 1.10},
        ], palette['beard'], segments=18, uv_tiles=(1.4, 1.0)))
    if 'eyewear' in extras:
        parts.append(kernel.box('head-eyewear', (0.070, 0.028, 0.016), (0.0, -0.092, 1.612),
                                palette['gi_shade']))
    if 'headband' in extras:
        parts.append(kernel.shell('head-band', [
            {'z': 1.660, 'rx': 0.098, 'ry': 0.112, 'gap': 0.0},
            {'z': 1.690, 'rx': 0.100, 'ry': 0.114, 'gap': 0.0},
        ], palette['gi'], segments=24, thickness=0.010, uv_tiles=(1.8, 0.4)))
        parts.append(kernel.box('head-band-plate', (0.090, 0.020, 0.048), (0.0, -0.108, 1.674),
                                palette['trim']))
    if 'hat' in extras:
        metal = kernel.make_material('fighter-hat', _hex(hat_colour or 0x2A2E38), 0.1, 0.6)
        # A 0.212 m brim on a 0.10 m skull is a flying saucer, not a cap: the roster captures showed
        # Mario, Luigi, Link and Aladdin wearing a red/green disc wider than their shoulders. The
        # brim now clears the skull by ~2 cm and sits on the hairline instead of through it.
        parts.append(kernel.torus('head-hat-brim', 0.134, 0.020, (0.0, 0.004, 1.716), metal,
                                  rotation=(math.radians(6), 0, 0)))
        parts.append(kernel.loft('head-hat-crown', [
            {'y': 0.004, 'z': 1.700, 'rx': 0.098, 'ry': 0.100},
            {'y': 0.004, 'z': 1.740, 'rx': 0.096, 'ry': 0.098},
            {'y': 0.004, 'z': 1.776, 'rx': 0.068, 'ry': 0.070},
            {'y': 0.004, 'z': 1.790, 'rx': 0.028, 'ry': 0.029},
        ], metal, segments=22, uv_tiles=(1.6, 1.0)))
    return parts


# --------------------------------------------------------------------------- post-processing


def scale_character(body, armature, build):
    """Apply the fighter's own build.

    A broad fighter is not simply a tall one, so the horizontal and vertical factors are separate:
    scaling x/y widens the shoulders, chest and limbs about the body's centre line without moving
    the feet off the ground, and z scales the height. Bones are scaled to match, and the weighting
    has already happened by this point, so the blend windows stay valid.
    """
    sx, sy, sz = build
    if (sx, sy, sz) == (1.0, 1.0, 1.0):
        return
    for vertex in body.data.vertices:
        vertex.co.x *= sx
        vertex.co.y *= sy
        vertex.co.z *= sz
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.select_all(action='DESELECT')
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.mode_set(mode='EDIT')
    for bone in armature.data.edit_bones:
        bone.head = (bone.head.x * sx, bone.head.y * sy, bone.head.z * sz)
        bone.tail = (bone.tail.x * sx, bone.tail.y * sy, bone.tail.z * sz)
    bpy.ops.object.mode_set(mode='OBJECT')


# --------------------------------------------------------------------------- build


def join_all(parts, name):
    """Join every part into the single mesh the armature binds to.

    bpy.ops.object.join() acts on the selection the *context* reports, and a selection assembled
    with plain object.select_set() is not always the list the operator actually reads. The parts
    built after the last bpy.ops.mesh.primitive_*_add call - every hair lock, garment panel and
    accessory - were left behind as separate objects. Nothing raised, and the export still contained
    a skinned mesh, so a check that only asks "is anything skinned?" passed while those parts sat
    unweighted at the scene root, motionless, while the body animated underneath them. Verified by
    scripts/_probe-skin.mjs on the first roster export: 33 meshes, 13 skinned, 20 static.

    Passing the objects through a context override makes the join unconditional, and the leftover
    count is asserted rather than trusted, because the failure mode is silent.
    """
    bpy.ops.object.select_all(action='DESELECT')
    active = parts[0]
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = active
    with bpy.context.temp_override(active_object=active, selected_objects=parts,
                                   selected_editable_objects=parts):
        bpy.ops.object.join()
    body = active
    body.name = name
    body.data.name = name
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0006)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    leftover = sorted(obj.name for obj in bpy.context.scene.objects
                      if obj.type == 'MESH' and obj is not body)
    if leftover:
        raise SystemExit('%s: %d part(s) did not join the body: %s'
                         % (name, len(leftover), leftover[:10]))
    return body


# --------------------------------------------------------------------------- clip shaping
#
# Every fighter used to export the same eight clips, whatever its build and whatever its movement
# profile in the game. That is the animation half of "a recoloured controller, not a movement
# identity": the gameplay moved a speedster 24% faster while the walk cycle stepped exactly as far
# as a brawler's. The clips are now shaped from the same numbers the movement system uses, read out
# of public/js/combat/locomotion.js so the two cannot drift apart in either direction.
LOCOMOTION_JS = os.path.join(_HERE, '..', '..', 'public', 'js', 'combat', 'locomotion.js')


def locomotion_speeds():
    """slug -> speed multiplier, read from the game's own locomotion table.

    public/js/combat/locomotion.js defines `profile(speed, overrides)` where `speed` is a
    multiplier on the shared base speeds (5.1 / 8.8 / 12.5 m/s), not a metres-per-second figure:
    the entry at 1.24 moves 24% faster than the base. The archetype fallback table that follows
    uses the same shape but its keys are archetypes rather than fighters, so the read stops there.
    """
    try:
        with open(os.path.abspath(LOCOMOTION_JS)) as handle:
            source = handle.read()
    except OSError:
        return {}
    source = source.split('ARCHETYPE_LOCOMOTION')[0]
    speeds = {}
    for match in re.finditer(r'^\s*([a-z0-9_]+):\s*profile\(\s*([0-9.]+)', source, re.M):
        speeds[match.group(1)] = float(match.group(2))
    return speeds


# Pose shaping by archetype: a brawler plants wider and lower, a ninja stays narrow and quick, a
# mage keeps the torso upright. Multipliers, applied on top of the speed-derived stride.
ARCHETYPE_CLIP_PROFILE = {
    'brawler': {'lean': 1.14, 'crouch': 1.18, 'stance': 1.16},
    'ninja': {'lean': 0.90, 'crouch': 0.92, 'stance': 0.94, 'swing': 1.06},
    'warrior': {},
    'mage': {'lean': 0.80, 'crouch': 0.86, 'stance': 0.90, 'swing': 0.92},
    'cyborg': {'lean': 0.96, 'crouch': 1.02, 'stance': 1.05},
}


def clip_profile_for(slug, archetype):
    profile = dict(ARCHETYPE_CLIP_PROFILE.get(archetype, {}))
    speed = locomotion_speeds().get(slug, 1.0)
    # Stride tracks the fighter's own top speed, clamped so the slowest fighter still steps far
    # enough to leave the ground and the fastest does not over-rotate at the hip.
    profile['stride'] = round(min(1.28, max(0.86, speed)), 3)
    profile.setdefault('swing', round(min(1.2, max(0.88, 0.7 + profile['stride'] * 0.3)), 3))
    profile.setdefault('lean', 1.0)
    profile.setdefault('crouch', 1.0)
    profile.setdefault('stance', 1.0)
    return profile



def densify_muzzle_band(part):
    """Add resolution to the head where the muzzle is sculpted.

    The head is a 42-row loft. A 32 mm snout could not be represented on it: the flat tip plane
    landed on 1-2 vertices, so the profile read as a bump no matter how far it was pushed. The
    sculpted region is subdivided in place, before weighting and binding, so the muzzle has
    geometry to displace. No part is added: these are still the head's own vertices.
    """
    if os.environ.get('VOLDEMORT_NO_SUBDIVIDE') == '1':
        return 0
    mesh = part.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    band = [edge for edge in bm.edges if all(
        vertex.co.y < -0.020 and 1.490 <= vertex.co.z <= 1.566 and abs(vertex.co.x) < 0.060
        for vertex in edge.verts)]
    if band:
        bmesh.ops.subdivide_edges(bm, edges=band, cuts=2, use_grid_fill=True)
        # Subdividing a loft leaves new vertices coincident with, but not welded to, their neighbours:
        # that is where the visible cheek seams came from. Weld and recalculate normals so the patch
        # is one continuous surface and deforms as one.
        # Measured, not assumed: welding the head does nothing. At 0.0008 the boundary-edge count was
        # unchanged, so the threshold was raised to 3.5 mm and the count was STILL 124 with an
        # unchanged 6228 vertices - the head has no coincident duplicates at all. The open boundary
        # loops sit 7.5-44 mm apart (median 22 mm), i.e. they are genuine openings in the shell, not
        # seams that can be merged. No weld is applied, because there is nothing weldable; closing
        # them would need new bridging geometry, which is a rebuild rather than a repair.
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(band)

def sculpt_voldemort_head(parts):
    """Turn the built human head into the Dark Lord's, by moving its own vertices.

    This is deliberately *not* a set of new parts laid over the face, and it deletes nothing: the
    template nose stops existing as a nose because its own vertices are collapsed into a flat, wide
    muzzle plane, and the round eyes are sunk into sockets carved out of the skull. Removing the
    template parts and appending replacements was tried first and crashed Blender in `join_all`:
    deleting objects leaves stale references behind, and the operator segfaults on them.

    Editing vertices in place keeps the object graph intact, so weighting, joining, binding and
    export all see exactly the part list they were written for. The rig, clips and moveset are
    untouched.
    """
    eye_z = 1.614
    eye_x = 0.038
    for part in parts:
        name = part.name
        vertices = part.data.vertices
        if name == 'head':
            densify_muzzle_band(part)
            vertices = part.data.vertices
            for vertex in vertices:
                co = vertex.co
                if co.y > -0.030:
                    continue
                for side in (-1, 1):
                    distance = math.hypot(co.x - side * eye_x, co.z - eye_z)
                    if distance < 0.027:
                        # 16 mm deep at the socket centre, fading to nothing at the rim: a real
                        # hollow in the skull, which is what makes the eyes read as recessed.
                        co.y += 0.016 * (1.0 - distance / 0.027) ** 1.4
                # Flatten the face below the sockets into one plane so nothing reads as a bridge.
                if abs(co.x) < 0.032 and 1.554 <= co.z <= 1.602 and co.y < -0.086:
                    co.y = -0.086
                # The template head has no nose object, so the muzzle has to come out of the skull's
                # own vertices. This ridge stands 16 mm proud of the flat plane and falls away to the
                # cheeks and chin, which is what gives a snake head its profile: the previous pass
                # only flattened the human nose and left nothing in its place.
                # A snake muzzle, built from the skull's own vertices. The earlier version used a
                # single narrow ridge: it measured as projection but read as a bump because the
                # bridge was as narrow as the tip. This one is broad across the bridge (44 mm), keeps
                # a flat plateau at the tip, and is judged against the cheek surface rather than the
                # head's maximum extent.
                # The first two passes projected 16 mm and 19 mm: measurable, but still a bump in
                # profile. A snake reads by a snout that visibly leaves the skull, so this pass
                # doubles the projection, widens the bridge to the brow line, and slopes the brow
                # into the bridge so the transition is a ramp rather than a step.
                # Measured defect this pass fixes: the whole muzzle sat about 45 mm too high, so
                # the imported GLB put its tip plane level with the eyes (front-most vertex at
                # y 1.6833 against an eye bottom of 1.6782) and the profile bulged above the brow.
                # The exported body is the author space + 0.105 m, so the eye line is author 1.573:
                # the snout now lives entirely below it, from 1.498 up to 1.562.
                if co.y < -0.050 and 1.498 <= co.z <= 1.562 and abs(co.x) < 0.048:
                    lateral = max(0.0, 1.0 - abs(co.x) / 0.048)
                    vertical = max(0.0, 1.0 - abs(co.z - 1.530) / 0.032)
                    weight = lateral ** 0.5 * vertical ** 0.62
                    co.y -= 0.030 * weight
                    # Wide nasal ridge, not a keel.
                    co.x *= 1.0 + 0.30 * weight
                    # Flat tip plane, 32 mm proud, entirely below the eye line.
                    # Flat tip cap. Measured, not assumed: the wider 36 mm x 34 mm band put 16 vertices
                    # on the plane with 0.5 mm of spread, while a narrower 28 x 38 mm band put only 8
                    # vertices on it with 2.8 mm. The perceived roundness was never the cap's flatness,
                    # so the band that measures flatter is the one kept.
                    if 1.512 <= co.z <= 1.548 and abs(co.x) < 0.017:
                        co.y = min(co.y, -0.118)
                    # Forehead meets the snout without a ridge: the band above the eye line recedes
                    # slightly instead of standing forward, which is what the 15 mm hump was.
                    if 1.560 <= co.z <= 1.578 and abs(co.x) < 0.030:
                        co.y += 0.006 * max(0.0, 1.0 - abs(co.x) / 0.030)
                # Nostrils: deeper and wider than the first attempt (14 mm back, 9 mm across), cut
                # into the front of the snout so they read as openings rather than a dimple.
                # Nostrils: 16 mm deep and 11 mm across, cut into the underside of the tip. The
                # previous 14 mm cut measured as a 3.4 mm dimple once the tip geometry existed.
                # Nostrils cut into the flat cap, not dimpled on a curve: 24 mm deep, 21 mm across,
                # punched from the cap plane so the opening keeps a rim and a floor. The 17 mm cut
                # bottomed out before the face plane and read as a dimple once the cap existed.
                for side in (-1, 1):
                    hole = math.hypot(co.x - side * 0.0125, co.z - 1.528)
                    if co.y < -0.100 and hole < 0.0105:
                        co.y += 0.024 * (1.0 - hole / 0.0105)
        elif name.startswith(('eye-', 'iris-', 'pupil-')):
            # Sink the round eye into its socket and squeeze it into a vertical slit.
            cx = sum(v.co.x for v in vertices) / len(vertices)
            cz = sum(v.co.z for v in vertices) / len(vertices)
            for vertex in vertices:
                co = vertex.co
                # 0.40 wide by 1.95 tall is a vertical slit; 0.55/1.45 was still a rounded oval.
                co.x = cx + (co.x - cx) * 0.40
                co.z = cz + (co.z - cz) * 1.95
                co.y += 0.011
        elif name.startswith('brow'):
            # Heavier ridges over the sockets: the strongest identity cue at gameplay distance.
            for vertex in vertices:
                co = vertex.co
                co.z += 0.004
                co.y -= 0.005
        elif name.startswith('mouth'):
            # A thin mouth line instead of two lips.
            cz = sum(v.co.z for v in vertices) / len(vertices)
            for vertex in vertices:
                co = vertex.co
                co.z = cz + (co.z - cz) * 0.45
    return parts

def build_fighter(slug):
    design, archetype = design_for(slug)
    style, head, hair_style, extras, build, hat_colour, _hair = design

    kernel.reset_scene()
    kernel.PALETTE.clear()
    kernel.PALETTE.update(palette_for(slug))

    parts = kernel.build_body()


    # Substitute the garment layer: the reference body is built with the wrapped gi, so any other
    # style replaces those parts rather than stacking another shell on top of them.
    # Costumed archetypes wear gloves; brawlers are bare-handed, which is what makes a brawler read
    # as a brawler at gameplay distance.
    gloves = archetype != 'brawler' and style in ('armor', 'suit', 'robe')
    if style != 'gi':
        parts = drop(parts, is_garment_part)
        if style == 'armor':
            parts += build_armour_layer(kernel.PALETTE, extras, gloves=gloves)
        else:
            parts += build_suit_layer(kernel.PALETTE, extras, gloves=gloves)
            if style == 'robe' and 'cape' not in extras:
                extras = list(extras) + ['cape']

    # Substitute the head. A helmet or a mask replaces the whole face rather than covering it, so no
    # skin, eyes or hair geometry is left sealed inside the shell. A bare face keeps the reference
    # skull and only swaps the hair.
    if head in ('helmet', 'mask'):
        parts = drop(parts, is_face_part)
        parts += build_helmet(kernel.PALETTE) if head == 'helmet' else build_mask(kernel.PALETTE)
    else:
        # 'face' and 'bald' are both bare faces - 'bald' simply gets no hair, because that is what
        # build_hair() returns for it. Testing `head != 'face'` here put a mask on every bald
        # fighter (Professor X, Kratos, Saitama, Voldemort, Shrek, Ursula, The Rock, Aang).
        parts = drop(parts, lambda name: name.startswith(('hair', 'fringe')))
        parts += build_hair(hair_style, kernel.PALETTE)

    parts += build_extras(kernel.PALETTE, extras, hat_colour)
    parts += build_signature_details(slug, kernel.PALETTE)
    parts += build_identity_rebuild(slug, kernel.PALETTE)
    parts += p22.build_batch_a_equipment(kernel, slug, kernel.PALETTE)
    # Facial identity is sculpted on the built head, before weighting, so the rig binds the
    # individual face rather than the shared template.
    parts += p22.build_roster_equipment_pass2(kernel, slug, kernel.PALETTE)
    p22.sculpt_face(parts, slug)
    p22.sculpt_anatomy(parts, slug)
    if slug == 'lord_voldemort':
        sculpt_voldemort_head(parts)

    if os.environ.get('ROSTER_DEBUG_FACE'):
        for part in parts:
            co = [v.co for v in part.data.vertices]
            if not co:
                continue
            xs = [c.x for c in co]; ys = [c.y for c in co]; zs = [c.z for c in co]
            if (min(xs) < 0.09 and max(xs) > -0.09 and min(ys) < -0.055
                    and max(zs) > 1.53 and min(zs) < 1.72):
                print('FACE-PART %-28s x[%.3f %.3f] y[%.3f %.3f] z[%.3f %.3f] mat=%s'
                      % (part.name, min(xs), max(xs), min(ys), max(ys), min(zs), max(zs),
                         part.data.materials[0].name if part.data.materials else '?'))

    kernel.weight_parts(parts)
    name = ''.join(word.title() for word in slug.split('_')) + '_Body'
    body = join_all(parts, name)
    armature = kernel.build_armature()
    kernel.bind_armature(body, armature)

    bone_names = {bone.name for bone in armature.data.bones}
    group_names = {group.name for group in body.vertex_groups}
    unbound = sum(1 for vertex in body.data.vertices if not vertex.groups)
    orphan_groups = sorted(group_names - bone_names)
    if unbound or orphan_groups:
        raise SystemExit('%s: bind failed - %d unweighted vertices, groups with no bone: %s'
                         % (slug, unbound, orphan_groups or 'none'))

    scale_character(body, armature, build)
    clips = clip_profile_for(slug, archetype)
    kernel.build_animations(armature, clips)
    bpy.context.view_layer.update()

    os.makedirs(os.path.join(OUT_DIR), exist_ok=True)
    path = kernel.export(os.path.join(OUT_DIR, '%s.glb' % slug))

    zs = [vertex.co.z for vertex in body.data.vertices]
    xs = [vertex.co.x for vertex in body.data.vertices]
    return {
        'slug': slug,
        'archetype': archetype,
        'style': style,
        'head': head,
        'hair': hair_style,
        'extras': list(extras),
        'build': list(build),
        'file': path,
        'bytes': os.path.getsize(path),
        'triangles': sum(len(poly.vertices) - 2 for poly in body.data.polygons),
        'vertices': len(body.data.vertices),
        'materials': [mat.name for mat in body.data.materials],
        'bones': len(armature.data.bones),
        'weightedVertices': sum(1 for vertex in body.data.vertices if vertex.groups),
        'multiWeightVertices': sum(1 for vertex in body.data.vertices if len(vertex.groups) > 1),
        'actions': [action.name for action in bpy.data.actions],
        'height': round(max(zs) - min(zs), 3),
        'width': round(max(xs) - min(xs), 3),
        'groundZ': round(min(zs), 3),
        'formSurfaces': sorted({mat.name for mat in body.data.materials}
                               & {'fighter-hair', 'fighter-accent', 'arc-reactor'}),
        'clipProfile': clips,
    }


def main():
    slugs = [slug for slug in LAUNCH if slug != 'kaze']
    if GROUP == 'dlc':
        slugs = [slug for slug in ARCHETYPE if slug not in LAUNCH]
    elif GROUP == 'all':
        slugs = [slug for slug in ARCHETYPE if slug != 'kaze']
    if ONLY:
        wanted = set(ONLY.split(','))
        slugs = [slug for slug in slugs if slug in wanted]

    reports = []
    for slug in slugs:
        try:
            reports.append(build_fighter(slug))
            print('ROSTER_BUILD ok %s' % slug, flush=True)
        except Exception as error:  # one bad spec must not lose the whole batch
            print('ROSTER_BUILD fail %s: %s' % (slug, error), flush=True)
    print('ROSTER_REPORT ' + json.dumps(reports))
    if REPORT:
        os.makedirs(os.path.dirname(os.path.abspath(REPORT)), exist_ok=True)
        with open(REPORT, 'w') as handle:
            json.dump(reports, handle, indent=2)


if __name__ == '__main__':
    main()
