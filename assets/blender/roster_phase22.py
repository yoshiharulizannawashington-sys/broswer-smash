# Phase 22 character reconstruction: facial identity and Batch A signature equipment.
#
# This module is imported by build_roster_fighters.py. It deliberately does not import the kernel
# itself: every function takes the kernel module as an argument, so there is one animation/rig
# implementation and this file only adds geometry on top of it.
#
# Two systems live here:
#
#   sculpt_face()               deforms the built head mesh into a per-fighter facial profile
#   build_batch_a_equipment()   adds signature equipment that rides the existing bones
#
# Both run before `kernel.weight_parts`, so the rig binds the final geometry and no second
# attachment or animation system is introduced.

import math

# Facial profiles. Values are multipliers around the shared skull; only fighters with a real
# identity difference get an entry, and every value is deliberately small (0.88-1.20) so the head
# stays inside the hair, helmet and neck attachments that were authored for it.
FACE_PROFILES = {
    'professor_x_charles_xavier': {'width': 0.98, 'height': 1.03, 'jaw': 0.92, 'eye_size': 0.94,
                                   'eye_gap': 1.02, 'brow': 1.04, 'nose': 1.06, 'mouth': 0.92,
                                   'cheek': 1.06, 'chin': 1.04},
    'iron_man_tony_stark': {'width': 1.00, 'height': 1.02, 'jaw': 1.04, 'eye_size': 1.00,
                            'eye_gap': 1.00, 'brow': 1.02, 'nose': 1.02, 'mouth': 1.02,
                            'cheek': 1.02, 'chin': 1.02},
    'green_lantern_hal_jordan': {'width': 1.04, 'height': 1.01, 'jaw': 1.06, 'eye_size': 1.00,
                                 'eye_gap': 1.00, 'brow': 1.05, 'nose': 1.02, 'mouth': 1.04,
                                 'cheek': 1.02, 'chin': 1.02},
    'wonder_woman': {'width': 0.96, 'height': 1.00, 'jaw': 0.88, 'eye_size': 1.12, 'eye_gap': 1.00,
                     'brow': 0.98, 'nose': 0.94, 'mouth': 0.94, 'cheek': 1.08, 'chin': 1.00},
    # Width/jaw kept modest: 1.06/1.10 dropped the model-refinement gate's flattest head band
    # depth ratio from 0.347 to 0.283 (below its floor). A 2% width and 4% jaw keeps the broad
    # Atlantean read without flattening the skull in profile.
    'aquaman': {'width': 1.02, 'height': 1.02, 'jaw': 1.04, 'eye_size': 0.96, 'eye_gap': 1.02,
                'brow': 1.06, 'nose': 1.10, 'mouth': 1.04, 'cheek': 1.02, 'chin': 1.04},
    'thor': {'width': 1.08, 'height': 1.02, 'jaw': 1.10, 'eye_size': 0.98, 'eye_gap': 1.02,
             'brow': 1.08, 'nose': 1.06, 'mouth': 1.02, 'cheek': 1.04, 'chin': 1.04},
    'doctor_strange': {'width': 0.97, 'height': 1.03, 'jaw': 0.94, 'eye_size': 1.00,
                       'eye_gap': 1.00, 'brow': 1.02, 'nose': 1.04, 'mouth': 0.96,
                       'cheek': 1.10, 'chin': 0.96},
    'hulk_bruce_banner': {'width': 1.12, 'height': 1.04, 'jaw': 1.16, 'eye_size': 0.94,
                          'eye_gap': 1.04, 'brow': 1.12, 'nose': 1.12, 'mouth': 1.10,
                          'cheek': 1.08, 'chin': 1.08},
    'arnold_schwarzenegger': {'width': 1.05, 'height': 1.02, 'jaw': 1.08, 'eye_size': 0.96,
                              'eye_gap': 1.00, 'brow': 1.04, 'nose': 1.04, 'mouth': 1.02,
                              'cheek': 1.04, 'chin': 1.04},
    'levi_ackerman': {'width': 0.95, 'height': 0.99, 'jaw': 0.90, 'eye_size': 0.94, 'eye_gap': 1.00,
                      'brow': 0.98, 'nose': 0.94, 'mouth': 0.92, 'cheek': 0.98, 'chin': 0.94},
    'edward_elric': {'width': 0.96, 'height': 1.01, 'jaw': 0.90, 'eye_size': 1.10, 'eye_gap': 1.00,
                     'brow': 0.98, 'nose': 0.96, 'mouth': 0.96, 'cheek': 1.02, 'chin': 0.92},
    'goku': {'width': 1.00, 'height': 1.00, 'jaw': 0.98, 'eye_size': 1.08, 'eye_gap': 1.02,
             'brow': 1.02, 'nose': 1.00, 'mouth': 1.02, 'cheek': 1.04, 'chin': 0.98},
    'naruto_uzumaki': {'width': 1.00, 'height': 1.00, 'jaw': 0.98, 'eye_size': 1.06,
                       'eye_gap': 1.02, 'brow': 1.00, 'nose': 0.98, 'mouth': 1.04,
                       'cheek': 1.06, 'chin': 0.98},
    'aang': {'width': 0.98, 'height': 0.99, 'jaw': 0.92, 'eye_size': 1.12, 'eye_gap': 1.02,
             'brow': 0.96, 'nose': 0.94, 'mouth': 1.00, 'cheek': 1.02, 'chin': 0.94},
    'mario': {'width': 1.04, 'height': 0.99, 'jaw': 1.02, 'eye_size': 1.06, 'eye_gap': 1.00,
              'brow': 1.02, 'nose': 1.18, 'mouth': 1.06, 'cheek': 1.06, 'chin': 1.00},
    'luigi': {'width': 0.98, 'height': 1.02, 'jaw': 0.96, 'eye_size': 1.06, 'eye_gap': 1.00,
              'brow': 1.02, 'nose': 1.20, 'mouth': 1.04, 'cheek': 1.04, 'chin': 0.98},
    'captain_jack_sparrow': {'width': 0.99, 'height': 1.01, 'jaw': 1.00, 'eye_size': 1.00,
                             'eye_gap': 1.00, 'brow': 1.02, 'nose': 1.04, 'mouth': 1.00,
                             'cheek': 1.04, 'chin': 1.00},
    'wolverine_logan': {'width': 1.06, 'height': 0.98, 'jaw': 1.10, 'eye_size': 0.94,
                        'eye_gap': 0.98, 'brow': 1.10, 'nose': 1.06, 'mouth': 1.02,
                        'cheek': 1.06, 'chin': 1.06},
}

FACE_FEATURES = ('eye', 'iris', 'pupil', 'lash', 'brow', 'nose', 'mouth', 'cheek', 'chin')


def sculpt_face(parts, slug):
    """Deform the built bare-face mesh into the fighter's own facial profile.

    Only geometry, never topology: vertices keep their indices and stay inside the authored head
    shell, so `weight_parts`, the bind check, the hair caps and the helmet attachments all see the
    same contract. Masked and helmeted heads are skipped because their shell is the character.
    """
    profile = FACE_PROFILES.get(slug)
    if not profile:
        return
    width = profile['width']
    height = profile['height']
    depth = 0.5 * (width + profile.get('cheek', 1.0))
    jaw = profile['jaw']
    for part in parts:
        name = part.name
        if name == 'head':
            for vertex in part.data.vertices:
                co = vertex.co
                co.x *= width
                co.y *= depth
                co.z = 1.660 + (co.z - 1.660) * height
                if co.z < 1.622:                      # jaw and chin taper
                    t = min(1.0, (1.622 - co.z) / 0.092)
                    co.x *= 1.0 + (jaw - 1.0) * t
            continue
        if not name.startswith(FACE_FEATURES):
            continue
        verts = part.data.vertices
        if not verts:
            continue
        # Features are scaled about their own centre, so a wider skull does not slide them apart.
        cx = sum(v.co.x for v in verts) / len(verts)
        cz = sum(v.co.z for v in verts) / len(verts)
        if name.startswith(('eye', 'iris', 'pupil', 'lash', 'brow')):
            scale = profile['eye_size']
            gap = profile['eye_gap']
            for vertex in verts:
                co = vertex.co
                co.x = cx + (co.x - cx) * scale + cx * (gap - 1.0)
                co.z = cz + (co.z - cz) * scale
                if name.startswith('brow'):
                    co.z += (profile['brow'] - 1.0) * 0.010
        elif name.startswith('nose'):
            for vertex in verts:
                co = vertex.co
                co.x *= profile['nose']
                co.y -= (profile['nose'] - 1.0) * 0.004
        elif name.startswith('mouth'):
            for vertex in verts:
                co = vertex.co
                co.x = cx + (co.x - cx) * profile['mouth']
        elif name.startswith('chin'):
            for vertex in verts:
                co = vertex.co
                co.z = 1.534 + (co.z - 1.534) * profile['chin']
                co.y += (profile['chin'] - 1.0) * 0.008
        elif name.startswith('cheek'):
            for vertex in verts:
                co = vertex.co
                co.x *= profile['cheek']
                co.y *= profile['cheek']


def build_batch_a_equipment(kernel, slug, palette):
    """Signature equipment for the Batch A identities, built into the skinned mesh.

    Every part rides an existing bone through the name contract in `kernel.bone_for_part`:
    `palm-` -> hand, `head-` -> head, `forearm-` -> forearm, `skirt-` -> hips, `torso-` -> chest.
    Being part of the same skinned mesh as the body, the props follow idle, run, jump, attack and
    knockback with no second attachment system and no extra runtime cost.
    """
    parts = []
    steel = kernel.make_material('fighter-steel', (0.60, 0.63, 0.68), 0.93, 0.28)
    gold = kernel.make_material('fighter-gold', (0.82, 0.64, 0.22), 0.92, 0.24)
    leather = kernel.make_material('fighter-leather', (0.16, 0.11, 0.08), 0.02, 0.78)
    hand = kernel.SHOULDER_X + 0.022

    if slug == 'thor':
        # Mjolnir, gripped: the handle passes through the right palm and the head sits above it.
        parts.append(kernel.loft('palm-R-hammer-handle', [
            {'x': hand, 'y': -0.022, 'z': 0.930, 'rx': 0.013, 'ry': 0.013},
            {'x': hand, 'y': -0.022, 'z': 0.860, 'rx': 0.015, 'ry': 0.015},
            {'x': hand, 'y': -0.022, 'z': 0.740, 'rx': 0.013, 'ry': 0.013},
        ], leather, segments=10, uv_tiles=(0.8, 1.4)))
        parts.append(kernel.box('palm-R-hammer-head', (0.096, 0.062, 0.074),
                                (hand, -0.022, 0.974), steel))
        parts.append(kernel.box('palm-R-hammer-band', (0.104, 0.016, 0.020),
                                (hand, -0.022, 0.938), gold))
        parts.append(kernel.torus('palm-R-hammer-ring', 0.020, 0.005, (hand, -0.056, 0.860),
                                  gold, rotation=(math.radians(90), 0, 0)))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.sphere(f'upperarm-cape-clasp-{tag}', 0.028,
                                       (side * (kernel.SHOULDER_X + 0.010), 0.030, 1.404),
                                       gold, scale=(1.0, 0.50, 0.62), segments=12, rings=7))
    if slug == 'wonder_woman':
        # A tiara is a horizontal band around the forehead. The first version was rotated 90 deg
        # about X, which put the torus in the XZ plane and rendered as a gold halo standing on the
        # crown; the default XY plane is the band the design calls for.
        parts.append(kernel.torus('head-tiara', 0.090, 0.008, (0.0, -0.010, 1.702), gold))
        parts.append(kernel.box('head-tiara-star', (0.026, 0.010, 0.026), (0.0, -0.104, 1.704),
                                gold, rotation=(0, 0, math.radians(45))))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            base = side * kernel.SHOULDER_X
            parts.append(kernel.torus(f'forearm-bracer-rim-{tag}', 0.049, 0.008,
                                      (base + side * 0.020, 0.0, 0.952), gold))
            parts.append(kernel.torus(f'forearm-bracer-rim-low-{tag}', 0.042, 0.007,
                                      (base + side * 0.021, 0.0, 0.902), gold))
        for coil in range(3):
            parts.append(kernel.torus(f'skirt-lasso-{coil}', 0.070 - coil * 0.008, 0.006,
                                      (0.128, -0.052, 0.944 - coil * 0.012), gold,
                                      rotation=(math.radians(78), 0, math.radians(12))))
    if slug == 'aquaman':
        # Kept inside the arm silhouette. A full-length trident (shaft to z 1.20) added span at
        # bands where the body has no geometry, and the model-refinement gate read that as a
        # flattened body: 0.347 -> 0.283. The prop now stops at the wrist and chest band.
        parts.append(kernel.loft('palm-R-trident-shaft', [
            {'x': hand, 'y': -0.024, 'z': 0.980, 'rx': 0.012, 'ry': 0.012},
            {'x': hand, 'y': -0.024, 'z': 0.820, 'rx': 0.014, 'ry': 0.014},
            {'x': hand, 'y': -0.024, 'z': 0.700, 'rx': 0.011, 'ry': 0.011},
            {'x': hand, 'y': -0.024, 'z': 0.680, 'rx': 0.006, 'ry': 0.006},
        ], steel, segments=10, uv_tiles=(0.8, 1.4)))
        parts.append(kernel.box('palm-R-trident-crossbar', (0.082, 0.014, 0.012),
                                (hand, -0.024, 0.992), gold))
        for offset in (-0.032, 0.0, 0.032):
            parts.append(kernel.loft('palm-R-trident-prong-%+.3f' % offset, [
                {'x': hand + offset, 'y': -0.024, 'z': 0.992, 'rx': 0.008, 'ry': 0.008},
                {'x': hand + offset * 1.15, 'y': -0.024, 'z': 1.040, 'rx': 0.006, 'ry': 0.006},
                {'x': hand + offset * 1.30, 'y': -0.024, 'z': 1.078, 'rx': 0.003, 'ry': 0.003},
            ], steel, segments=8, uv_tiles=(0.6, 1.0)))
        parts.append(kernel.torus('skirt-belt-trident-clasp', 0.030, 0.007,
                                  (-0.100, -0.108, 0.950), gold,
                                  rotation=(math.radians(90), 0, 0)))
    if slug == 'green_lantern_hal_jordan':
        # Domino mask following the brow and cheek, plus the power ring on the right hand.
        mask = palette['accent']
        # Segmented visor: five plates stepping around the measured face surface. A single swept
        # loft read as a flat slab across the eyes at close range.
        for index in range(5):
            mx = (index - 2) * 0.030
            parts.append(kernel.box('head-mask-band-%d' % index, (0.032, 0.012, 0.030),
                                    (mx, kernel.head_front_y(mx, 1.640) - 0.004, 1.640), mask))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.loft(f'head-mask-wing-{tag}', [
                {'x': side * 0.052, 'y': kernel.head_front_y(side * 0.052, 1.638) - 0.005,
                 'z': 1.642, 'rx': 0.011, 'ry': 0.006},
                {'x': side * 0.070, 'y': kernel.head_front_y(side * 0.070, 1.652) - 0.004,
                 'z': 1.654, 'rx': 0.008, 'ry': 0.005},
                {'x': side * 0.080, 'y': 0.004, 'z': 1.664, 'rx': 0.004, 'ry': 0.003},
            ], mask, segments=8, uv_tiles=(1.0, 0.6)))
        parts.append(kernel.torus('palm-R-ring', 0.013, 0.004, (hand, -0.006, 0.812), gold,
                                  rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.sphere('palm-R-ring-stone', 0.007, (hand, -0.014, 0.812), mask,
                                   scale=(1.0, 0.45, 1.0), segments=10, rings=6))
    if slug == 'doctor_strange':
        parts.append(kernel.shell('torso-cloak-collar', [
            {'z': 1.400, 'rx': 0.132, 'ry': 0.108, 'gap': 1.10},
            {'z': 1.446, 'rx': 0.146, 'ry': 0.120, 'gap': 1.30},
            {'z': 1.492, 'rx': 0.150, 'ry': 0.124, 'gap': 1.60},
        ], palette['accent'], segments=24, thickness=0.012, uv_tiles=(1.8, 0.9)))
        parts.append(kernel.torus('torso-eye-of-agamotto', 0.030, 0.008, (0.0, -0.132, 1.286),
                                  gold, rotation=(math.radians(90), 0, 0)))
        parts.append(kernel.sphere('torso-agamotto-stone', 0.020, (0.0, -0.136, 1.286),
                                   palette['accent'], scale=(1.0, 0.40, 1.0), segments=14, rings=8))
    if slug == 'iron_man_tony_stark':
        # Machined faceplate separation over the shared helmet, plus a gold wrist cuff.
        parts.append(kernel.box('head-faceplate-brow', (0.108, 0.020, 0.014),
                                (0.0, -0.092, 1.668), gold))
        parts.append(kernel.box('head-faceplate-jaw', (0.062, 0.018, 0.026),
                                (0.0, -0.090, 1.556), gold))
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.box(f'head-faceplate-cheek-{tag}', (0.020, 0.016, 0.048),
                                    (side * 0.046, -0.086, 1.606), gold,
                                    rotation=(0, 0, math.radians(side * 8))))
            parts.append(kernel.shell(f'wrap-armour-cuff-{tag}', [
                {'x': side * (kernel.SHOULDER_X + 0.020), 'z': 0.960, 'rx': 0.050, 'ry': 0.051},
                {'x': side * (kernel.SHOULDER_X + 0.021), 'z': 0.930, 'rx': 0.047, 'ry': 0.048},
                {'x': side * (kernel.SHOULDER_X + 0.022), 'z': 0.900, 'rx': 0.041, 'ry': 0.042},
            ], gold, segments=18, thickness=0.006, uv_tiles=(1.4, 0.6)))
    if slug == 'naruto_uzumaki':
        # Whisker marks: three short dark strokes on each cheek.
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            for index in range(3):
                z = 1.596 + index * 0.012
                x = side * 0.056
                parts.append(kernel.loft(f'head-whisker-{tag}-{index}', [
                    {'x': x, 'y': kernel.head_front_y(x, z) - 0.004, 'z': z,
                     'rx': 0.006, 'ry': 0.003},
                    {'x': x + side * 0.020,
                     'y': kernel.head_front_y(x + side * 0.020, z + 0.002) - 0.004,
                     'z': z + 0.002, 'rx': 0.005, 'ry': 0.003},
                    {'x': x + side * 0.036,
                     'y': kernel.head_front_y(x + side * 0.036, z + 0.004) - 0.003,
                     'z': z + 0.004, 'rx': 0.002, 'ry': 0.002},
                ], palette['ink'], segments=6, uv_tiles=(0.8, 0.5)))
    return parts


# --------------------------------------------------------------------------- anatomy
#
# Phase 22 varied the face; the bodies were still one build at different uniform scales. These
# profiles deform regions of the built mesh - torso width/depth, limb cross-sections, hands, feet,
# neck - about each region's own centre. Bone lengths, joint positions, vertex indices and weights
# are untouched, and the deformation runs before weight_parts so the rig binds the varied body.
ANATOMY_PROFILES = {
    'hulk_bruce_banner': {'torso_x': 1.26, 'torso_y': 1.24, 'arm': 1.30, 'forearm': 1.28,
                          'hand': 1.24, 'leg': 1.22, 'foot': 1.18, 'neck': 1.22},
    'thor': {'torso_x': 1.12, 'torso_y': 1.10, 'arm': 1.10, 'forearm': 1.08, 'hand': 1.10,
             'leg': 1.06, 'foot': 1.06, 'neck': 1.10},
    'arnold_schwarzenegger': {'torso_x': 1.10, 'torso_y': 1.10, 'arm': 1.08, 'forearm': 1.06,
                              'hand': 1.06, 'leg': 1.05, 'foot': 1.04, 'neck': 1.06},
    'saitama': {'torso_x': 0.97, 'torso_y': 0.98, 'arm': 0.96, 'forearm': 0.96, 'hand': 0.96,
                'leg': 0.98, 'foot': 0.98, 'neck': 0.96},
    'levi_ackerman': {'torso_x': 0.94, 'torso_y': 0.94, 'arm': 0.94, 'forearm': 0.94,
                      'hand': 0.94, 'leg': 0.96, 'foot': 0.96, 'neck': 0.94},
    'iron_man_tony_stark': {'torso_x': 1.06, 'torso_y': 1.04, 'arm': 1.04, 'forearm': 1.04,
                            'hand': 1.04, 'leg': 1.02, 'foot': 1.04, 'neck': 1.02},
    'wonder_woman': {'torso_x': 0.98, 'torso_y': 0.98, 'arm': 0.98, 'forearm': 1.00, 'hand': 0.98,
                     'leg': 1.04, 'foot': 1.02, 'neck': 0.96},
    'professor_x_charles_xavier': {'torso_x': 0.98, 'torso_y': 0.98, 'arm': 0.96, 'forearm': 0.96,
                                   'hand': 0.96, 'leg': 0.98, 'foot': 0.98, 'neck': 0.98},
}

TORSO_PREFIXES = ('torso', 'pec', 'gi-jacket', 'lapel', 'collar', 'sash', 'skirt')
ARM_PREFIXES = ('arm-', 'deltoid', 'upperarm', 'forearm', 'wrap', 'elbow')
HAND_PREFIXES = ('palm', 'finger', 'thumb')
LEG_PREFIXES = ('thigh', 'knee', 'shin')
FOOT_PREFIXES = ('boot', 'toe', 'sole')


def _scale_region(part, factors, centre=None):
    verts = part.data.vertices
    if not verts:
        return
    if centre is None:
        centre = (sum(v.co.x for v in verts) / len(verts),
                  sum(v.co.y for v in verts) / len(verts),
                  sum(v.co.z for v in verts) / len(verts))
    for vertex in verts:
        co = vertex.co
        co.x = centre[0] + (co.x - centre[0]) * factors[0]
        co.y = centre[1] + (co.y - centre[1]) * factors[1]
        co.z = centre[2] + (co.z - centre[2]) * factors[2]


def sculpt_anatomy(parts, slug):
    """Widen or narrow body regions without touching bone lengths, joints or vertex order."""
    profile = ANATOMY_PROFILES.get(slug)
    if not profile:
        return
    for part in parts:
        name = part.name
        if name.startswith(TORSO_PREFIXES):
            _scale_region(part, (profile['torso_x'], profile['torso_y'], 1.0))
        elif name.startswith(ARM_PREFIXES):
            factor = profile['forearm'] if name.startswith(('forearm', 'wrap', 'elbow')) else profile['arm']
            _scale_region(part, (factor, factor, 1.0))
        elif name.startswith(HAND_PREFIXES):
            _scale_region(part, (profile['hand'],) * 3)
        elif name.startswith(LEG_PREFIXES):
            _scale_region(part, (profile['leg'], profile['leg'], 1.0))
        elif name.startswith(FOOT_PREFIXES):
            _scale_region(part, (profile['foot'],) * 3)
        elif name == 'neck':
            _scale_region(part, (profile['neck'], profile['neck'], 1.0))


def build_roster_equipment_pass2(kernel, slug, palette):
    """Second equipment pass, on the same bone contract as Batch A (skinned, not decorative)."""
    parts = []
    steel = kernel.make_material('fighter-steel', (0.60, 0.63, 0.68), 0.93, 0.28)
    gold = kernel.make_material('fighter-gold', (0.82, 0.64, 0.22), 0.92, 0.24)
    leather = kernel.make_material('fighter-leather', (0.16, 0.11, 0.08), 0.02, 0.78)
    hand = kernel.SHOULDER_X + 0.022

    if slug == 'superman':
        parts.append(kernel.shell('torso-hero-belt', [
            {'z': 0.930, 'rx': 0.166, 'ry': 0.118}, {'z': 0.958, 'rx': 0.170, 'ry': 0.121},
            {'z': 0.986, 'rx': 0.164, 'ry': 0.117}], gold, segments=26, thickness=0.010,
            uv_tiles=(2.0, 0.5)))
        parts.append(kernel.box('torso-hero-buckle', (0.054, 0.026, 0.046),
                                (0.0, -0.122, 0.958), gold))
        for side in (-1, 1):
            parts.append(kernel.torus('boot-cuff-%s' % ('L' if side < 0 else 'R'), 0.058, 0.010,
                                      (side * 0.104, 0.0, 0.120), gold))
    if slug == 'the_flash_barry_allen':
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.torus('head-ear-bolt-%s' % tag, 0.020, 0.006,
                                      (side * 0.082, 0.004, 1.612), gold,
                                      rotation=(0, math.radians(90), 0)))
            parts.append(kernel.box('head-ear-bolt-bar-%s' % tag, (0.010, 0.010, 0.036),
                                    (side * 0.086, 0.004, 1.622), gold))
        parts.append(kernel.loft('torso-flash-bolt', [
            {'x': 0.012, 'y': -0.128, 'z': 1.318, 'rx': 0.026, 'ry': 0.008},
            {'x': -0.004, 'y': -0.130, 'z': 1.286, 'rx': 0.020, 'ry': 0.008},
            {'x': -0.012, 'y': -0.128, 'z': 1.264, 'rx': 0.012, 'ry': 0.007}],
            palette['trim'], segments=8, uv_tiles=(1.0, 1.0)))
    if slug == 'levi_ackerman':
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.loft('torso-harness-%s' % tag, [
                {'x': side * 0.020, 'y': -0.126, 'z': 1.400, 'rx': 0.022, 'ry': 0.010},
                {'x': side * 0.070, 'y': -0.118, 'z': 1.300, 'rx': 0.020, 'ry': 0.010},
                {'x': side * 0.100, 'y': -0.100, 'z': 1.140, 'rx': 0.018, 'ry': 0.009},
                {'x': side * 0.112, 'y': -0.086, 'z': 0.980, 'rx': 0.016, 'ry': 0.008}],
                leather, segments=8, uv_tiles=(0.8, 2.0)))
            parts.append(kernel.torus('thigh-harness-%s' % tag, 0.082, 0.009,
                                      (side * 0.082, 0.0, 0.700), leather))
        parts.append(kernel.torus('torso-harness-belt', 0.168, 0.011, (0.0, 0.0, 0.946), leather,
                                  rotation=(math.radians(2), 0, 0)))
    if slug == 'edward_elric':
        base = kernel.SHOULDER_X
        parts.append(kernel.shell('forearm-automail-R', [
            {'x': base + 0.018, 'z': 1.020, 'rx': 0.050, 'ry': 0.051},
            {'x': base + 0.020, 'z': 0.970, 'rx': 0.049, 'ry': 0.050},
            {'x': base + 0.021, 'z': 0.930, 'rx': 0.044, 'ry': 0.045},
            {'x': base + 0.022, 'z': 0.900, 'rx': 0.038, 'ry': 0.039}],
            steel, segments=20, thickness=0.008, uv_tiles=(1.6, 1.4)))
        parts.append(kernel.box('palm-R-automail-plate', (0.070, 0.026, 0.052),
                                (base + 0.022, -0.020, 0.842), steel))
        parts.append(kernel.sphere('upperarm-automail-cap-R', 0.062,
                                   (base + 0.010, 0.0, 1.392), steel,
                                   scale=(1.0, 0.9, 0.7), segments=16, rings=8))
        for index in range(3):
            # The side token must be last: bone_for_part reads `-(L|R)$` to pick the forearm, and
            # `...rivet-0` resolved to NoneForeArm and failed the bind check.
            parts.append(kernel.torus('forearm-automail-rivet-R-%d' % index, 0.050, 0.004,
                                      (base + 0.020, 0.0, 0.998 - index * 0.032), gold))
    if slug == 'kratos':
        parts.append(kernel.loft('head-tattoo', [
            {'x': -0.052, 'y': kernel.head_front_y(-0.052, 1.606) - 0.003, 'z': 1.596,
             'rx': 0.012, 'ry': 0.006},
            {'x': -0.030, 'y': kernel.head_front_y(-0.030, 1.646) - 0.004, 'z': 1.640,
             'rx': 0.014, 'ry': 0.006},
            {'x': -0.024, 'y': kernel.head_front_y(-0.024, 1.690) - 0.004, 'z': 1.686,
             'rx': 0.012, 'ry': 0.006},
            {'x': -0.036, 'y': -0.030, 'z': 1.726, 'rx': 0.008, 'ry': 0.004}],
            palette['accent'], segments=8, uv_tiles=(0.8, 1.6)))
    if slug == 'lord_voldemort':
        parts.append(kernel.loft('palm-R-wand', [
            {'x': hand, 'y': -0.018, 'z': 0.860, 'rx': 0.007, 'ry': 0.007},
            {'x': hand, 'y': -0.018, 'z': 0.800, 'rx': 0.006, 'ry': 0.006},
            {'x': hand, 'y': -0.018, 'z': 0.740, 'rx': 0.004, 'ry': 0.004},
            {'x': hand, 'y': -0.018, 'z': 0.700, 'rx': 0.002, 'ry': 0.002}],
            leather, segments=8, uv_tiles=(0.6, 1.6)))
    if slug == 'master_chief':
        for side in (-1, 1):
            tag = 'L' if side < 0 else 'R'
            parts.append(kernel.shell('thigh-plate-%s' % tag, [
                {'x': side * 0.090, 'z': 0.820, 'rx': 0.078, 'ry': 0.086},
                {'x': side * 0.092, 'z': 0.740, 'rx': 0.076, 'ry': 0.084},
                {'x': side * 0.094, 'z': 0.660, 'rx': 0.066, 'ry': 0.074}],
                palette['trim'], segments=16, thickness=0.007, uv_tiles=(1.2, 1.0)))
            parts.append(kernel.shell('shin-plate-%s' % tag, [
                {'x': side * 0.098, 'z': 0.500, 'rx': 0.062, 'ry': 0.070},
                {'x': side * 0.100, 'z': 0.420, 'rx': 0.058, 'ry': 0.066},
                {'x': side * 0.102, 'z': 0.340, 'rx': 0.050, 'ry': 0.058}],
                palette['trim'], segments=16, thickness=0.007, uv_tiles=(1.2, 1.0)))
        parts.append(kernel.box('torso-armour-seam', (0.010, 0.020, 0.150),
                                (0.0, -0.130, 1.300), palette['gi_shade']))
    return parts
