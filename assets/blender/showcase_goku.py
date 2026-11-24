"""Showcase character build: a rigged, animated Goku produced entirely in Blender.

Run headless (wrapper resolves Blender and the extracted X libraries):
    bash scripts/showcase-goku.sh              # build + export + 8 inspection renders
    bash scripts/showcase-goku.sh --no-render   # build + export only

It writes:
    <out>/goku_showcase.glb            mesh + 40-bone armature + 7 named actions
    <out>/textures/*.png              base-colour maps packed into the GLB
    <out>/goku_front.png  goku_side.png  goku_back.png  goku_threequarter.png
    <out>/goku_face.png   goku_hand.png  goku_cloth.png
    <out>/goku_anim_<clip>.png        one inspection frame per animation

Honesty notes kept in the file on purpose:
  * The body is built procedurally from primitives, then joined and shaded: a deliberate,
    proportioned, textured character. It is stylised game art, not a photoreal sculpt.
  * Skinning is deterministic per-part vertex groups, not bone-heat automatic weights.
  * Animations are authored keyframe actions with anticipation and follow-through, not motion
    capture, and not hand-keyed animation from a professional animator.
  * Textures are generated procedurally (weave / pore / leather / strand patterns). The glTF path
    here exports base colour only: no normal or roughness maps survive the exporter.
"""
import bpy
import math
import os
import sys
from array import array
from mathutils import Vector

# ----------------------------------------------------------------------------- arguments
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.abspath('artifacts/blender-out')
TEX_DIR = os.path.join(OUT, 'textures')
os.makedirs(TEX_DIR, exist_ok=True)


def log(msg):
    print(f'[goku] {msg}', flush=True)


# ----------------------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 14
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x = 620
scene.render.resolution_y = 820
scene.render.film_transparent = False
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.06, 0.08, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6


# ----------------------------------------------------------------------------- textures
def hash_noise(x, y, salt=0.0):
    """Deterministic value noise in [0,1): reproducible builds, no RNG state."""
    n = math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
    return n - math.floor(n)


def make_texture(name, base, contrast=0.10, pattern='weave', size=256, accent=None):
    """Write a base-colour map and pack it so the GLB carries the texture, not a path."""
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = array('f', [0.0]) * (size * size * 4)
    r0, g0, b0 = base
    ar, ag, ab = accent if accent else base
    for y in range(size):
        for x in range(size):
            if pattern == 'weave':
                warp = math.sin(x * 0.55) * 0.5 + 0.5
                weft = math.sin(y * 0.55) * 0.5 + 0.5
                f = 1.0 + (warp * weft - 0.5) * contrast * 2
                f *= 1.0 + (hash_noise(x * 0.7, y * 0.7, 1.3) - 0.5) * contrast
            elif pattern == 'pore':
                f = 1.0 + (hash_noise(x * 2.1, y * 2.1, 4.7) - 0.5) * contrast * 2
                f *= 1.0 - 0.05 * (1.0 - math.sin(x * 0.09 + y * 0.11) * 0.5 - 0.5)
            elif pattern == 'leather':
                f = 1.0 + (hash_noise(x * 1.4, y * 1.4, 9.1) - 0.5) * contrast * 2
                f *= 1.0 + (math.sin((x + y) * 0.16) * 0.5 + 0.5 - 0.5) * contrast
            elif pattern == 'strand':
                f = 1.0 + (math.sin(x * 1.7) * 0.5 + 0.5 - 0.5) * contrast * 2.2
                f *= 1.0 + (hash_noise(x * 0.9, y * 1.9, 3.3) - 0.5) * contrast
            else:
                f = 1.0
            # A faint large-scale gradient keeps a flat colour from reading as untextured plastic.
            band = 1.0 + 0.04 * math.sin((y / size) * math.pi * 2.0)
            i = (y * size + x) * 4
            px[i] = max(0.0, min(1.0, r0 * f * band))
            px[i + 1] = max(0.0, min(1.0, g0 * f * band))
            px[i + 2] = max(0.0, min(1.0, b0 * f * band))
            px[i + 3] = 1.0
    img.pixels.foreach_set(px)
    path = os.path.join(TEX_DIR, f'{name.lower().replace(" ", "_")}.png')
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    log(f'texture {os.path.basename(path)} {size}x{size}')
    return img


def material(name, color, roughness=0.55, metallic=0.0, subsurface=0.0, texture=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    if subsurface:
        bsdf.inputs['Subsurface Weight'].default_value = subsurface
        bsdf.inputs['Subsurface Radius'].default_value = (0.4, 0.2, 0.1)
    if texture is not None:
        tex = nodes.new('ShaderNodeTexImage')
        tex.image = texture
        tex.location = (-420, 260)
        mat.node_tree.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


TEX_CLOTH = make_texture('Goku Gi Weave', (0.62, 0.19, 0.03), contrast=0.16, pattern='weave')
TEX_BLUE = make_texture('Goku Blue Weave', (0.07, 0.15, 0.38), contrast=0.14, pattern='weave')
TEX_SKIN = make_texture('Goku Skin Pores', (0.66, 0.45, 0.33), contrast=0.10, pattern='pore')
TEX_HAIR = make_texture('Goku Hair Strands', (0.030, 0.028, 0.034), contrast=0.30, pattern='strand')
TEX_BOOT = make_texture('Goku Boot Leather', (0.115, 0.115, 0.145), contrast=0.18, pattern='leather')

SKIN = material('Goku Skin', (0.66, 0.45, 0.33), 0.60, 0.0, 0.10, TEX_SKIN)
GI = material('Goku Gi Orange', (0.62, 0.19, 0.03), 0.74, texture=TEX_CLOTH)
GI_BLUE = material('Goku Gi Blue', (0.07, 0.15, 0.38), 0.70, texture=TEX_BLUE)
BOOT = material('Goku Boots', (0.115, 0.115, 0.145), 0.42, texture=TEX_BOOT)
BELT = material('Goku Belt', (0.05, 0.09, 0.24), 0.52, texture=TEX_BLUE)
HAIR = material('Goku Hair', (0.030, 0.028, 0.034), 0.74, texture=TEX_HAIR)
EYE = material('Goku Eye', (0.94, 0.94, 0.96), 0.22)
IRIS = material('Goku Iris', (0.07, 0.05, 0.05), 0.24)
PUPIL = material('Goku Pupil', (0.02, 0.02, 0.02), 0.20)
MOUTH = material('Goku Mouth', (0.36, 0.15, 0.13), 0.58)
WEEN = material('Goku Gi Under', (0.10, 0.20, 0.46), 0.66, texture=TEX_BLUE)

PARTS = []

# Automatic (bone-heat) weights fail across the disconnected primitive islands this character is
# assembled from, which threw the legs, boots and hands off the body entirely. Each part is instead
# bound deterministically to the bone that owns it, either explicitly (`bone=`) or by name pattern.
def bone_for(name):
    n = name.lower()
    if n.startswith(('head', 'hair', 'eye', 'iris', 'pupil', 'brow', 'mouth', 'jaw', 'nose', 'ear', 'lid')):
        return 'head'
    if n.startswith('neck'):
        return 'neck'
    if n.startswith(('torso', 'belt', 'gi_', 'knot', 'sash', 'undershirt', 'lapel')):
        return 'spine'
    if n.startswith('chest'):
        return 'chest'
    for tag in ('l', 'r'):
        t = tag.upper()
        if n.endswith('.' + tag) or n.endswith('_' + tag):
            if n.startswith(('upperarm', 'shoulder')):
                return 'upperarm.' + t
            if n.startswith(('forearm', 'elbow', 'wrist')):
                return 'forearm.' + t
            if n.startswith('hand'):
                return 'hand.' + t
            if n.startswith('thigh'):
                return 'thigh.' + t
            if n.startswith(('shin', 'knee')):
                return 'shin.' + t
            if n.startswith(('boot', 'foot', 'sole', 'toe', 'cuff')):
                return 'foot.' + t
    return 'spine'


def add(kind, name, size, loc, rot=(0, 0, 0), mat=None, segments=20, bone=None):
    if kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=max(6, segments // 2), radius=1, location=loc)
    elif kind == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    elif kind == 'cyl':
        bpy.ops.mesh.primitive_cylinder_add(vertices=segments, radius=1, depth=1, location=loc)
    elif kind == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=segments, radius1=1, radius2=0, depth=1, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.rotation_euler = rot
    if mat:
        obj.data.materials.append(mat)
    obj['bind_bone'] = bone or bone_for(name)
    PARTS.append(obj)
    return obj


# ----------------------------------------------------------------------------- torso and gi
# ~7.4 heads tall, feet at z=0. Proportions are the anime martial artist, not a default mannequin.
add('sphere', 'hips', (0.175, 0.135, 0.135), (0, 0, 0.955), mat=GI)
add('sphere', 'torso', (0.185, 0.125, 0.215), (0, 0, 1.135), mat=GI)
add('sphere', 'chest', (0.205, 0.135, 0.150), (0, 0.005, 1.315), mat=GI)
add('cube', 'gi_skirt_front', (0.30, 0.075, 0.20), (0, 0.075, 0.905), mat=GI)
add('cube', 'gi_skirt_back', (0.30, 0.070, 0.185), (0, -0.080, 0.915), mat=GI)
for side, tag in ((-1, 'L'), (1, 'R')):
    add('cube', 'gi_skirt_side_' + tag, (0.055, 0.145, 0.175), (side * 0.155, 0, 0.915), mat=GI)
# Layered lapels crossing the chest: the gi's defining V, not a flat box.
# Lapels and undershirt are thin panels sunk into the chest surface: thick boxes at this scale read
# as blocks glued onto the torso rather than cloth.
add('cube', 'lapel_L', (0.050, 0.014, 0.225), (-0.055, 0.128, 1.285), rot=(0, 0, 0.34), mat=GI)
add('cube', 'lapel_R', (0.050, 0.014, 0.225), (0.055, 0.128, 1.285), rot=(0, 0, -0.34), mat=GI)
# Blue undershirt visible inside the V.
add('cube', 'undershirt_v', (0.075, 0.012, 0.150), (0, 0.130, 1.315), rot=(0, 0, 0.78), mat=WEEN)
add('cube', 'undershirt_band', (0.115, 0.014, 0.028), (0, 0.128, 1.392), mat=WEEN)
# Collar rolling around the neck.
add('cyl', 'gi_collar', (0.086, 0.076, 0.030), (0, 0.005, 1.442), mat=WEEN, segments=24)
# Belt, knot and hanging tails.
# A cube's `scale` is its FULL extent (primitive_cube_add(size=1) spans 1 unit), so these are real
# centimetres: the first pass sized the belt as 18 cm across a 37 cm waist.
add('cube', 'belt', (0.340, 0.262, 0.072), (0, 0, 1.008), mat=BELT)
add('cube', 'knot', (0.100, 0.062, 0.086), (0, 0.142, 1.002), mat=BELT)
for side, tag in ((-1, 'L'), (1, 'R')):
    add('cube', 'sash_' + tag, (0.055, 0.030, 0.165), (side * 0.048, 0.142, 0.910), rot=(0.12, 0, side * 0.10), mat=BELT)
# Cloth detail comes from the weave texture and the garment seams (collar, sleeve hems, belt).
# The first pass stood six cylinder "folds" proud of the torso, which rendered as blocks glued to
# the gi: pant folds need sculpted, conforming geometry, so they are deliberately not faked here.

# ----------------------------------------------------------------------------- head
# Every facial feature must sit PROUD of the skull surface or it is simply invisible: the first
# pass buried the eyes, brows, nose and mouth inside the head sphere and rendered a blank face.
# The skull is 0.104 deep in +Y from its centre at y=0.002, so the surface is at y = 0.106.
add('cyl', 'neck', (0.052, 0.050, 0.145), (0, 0.004, 1.492), mat=SKIN, segments=20)
add('sphere', 'head', (0.102, 0.104, 0.120), (0, 0.002, 1.650), mat=SKIN, segments=28)
add('sphere', 'jaw', (0.079, 0.090, 0.068), (0, 0.018, 1.578), mat=SKIN)
add('sphere', 'cheek_L', (0.030, 0.028, 0.030), (-0.060, 0.088, 1.622), mat=SKIN, segments=16)
add('sphere', 'cheek_R', (0.030, 0.028, 0.030), (0.060, 0.088, 1.622), mat=SKIN, segments=16)
add('cone', 'nose', (0.017, 0.020, 0.034), (0, 0.112, 1.632), rot=(1.18, 0, 0), mat=SKIN, segments=12)
add('cube', 'brow_ridge', (0.096, 0.024, 0.014), (0, 0.100, 1.682), rot=(-0.20, 0, 0), mat=SKIN)
for side, tag in ((-1, 'L'), (1, 'R')):
    add('sphere', 'ear_' + tag, (0.018, 0.030, 0.040), (side * 0.101, 0.000, 1.645), rot=(0, 0, side * 0.2), mat=SKIN, segments=16)
    # Eye: sclera, iris and pupil as separate masses that break the skull surface at y=0.106.
    # Sclera sized down and the iris enlarged: doll-sized eyeballs were the biggest face defect.
    add('sphere', 'eye_' + tag, (0.022, 0.017, 0.019), (side * 0.043, 0.101, 1.662), mat=EYE, segments=20)
    add('sphere', 'iris_' + tag, (0.0125, 0.011, 0.0125), (side * 0.045, 0.112, 1.661), mat=IRIS, segments=16)
    add('sphere', 'pupil_' + tag, (0.0058, 0.0058, 0.0058), (side * 0.046, 0.117, 1.661), mat=PUPIL, segments=12)
    add('cube', 'lid_' + tag, (0.046, 0.018, 0.010), (side * 0.043, 0.104, 1.678), rot=(0.18, 0, side * -0.12), mat=SKIN)
    # Angled brow: the expression cue that makes the face recognisable at gameplay distance.
    add('cube', 'brow_' + tag, (0.048, 0.014, 0.009), (side * 0.044, 0.112, 1.692), rot=(0, 0, side * -0.30), mat=HAIR)
    add('sphere', 'cheekbone_' + tag, (0.024, 0.018, 0.016), (side * 0.060, 0.094, 1.604), mat=SKIN, segments=12)
add('cube', 'mouth', (0.032, 0.014, 0.008), (0, 0.106, 1.578), rot=(0, 0, 0), mat=MOUTH)
add('cube', 'lip_lower', (0.030, 0.012, 0.009), (0, 0.104, 1.567), mat=SKIN)
add('sphere', 'chin', (0.032, 0.028, 0.022), (0, 0.092, 1.548), mat=SKIN, segments=14)

# Hair: a cap plus sculpted masses and distinct spikes. The cap is lifted and pulled back so the
# brow, eyes and fringe stay visible from the front; the first pass dropped it over the whole face.
add('sphere', 'hair_cap', (0.108, 0.110, 0.092), (0, -0.016, 1.732), mat=HAIR, segments=24)
add('sphere', 'hair_back', (0.098, 0.086, 0.076), (0, -0.070, 1.652), mat=HAIR, segments=20)
# Fringe: flattened locks falling over the forehead, deliberately uneven.
FRINGE = [
    ((0.026, 0.020, 0.060), (-0.054, 0.098, 1.744), (0.60, 0, 0.30)),
    ((0.024, 0.018, 0.052), (-0.016, 0.108, 1.752), (0.66, 0, 0.10)),
    ((0.024, 0.018, 0.054), (0.024, 0.104, 1.748), (0.64, 0, -0.14)),
    ((0.022, 0.017, 0.048), (0.058, 0.094, 1.738), (0.62, 0, -0.32)),
]
for i, (size, loc, rot) in enumerate(FRINGE):
    add('cone', 'hair_fringe_%d' % i, size, loc, rot, mat=HAIR, segments=10)
# Crown spikes: long, varied, swept back and out. These carry the silhouette.
# Fewer, larger, back-swept masses. Ten thin cones read as a mohawk; Goku's hair is a heavy
# silhouette of broad locks, so the width matters more than the count.
SPIKES = [
    ((0.058, 0.054, 0.175), (0.000, -0.075, 1.842), (-0.95, 0, 0.00)),
    ((0.052, 0.048, 0.152), (-0.076, -0.062, 1.818), (-0.95, 0, 0.38)),
    ((0.052, 0.048, 0.152), (0.076, -0.062, 1.816), (-0.95, 0, -0.38)),
    ((0.046, 0.043, 0.136), (-0.112, -0.030, 1.758), (-0.80, 0, 0.78)),
    ((0.046, 0.043, 0.136), (0.112, -0.030, 1.756), (-0.80, 0, -0.78)),
    ((0.044, 0.042, 0.124), (0.000, -0.138, 1.762), (-1.38, 0, 0.00)),
    ((0.040, 0.038, 0.108), (-0.052, -0.126, 1.700), (-1.52, 0, 0.26)),
    ((0.040, 0.038, 0.108), (0.052, -0.126, 1.698), (-1.52, 0, -0.26)),
]
for i, (size, loc, rot) in enumerate(SPIKES):
    add('cone', 'hair_spike_%d' % i, size, loc, rot, mat=HAIR, segments=10)
for side, tag in ((-1, 'L'), (1, 'R')):
    add('cube', 'hair_sideburn_' + tag, (0.014, 0.026, 0.052), (side * 0.100, 0.030, 1.660), mat=HAIR)


# ----------------------------------------------------------------------------- hands
def build_hand(side, tag):
    """Palm, four fingers with knuckles, and an opposed thumb: 20 finger bones in total."""
    x = side * 0.228
    add('cube', 'hand_palm_' + tag, (0.066, 0.092, 0.042), (x, 0.020, 0.700), mat=SKIN, bone='hand.' + tag)
    add('sphere', 'hand_knuckles_' + tag, (0.034, 0.024, 0.016), (x, 0.052, 0.680), mat=SKIN, segments=14, bone='hand.' + tag)
    for i in range(4):
        off = (i - 1.5) * 0.0158
        fx = x + off
        base_z = 0.662
        # Three phalanges per finger, each slightly thinner and angled a little further forward.
        lengths = (0.026, 0.021, 0.017)
        radii = (0.0090, 0.0080, 0.0070)
        z = base_z
        for seg in range(3):
            mid = z - lengths[seg] * 0.5
            add('cyl', f'finger_{i}_{seg}_{tag}', (radii[seg], radii[seg], lengths[seg]), (fx, 0.050 + seg * 0.004, mid),
                rot=(0.10 + seg * 0.08, 0, 0), mat=SKIN, segments=10,
                bone=('f%d.%s' % (i, tag)) if seg < 2 else ('f%d_tip.%s' % (i, tag)))
            add('sphere', f'finger_{i}_joint_{seg}_{tag}', (radii[seg] * 1.02, radii[seg] * 1.02, radii[seg] * 1.02),
                (fx, 0.050 + seg * 0.004, z), mat=SKIN, segments=10,
                bone=('f%d.%s' % (i, tag)) if seg < 2 else ('f%d_tip.%s' % (i, tag)))
            z -= lengths[seg]
    # Thumb: rotated out of the palm plane so the hand reads as a hand from every angle.
    tx = x - side * 0.020
    add('cyl', 'thumb_0_' + tag, (0.0095, 0.0095, 0.026), (tx, 0.028, 0.678), rot=(0.35, 0, side * 0.55), mat=SKIN,
        segments=10, bone='thumb.' + tag)
    add('cyl', 'thumb_1_' + tag, (0.0082, 0.0082, 0.022), (tx - side * 0.010, 0.038, 0.660), rot=(0.55, 0, side * 0.70),
        mat=SKIN, segments=10, bone='thumb_tip.' + tag)
    add('sphere', 'thumb_joint_' + tag, (0.0090, 0.0090, 0.0090), (tx - side * 0.004, 0.032, 0.668), mat=SKIN,
        segments=10, bone='thumb.' + tag)


# ----------------------------------------------------------------------------- arms
for side, tag in ((-1, 'L'), (1, 'R')):
    add('sphere', 'shoulder_' + tag, (0.082, 0.078, 0.076), (side * 0.202, 0, 1.372), mat=GI)
    add('cyl', 'upperarm_' + tag, (0.055, 0.055, 0.300), (side * 0.228, 0, 1.165), mat=SKIN, segments=20)
    add('sphere', 'elbow_' + tag, (0.050, 0.050, 0.048), (side * 0.228, 0.004, 1.012), mat=SKIN, segments=16)
    add('cyl', 'forearm_' + tag, (0.048, 0.048, 0.270), (side * 0.228, 0.006, 0.878), mat=SKIN, segments=20)
    add('cyl', 'wrist_' + tag, (0.052, 0.052, 0.062), (side * 0.228, 0.010, 0.740), mat=GI_BLUE, segments=20)
    add('cyl', 'wrist_rim_' + tag, (0.054, 0.054, 0.012), (side * 0.228, 0.010, 0.772), mat=GI_BLUE, segments=20)
    # Short gi sleeve over the top of the arm: without it the shoulder reads as a bare ball.
    add('cyl', 'gi_sleeve_' + tag, (0.072, 0.070, 0.150), (side * 0.228, 0, 1.252), mat=GI, segments=20)
    add('cyl', 'sleeve_hem_' + tag, (0.074, 0.072, 0.020), (side * 0.228, 0, 1.182), mat=GI, segments=20)
    build_hand(side, tag)

# ----------------------------------------------------------------------------- legs and boots
for side, tag in ((-1, 'L'), (1, 'R')):
    # A cylinder's `depth` is its FULL height while a sphere's `scale` is its radius, so the limb
    # lengths here are doubled relative to the naive reading — that mismatch was the 10 cm gap
    # between thigh and shin, and between shin and boot.
    add('cyl', 'thigh_' + tag, (0.077, 0.077, 0.380), (side * 0.098, 0, 0.690), mat=GI, segments=20)
    add('sphere', 'knee_' + tag, (0.062, 0.062, 0.058), (side * 0.098, 0.004, 0.505), mat=GI, segments=16)
    add('cyl', 'shin_' + tag, (0.056, 0.056, 0.330), (side * 0.098, 0, 0.345), mat=GI, segments=20)
    # Boot: tapered shaft, folded cuff, sole and a shaped toe, layered rather than one cylinder.
    add('cyl', 'boot_' + tag, (0.060, 0.062, 0.205), (side * 0.098, 0.010, 0.150), mat=BOOT, segments=20)
    add('cyl', 'cuff_' + tag, (0.068, 0.070, 0.040), (side * 0.098, 0.008, 0.242), mat=BOOT, segments=20)
    add('cube', 'boot_strap_' + tag, (0.128, 0.130, 0.024), (side * 0.098, 0.012, 0.200), mat=BOOT)
    add('cube', 'foot_' + tag, (0.112, 0.210, 0.070), (side * 0.098, 0.030, 0.040), mat=BOOT)
    add('sphere', 'toe_' + tag, (0.054, 0.060, 0.036), (side * 0.098, 0.118, 0.042), mat=BOOT, segments=16)
    add('cube', 'sole_' + tag, (0.118, 0.222, 0.020), (side * 0.098, 0.032, 0.012), mat=BOOT)

log(f'built {len(PARTS)} parts')
log(f'materials: {len(bpy.data.materials)}')

# ----------------------------------------------------------------------------- join + smooth
# Apply every part's transform BEFORE joining. Without this the joined mesh inherits the first
# part's non-uniform scale, and a non-uniform object scale on a skinned mesh shears the skinning.
for obj in PARTS:
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Bind every part to its owning bone BEFORE joining, so the join cannot scramble the assignment.
for obj in PARTS:
    group = obj.vertex_groups.new(name=obj['bind_bone'])
    group.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')

for obj in PARTS:
    obj.select_set(True)
bpy.context.view_layer.objects.active = PARTS[0]
bpy.ops.object.join()
body = bpy.context.object
body.name = 'Goku_Body'

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.0015)
bpy.ops.object.mode_set(mode='OBJECT')
# SIMPLE, not Catmull-Clark: a subsurf on isolated primitive islands shrinks each island toward
# its own centre, which pulled the boots into blobs and opened gaps between limbs.
sub = body.modifiers.new('Subdivision', 'SUBSURF')
sub.subdivision_type = 'SIMPLE'
sub.levels = 1
sub.render_levels = 1
bpy.context.view_layer.objects.active = body
bpy.ops.object.shade_smooth()
bpy.ops.object.modifier_apply(modifier='Subdivision')

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.015)
bpy.ops.object.mode_set(mode='OBJECT')

# ----------------------------------------------------------------------------- armature
bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.object
rig.name = 'Goku_Rig'
arm_data = rig.data
arm_data.name = 'Goku_Skeleton'
eb = arm_data.edit_bones
for b in list(eb):
    eb.remove(b)

BONES = [
    ('root', (0, 0, 0.0), (0, 0, 0.12), None),
    ('hips', (0, 0, 0.96), (0, 0, 1.08), 'root'),
    ('spine', (0, 0, 1.08), (0, 0, 1.24), 'hips'),
    ('chest', (0, 0, 1.24), (0, 0, 1.42), 'spine'),
    ('neck', (0, 0, 1.42), (0, 0, 1.52), 'chest'),
    ('head', (0, 0, 1.52), (0, 0, 1.78), 'neck'),
]
for side, tag in ((-1, 'L'), (1, 'R')):
    BONES += [
        ('clavicle.' + tag, (0, 0, 1.36), (side * 0.20, 0, 1.372), 'chest'),
        ('upperarm.' + tag, (side * 0.20, 0, 1.372), (side * 0.228, 0, 1.012), 'clavicle.' + tag),
        ('forearm.' + tag, (side * 0.228, 0, 1.012), (side * 0.228, 0.010, 0.740), 'upperarm.' + tag),
        ('hand.' + tag, (side * 0.228, 0.010, 0.740), (side * 0.228, 0.030, 0.664), 'forearm.' + tag),
        ('thigh.' + tag, (side * 0.098, 0, 0.96), (side * 0.098, 0, 0.505), 'hips'),
        ('shin.' + tag, (side * 0.098, 0, 0.505), (side * 0.098, 0, 0.150), 'thigh.' + tag),
        ('foot.' + tag, (side * 0.098, 0, 0.150), (side * 0.098, 0.130, 0.030), 'shin.' + tag),
    ]
    # Fingers: two bones per finger plus two for the thumb.
    for i in range(4):
        fx = side * 0.228 + (i - 1.5) * 0.0122
        BONES += [
            (f'f{i}.{tag}', (fx, 0.050, 0.664), (fx, 0.056, 0.620), 'hand.' + tag),
            (f'f{i}_tip.{tag}', (fx, 0.056, 0.620), (fx, 0.066, 0.586), f'f{i}.{tag}'),
        ]
    tx = side * 0.228 - side * 0.020
    BONES += [
        ('thumb.' + tag, (tx, 0.028, 0.680), (tx - side * 0.008, 0.036, 0.664), 'hand.' + tag),
        ('thumb_tip.' + tag, (tx - side * 0.008, 0.036, 0.664), (tx - side * 0.016, 0.044, 0.648), 'thumb.' + tag),
    ]
for name, head, tail, parent in BONES:
    bone = eb.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = eb[parent]
        bone.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
log(f'rig has {len(BONES)} bones')

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
log('skin weights bound from per-part groups')

# Weight audit: an unbound part is silently left in rest space while its parent bone moves, which
# detaches it exactly like the renders showed. This reports it instead of guessing.
BONE_NAMES = {b.name for b in rig.data.bones}
GROUPS = {vg.index: vg.name for vg in body.vertex_groups}
counts = {name: 0 for name in GROUPS.values()}
unweighted = 0
for v in body.data.vertices:
    if not v.groups:
        unweighted += 1
        continue
    for g in v.groups:
        counts[GROUPS.get(g.group, '?')] = counts.get(GROUPS.get(g.group, '?'), 0) + 1
log(f'vertices={len(body.data.vertices)} unweighted={unweighted}')
log(f'groups={len(GROUPS)} unmatched={sorted(set(GROUPS.values()) - BONE_NAMES)}')
empty = sorted(name for name, n in counts.items() if n == 0)
log(f'groups with no vertices: {empty}')

# ----------------------------------------------------------------------------- animation
scene.frame_start = 1
scene.frame_end = 90
action_names = []


def key_pose(frame, pose):
    """Pose is {bone: (rx, ry, rz)} in radians, plus optional 'root_loc'."""
    for bone_name, rot in pose.items():
        if bone_name == 'root_loc':
            continue
        pb = rig.pose.bones.get(bone_name)
        if not pb:
            continue
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = rot
        pb.keyframe_insert('rotation_euler', frame=frame)
    pb_root = rig.pose.bones.get('root')
    if pb_root is not None:
        pb_root.location = pose.get('root_loc', (0, 0, 0))
        pb_root.keyframe_insert('location', frame=frame)


def make_action(name, frames):
    action = bpy.data.actions.new(name)
    rig.animation_data_create()
    rig.animation_data.action = action
    for frame, pose in frames:
        key_pose(frame, pose)
    for fcurve in action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = 'AUTO_CLAMPED'
            point.handle_right_type = 'AUTO_CLAMPED'
    action.use_fake_user = True
    action_names.append(name)
    return action


def fist(tag, amount=1.15):
    """Curl the fingers of one hand. Fists read in the punch and the Kamehameha charge."""
    out = {}
    for i in range(4):
        out[f'f{i}.{tag}'] = (amount, 0, 0)
        out[f'f{i}_tip.{tag}'] = (amount * 0.9, 0, 0)
    out['thumb.' + tag] = (0.5, 0, 0)
    out['thumb_tip.' + tag] = (0.5, 0, 0)
    return out


def palm(tag, spread=0.15):
    out = {}
    for i in range(4):
        out[f'f{i}.{tag}'] = (-spread, 0, 0)
        out[f'f{i}_tip.{tag}'] = (-spread * 0.6, 0, 0)
    out['thumb.' + tag] = (-0.2, 0, 0)
    out['thumb_tip.' + tag] = (-0.2, 0, 0)
    return out


def merge(*dicts):
    out = {}
    for d in dicts:
        out.update(d)
    return out


# Idle: breathing, a slow weight shift and a head turn, not a static stance held for 40 frames.
IDLE = [
    (1, merge({'spine': (0.02, 0, 0), 'chest': (-0.03, 0, 0), 'head': (0, 0.05, 0),
               'upperarm.L': (0.06, 0, -0.16), 'upperarm.R': (0.06, 0, 0.16),
               'forearm.L': (0.22, 0, 0), 'forearm.R': (0.22, 0, 0),
               'thigh.L': (0.02, 0, 0), 'thigh.R': (0.02, 0, 0)}, fist('L', 0.55), fist('R', 0.55))),
    (24, merge({'spine': (0.06, 0, 0.02), 'chest': (-0.07, 0, -0.02), 'head': (0, -0.04, 0.03),
                'upperarm.L': (0.10, 0, -0.26), 'upperarm.R': (0.08, 0, 0.24),
                'forearm.L': (0.30, 0, 0), 'forearm.R': (0.26, 0, 0),
                'hips': (0, 0, 0.03), 'thigh.L': (0.04, 0, 0), 'thigh.R': (0.01, 0, 0)}, fist('L', 0.6), fist('R', 0.6))),
    (48, merge({'spine': (0.03, 0, -0.02), 'chest': (-0.03, 0, 0.02), 'head': (0, 0.06, -0.02),
                'upperarm.L': (0.05, 0, -0.14), 'upperarm.R': (0.07, 0, 0.18),
                'forearm.L': (0.20, 0, 0), 'forearm.R': (0.24, 0, 0),
                'hips': (0, 0, -0.02), 'thigh.L': (0.01, 0, 0), 'thigh.R': (0.03, 0, 0)}, fist('L', 0.5), fist('R', 0.5))),
    (72, merge({'spine': (0.02, 0, 0), 'chest': (-0.03, 0, 0), 'head': (0, 0.05, 0),
                'upperarm.L': (0.06, 0, -0.16), 'upperarm.R': (0.06, 0, 0.16),
                'forearm.L': (0.22, 0, 0), 'forearm.R': (0.22, 0, 0),
                'thigh.L': (0.02, 0, 0), 'thigh.R': (0.02, 0, 0)}, fist('L', 0.55), fist('R', 0.55))),
]

# Walk: contact, down, passing and up poses with counter-rotating shoulders and a pelvis bob.
WALK = [
    (1, merge({'thigh.L': (0.52, 0, 0), 'shin.L': (-0.16, 0, 0), 'foot.L': (-0.10, 0, 0),
               'thigh.R': (-0.46, 0, 0), 'shin.R': (0.30, 0, 0), 'foot.R': (0.18, 0, 0),
               'upperarm.L': (-0.42, 0, -0.10), 'upperarm.R': (0.42, 0, 0.10),
               'forearm.L': (0.30, 0, 0), 'forearm.R': (0.42, 0, 0),
               'spine': (0.06, 0, -0.06), 'chest': (0, 0, 0.10), 'hips': (0, 0, 0.07)}, fist('L', 0.7), fist('R', 0.7))),
    (8, merge({'thigh.L': (0.26, 0, 0), 'shin.L': (-0.30, 0, 0), 'foot.L': (0.06, 0, 0),
               'thigh.R': (-0.20, 0, 0), 'shin.R': (0.46, 0, 0), 'foot.R': (-0.14, 0, 0),
               'upperarm.L': (-0.20, 0, -0.12), 'upperarm.R': (0.22, 0, 0.12),
               'spine': (0.08, 0, -0.02), 'hips': (0, 0, 0.02), 'root_loc': (0, 0, -0.028)}, fist('L', 0.7), fist('R', 0.7))),
    (16, merge({'thigh.L': (-0.46, 0, 0), 'shin.L': (0.30, 0, 0), 'foot.L': (0.18, 0, 0),
                'thigh.R': (0.52, 0, 0), 'shin.R': (-0.16, 0, 0), 'foot.R': (-0.10, 0, 0),
                'upperarm.L': (0.42, 0, -0.10), 'upperarm.R': (-0.42, 0, 0.10),
                'forearm.L': (0.42, 0, 0), 'forearm.R': (0.30, 0, 0),
                'spine': (0.06, 0, 0.06), 'chest': (0, 0, -0.10), 'hips': (0, 0, -0.07)}, fist('L', 0.7), fist('R', 0.7))),
    (24, merge({'thigh.L': (-0.20, 0, 0), 'shin.L': (0.46, 0, 0), 'foot.L': (-0.14, 0, 0),
                'thigh.R': (0.26, 0, 0), 'shin.R': (-0.30, 0, 0), 'foot.R': (0.06, 0, 0),
                'upperarm.L': (0.22, 0, -0.12), 'upperarm.R': (-0.20, 0, 0.12),
                'spine': (0.08, 0, 0.02), 'hips': (0, 0, -0.02), 'root_loc': (0, 0, -0.028)}, fist('L', 0.7), fist('R', 0.7))),
    (32, merge({'thigh.L': (0.52, 0, 0), 'shin.L': (-0.16, 0, 0), 'foot.L': (-0.10, 0, 0),
                'thigh.R': (-0.46, 0, 0), 'shin.R': (0.30, 0, 0), 'foot.R': (0.18, 0, 0),
                'upperarm.L': (-0.42, 0, -0.10), 'upperarm.R': (0.42, 0, 0.10),
                'forearm.L': (0.30, 0, 0), 'forearm.R': (0.42, 0, 0),
                'spine': (0.06, 0, -0.06), 'chest': (0, 0, 0.10), 'hips': (0, 0, 0.07)}, fist('L', 0.7), fist('R', 0.7))),
]

# Run: forward lean, long stride, arms driving across the body, airborne beats.
RUN = [
    (1, merge({'thigh.L': (1.00, 0, 0.04), 'shin.L': (-1.05, 0, 0), 'foot.L': (-0.15, 0, 0),
               'thigh.R': (-0.72, 0, -0.04), 'shin.R': (0.85, 0, 0), 'foot.R': (0.26, 0, 0),
               'upperarm.L': (-0.95, 0, -0.20), 'upperarm.R': (0.90, 0, 0.18),
               'forearm.L': (1.35, 0, 0), 'forearm.R': (1.30, 0, 0),
               'spine': (0.30, 0, -0.12), 'chest': (0.06, 0, 0.16), 'head': (-0.12, 0, 0),
               'root_loc': (0, 0, 0.010)}, fist('L', 0.9), fist('R', 0.9))),
    (12, merge({'thigh.L': (-0.10, 0, 0.04), 'shin.L': (-0.35, 0, 0), 'foot.L': (0.10, 0, 0),
                'thigh.R': (0.30, 0, -0.04), 'shin.R': (0.20, 0, 0), 'foot.R': (-0.10, 0, 0),
                'upperarm.L': (-0.30, 0, -0.22), 'upperarm.R': (0.28, 0, 0.20),
                'forearm.L': (1.10, 0, 0), 'forearm.R': (1.15, 0, 0),
                'spine': (0.34, 0, 0), 'head': (-0.14, 0, 0), 'root_loc': (0, 0, 0.045)}, fist('L', 0.9), fist('R', 0.9))),
    (20, merge({'thigh.L': (-0.72, 0, 0.04), 'shin.L': (0.85, 0, 0), 'foot.L': (0.26, 0, 0),
                'thigh.R': (1.00, 0, -0.04), 'shin.R': (-1.05, 0, 0), 'foot.R': (-0.15, 0, 0),
                'upperarm.L': (0.90, 0, -0.18), 'upperarm.R': (-0.95, 0, 0.20),
                'forearm.L': (1.30, 0, 0), 'forearm.R': (1.35, 0, 0),
                'spine': (0.30, 0, 0.12), 'chest': (0.06, 0, -0.16), 'head': (-0.12, 0, 0),
                'root_loc': (0, 0, 0.010)}, fist('L', 0.9), fist('R', 0.9))),
    (32, merge({'thigh.L': (0.30, 0, 0.04), 'shin.L': (0.20, 0, 0), 'foot.L': (-0.10, 0, 0),
                'thigh.R': (-0.10, 0, -0.04), 'shin.R': (-0.35, 0, 0), 'foot.R': (0.10, 0, 0),
                'upperarm.L': (0.28, 0, -0.20), 'upperarm.R': (-0.30, 0, 0.22),
                'forearm.L': (1.15, 0, 0), 'forearm.R': (1.10, 0, 0),
                'spine': (0.34, 0, 0), 'head': (-0.14, 0, 0), 'root_loc': (0, 0, 0.045)}, fist('L', 0.9), fist('R', 0.9))),
    (40, merge({'thigh.L': (1.00, 0, 0.04), 'shin.L': (-1.05, 0, 0), 'foot.L': (-0.15, 0, 0),
                'thigh.R': (-0.72, 0, -0.04), 'shin.R': (0.85, 0, 0), 'foot.R': (0.26, 0, 0),
                'upperarm.L': (-0.95, 0, -0.20), 'upperarm.R': (0.90, 0, 0.18),
                'forearm.L': (1.35, 0, 0), 'forearm.R': (1.30, 0, 0),
                'spine': (0.30, 0, -0.12), 'chest': (0.06, 0, 0.16), 'head': (-0.12, 0, 0),
                'root_loc': (0, 0, 0.010)}, fist('L', 0.9), fist('R', 0.9))),
]

# Jump: crouch anticipation, explosive extension, tuck, reach for the ground, absorb the landing.
JUMP = [
    (1, merge({'thigh.L': (0.30, 0, 0), 'thigh.R': (0.30, 0, 0), 'shin.L': (-0.34, 0, 0), 'shin.R': (-0.34, 0, 0),
               'upperarm.L': (0.20, 0, -0.18), 'upperarm.R': (0.20, 0, 0.18), 'spine': (0.04, 0, 0)}, fist('L', 0.6), fist('R', 0.6))),
    (7, merge({'thigh.L': (0.95, 0, 0), 'thigh.R': (0.95, 0, 0), 'shin.L': (-1.35, 0, 0), 'shin.R': (-1.35, 0, 0),
               'foot.L': (0.35, 0, 0), 'foot.R': (0.35, 0, 0), 'spine': (0.34, 0, 0), 'head': (0.16, 0, 0),
               'upperarm.L': (0.85, 0, -0.22), 'upperarm.R': (0.85, 0, 0.22),
               'root_loc': (0, 0, -0.145)}, fist('L', 0.9), fist('R', 0.9))),
    (13, merge({'thigh.L': (-0.16, 0, 0), 'thigh.R': (-0.16, 0, 0), 'shin.L': (0.10, 0, 0), 'shin.R': (0.10, 0, 0),
                'foot.L': (-0.30, 0, 0), 'foot.R': (-0.30, 0, 0), 'spine': (-0.06, 0, 0),
                'upperarm.L': (-1.85, 0, -0.25), 'upperarm.R': (-1.85, 0, 0.25),
                'root_loc': (0, 0, 0.30)}, palm('L', 0.1), palm('R', 0.1))),
    (24, merge({'thigh.L': (0.55, 0, 0), 'thigh.R': (0.45, 0, 0), 'shin.L': (-0.85, 0, 0), 'shin.R': (-0.70, 0, 0),
                'spine': (0.16, 0, 0), 'upperarm.L': (-0.60, 0, -0.30), 'upperarm.R': (-0.60, 0, 0.30),
                'root_loc': (0, 0, 0.34)}, palm('L', 0.2), palm('R', 0.2))),
    (34, merge({'thigh.L': (0.22, 0, 0), 'thigh.R': (0.22, 0, 0), 'shin.L': (-0.20, 0, 0), 'shin.R': (-0.20, 0, 0),
                'foot.L': (0.28, 0, 0), 'foot.R': (0.28, 0, 0), 'spine': (-0.04, 0, 0),
                'upperarm.L': (0.30, 0, -0.22), 'upperarm.R': (0.30, 0, 0.22),
                'root_loc': (0, 0, 0.02)}, fist('L', 0.7), fist('R', 0.7))),
    (42, merge({'thigh.L': (0.80, 0, 0), 'thigh.R': (0.80, 0, 0), 'shin.L': (-1.05, 0, 0), 'shin.R': (-1.05, 0, 0),
                'spine': (0.26, 0, 0), 'upperarm.L': (0.55, 0, -0.28), 'upperarm.R': (0.55, 0, 0.28),
                'root_loc': (0, 0, -0.115)}, fist('L', 0.8), fist('R', 0.8))),
    (54, merge({'thigh.L': (0.30, 0, 0), 'thigh.R': (0.30, 0, 0), 'shin.L': (-0.34, 0, 0), 'shin.R': (-0.34, 0, 0),
                'spine': (0.04, 0, 0), 'upperarm.L': (0.20, 0, -0.18), 'upperarm.R': (0.20, 0, 0.18)}, fist('L', 0.6), fist('R', 0.6))),
]

# Punch: guard, coil away from the target, drive from the hips, snap the fist out, follow through.
PUNCH = [
    (1, merge({'upperarm.R': (0.30, 0, 0.20), 'forearm.R': (1.30, 0, 0), 'upperarm.L': (0.35, 0, -0.22),
               'forearm.L': (1.45, 0, 0), 'chest': (0, 0.10, 0), 'spine': (0.04, 0, 0)}, fist('L'), fist('R'))),
    (7, merge({'upperarm.R': (0.10, 0, 0.52), 'forearm.R': (1.75, 0, 0), 'upperarm.L': (0.30, 0, -0.20),
               'forearm.L': (1.40, 0, 0), 'chest': (0, 0.34, 0), 'spine': (0, 0.12, 0.06),
               'hips': (0, 0.10, 0)}, fist('L'), fist('R'))),
    (12, merge({'upperarm.R': (-1.52, 0, 0.06), 'forearm.R': (0.06, 0, 0), 'upperarm.L': (0.55, 0, -0.30),
                'forearm.L': (1.55, 0, 0), 'chest': (0, -0.52, 0), 'spine': (0.12, -0.16, -0.06),
                'hips': (0, -0.12, 0)}, fist('L'), fist('R'))),
    (18, merge({'upperarm.R': (-1.34, 0, 0.10), 'forearm.R': (0.14, 0, 0), 'upperarm.L': (0.50, 0, -0.28),
                'forearm.L': (1.50, 0, 0), 'chest': (0, -0.40, 0), 'spine': (0.10, -0.10, -0.04)}, fist('L'), fist('R'))),
    (26, merge({'upperarm.R': (0.30, 0, 0.20), 'forearm.R': (1.30, 0, 0), 'upperarm.L': (0.35, 0, -0.22),
                'forearm.L': (1.45, 0, 0), 'chest': (0, 0.10, 0), 'spine': (0.04, 0, 0)}, fist('L'), fist('R'))),
]

# Kick: chamber the knee, extend through the target, retract under control, reset.
KICK = [
    (1, merge({'thigh.R': (0.10, 0, 0), 'shin.R': (0.20, 0, 0), 'spine': (0.02, 0, 0),
               'upperarm.L': (0.30, 0, -0.24), 'upperarm.R': (0.30, 0, 0.24)}, fist('L', 0.8), fist('R', 0.8))),
    (7, merge({'thigh.R': (1.15, 0, -0.10), 'shin.R': (-1.30, 0, 0), 'foot.R': (0.30, 0, 0),
               'spine': (-0.10, 0, 0.22), 'hips': (0, 0, 0.16),
               'upperarm.L': (0.55, 0, -0.55), 'upperarm.R': (0.20, 0, 0.30)}, fist('L', 0.8), fist('R', 0.8))),
    (13, merge({'thigh.R': (1.55, 0, -0.14), 'shin.R': (-0.12, 0, 0), 'foot.R': (-0.10, 0, 0),
                'spine': (-0.30, 0, 0.30), 'hips': (0, 0, 0.22),
                'upperarm.L': (0.75, 0, -0.65), 'upperarm.R': (0.10, 0, 0.34)}, fist('L', 0.8), fist('R', 0.8))),
    (19, merge({'thigh.R': (1.30, 0, -0.10), 'shin.R': (-0.35, 0, 0), 'spine': (-0.22, 0, 0.24),
                'hips': (0, 0, 0.18), 'upperarm.L': (0.65, 0, -0.58)}, fist('L', 0.8), fist('R', 0.8))),
    (27, merge({'thigh.R': (0.10, 0, 0), 'shin.R': (0.20, 0, 0), 'spine': (0.02, 0, 0),
                'upperarm.L': (0.30, 0, -0.24), 'upperarm.R': (0.30, 0, 0.24)}, fist('L', 0.8), fist('R', 0.8))),
]

# Kamehameha, four readable stages: settle, charge (hands cupped at the hip, body coiled), thrust
# and fire (hips drive forward, arms punch out), then recover. Fingers stay open on the fired pose.
KAME = [
    (1, merge({'spine': (0.04, 0, 0), 'upperarm.L': (0.30, 0, -0.24), 'upperarm.R': (0.30, 0, 0.24),
               'forearm.L': (0.60, 0, 0), 'forearm.R': (0.60, 0, 0),
               'thigh.L': (0.05, 0, 0), 'thigh.R': (-0.05, 0, 0)}, palm('L', 0.1), palm('R', 0.1))),
    (12, merge({'spine': (0.20, 0.20, -0.10), 'chest': (0, 0.24, 0), 'head': (0, -0.20, 0),
                'hips': (0, 0.16, 0),
                'upperarm.R': (0.55, 0, 0.90), 'forearm.R': (1.95, 0, 0),
                'upperarm.L': (0.45, 0, -0.95), 'forearm.L': (1.90, 0, 0),
                'thigh.L': (0.32, 0, 0.16), 'shin.L': (-0.42, 0, 0),
                'thigh.R': (-0.26, 0, -0.12), 'shin.R': (-0.16, 0, 0),
                'root_loc': (0, 0, -0.055)}, fist('L', 0.9), fist('R', 0.9))),
    (30, merge({'spine': (0.26, 0.24, -0.12), 'chest': (0.02, 0.28, 0), 'head': (0, -0.24, 0),
                'hips': (0, 0.20, 0),
                'upperarm.R': (0.60, 0, 1.00), 'forearm.R': (2.05, 0, 0),
                'upperarm.L': (0.50, 0, -1.02), 'forearm.L': (2.00, 0, 0),
                'thigh.L': (0.38, 0, 0.18), 'shin.L': (-0.50, 0, 0),
                'thigh.R': (-0.30, 0, -0.14), 'shin.R': (-0.20, 0, 0),
                'root_loc': (0, 0, -0.075)}, fist('L', 1.0), fist('R', 1.0))),
    # Charging shake, small and alternating, so the build-up reads as energy rather than a held pose.
    (34, merge({'spine': (0.24, 0.22, -0.10), 'chest': (0.02, 0.26, 0.02), 'head': (0.02, -0.22, 0),
                'upperarm.R': (0.58, 0, 0.98), 'forearm.R': (2.03, 0, 0),
                'upperarm.L': (0.48, 0, -1.00), 'forearm.L': (1.98, 0, 0),
                'thigh.L': (0.36, 0, 0.17), 'shin.L': (-0.48, 0, 0), 'root_loc': (0, 0, -0.070)}, fist('L', 1.0), fist('R', 1.0))),
    (38, merge({'spine': (0.26, 0.24, -0.12), 'chest': (0.02, 0.28, -0.02), 'head': (0, -0.24, 0),
                'upperarm.R': (0.60, 0, 1.00), 'forearm.R': (2.05, 0, 0),
                'upperarm.L': (0.50, 0, -1.02), 'forearm.L': (2.00, 0, 0),
                'thigh.L': (0.38, 0, 0.18), 'shin.L': (-0.50, 0, 0), 'root_loc': (0, 0, -0.075)}, fist('L', 1.0), fist('R', 1.0))),
    (46, merge({'spine': (-0.24, -0.10, 0.06), 'chest': (0, -0.16, 0), 'head': (0, 0.10, 0),
                'hips': (0, -0.10, 0),
                'upperarm.R': (-1.45, 0, 0.20), 'forearm.R': (0.12, 0, 0),
                'upperarm.L': (-1.45, 0, -0.20), 'forearm.L': (0.12, 0, 0),
                'thigh.L': (0.55, 0, 0.10), 'shin.L': (-0.25, 0, 0),
                'thigh.R': (-0.35, 0, -0.08), 'shin.R': (0.18, 0, 0),
                'root_loc': (0, 0, -0.030)}, palm('L', 0.22), palm('R', 0.22))),
    (60, merge({'spine': (-0.26, -0.12, 0.06), 'chest': (0, -0.18, 0), 'head': (0, 0.12, 0),
                'hips': (0, -0.12, 0),
                'upperarm.R': (-1.50, 0, 0.22), 'forearm.R': (0.10, 0, 0),
                'upperarm.L': (-1.50, 0, -0.22), 'forearm.L': (0.10, 0, 0),
                'thigh.L': (0.58, 0, 0.10), 'shin.L': (-0.28, 0, 0),
                'thigh.R': (-0.38, 0, -0.08), 'shin.R': (0.20, 0, 0),
                'root_loc': (0, 0, -0.035)}, palm('L', 0.24), palm('R', 0.24))),
    (78, merge({'spine': (0.04, 0, 0), 'upperarm.L': (0.30, 0, -0.24), 'upperarm.R': (0.30, 0, 0.24),
                'forearm.L': (0.60, 0, 0), 'forearm.R': (0.60, 0, 0),
                'thigh.L': (0.05, 0, 0), 'thigh.R': (-0.05, 0, 0)}, palm('L', 0.1), palm('R', 0.1))),
]

make_action('Idle', IDLE)
make_action('Walk', WALK)
make_action('Run', RUN)
make_action('Jump', JUMP)
make_action('Punch', PUNCH)
make_action('Kick', KICK)
make_action('Kamehameha', KAME)

# Stack every action as its own NLA track so the glTF exporter writes all of them.
rig.animation_data.action = None
for name in action_names:
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, bpy.data.actions[name])
    strip.name = name
log(f'actions: {action_names}')

# ----------------------------------------------------------------------------- export
glb = os.path.join(OUT, 'goku_showcase.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=glb,
    export_format='GLB',
    use_selection=True,
    export_animations=True,
    export_animation_mode='ACTIONS',
    export_nla_strips=True,
    export_apply=True,
    export_yup=True,
    export_image_format='AUTO',
)
log(f'exported {glb} ({os.path.getsize(glb)} bytes)')

# ----------------------------------------------------------------------------- renders
bpy.ops.object.camera_add(location=(0, -3.4, 1.3), rotation=(math.radians(86), 0, 0))
cam = bpy.context.object
cam.data.lens = 62
scene.camera = cam

for loc, energy, size in (((2.6, -2.4, 3.0), 900, 2.4), ((-2.8, -1.6, 2.2), 430, 2.6),
                          ((0, 3.0, 2.6), 520, 2.6), ((0, -1.6, 1.7), 260, 1.4)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    light = bpy.context.object
    light.data.energy = energy
    light.data.size = size
    light.rotation_euler = (math.radians(62), 0, math.radians(35))

bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
floor = bpy.context.object
floor.name = 'Floor'
floor.data.materials.append(material('Floor', (0.10, 0.11, 0.13), 0.8))

# Every action was stacked as a live NLA track, so the preview frame would evaluate all of them at
# once. The GLB is exported above; for the preview only, silence the stack and play one action.
for track in rig.animation_data.nla_tracks:
    track.mute = True


def play(action_name, frame):
    rig.animation_data.action = bpy.data.actions[action_name]
    scene.frame_set(frame)


# The character faces +Y (eyes, nose and mouth are at positive y). The first pass put the "front"
# camera at -3.4 on Y, which looks at the back of the head, and hand-placed euler angles for the
# close-ups missed their subjects entirely. Aim with a track quaternion at an explicit target.
def aim(location, target, lens):
    cam.location = Vector(location)
    direction = Vector(target) - Vector(location)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


VIEWS = {
    'front': ((0.0, 3.2, 1.05), (0.0, 0.0, 1.00), 62),
    'side': ((3.2, 0.0, 1.05), (0.0, 0.0, 1.00), 62),
    'back': ((0.0, -3.2, 1.05), (0.0, 0.0, 1.00), 62),
    'threequarter': ((2.3, 2.3, 1.35), (0.0, 0.0, 1.00), 62),
    # Close-ups: the checks a full-body shot cannot make.
    'face': ((0.30, 1.05, 1.70), (0.0, 0.02, 1.65), 80),
    'hand': ((-0.44, 0.66, 0.80), (-0.228, 0.03, 0.67), 85),
    'cloth': ((0.45, 1.25, 1.24), (0.0, 0.03, 1.14), 72),
}
ANIM_FRAMES = {'Idle': 24, 'Walk': 8, 'Run': 12, 'Jump': 24, 'Punch': 12, 'Kick': 13, 'Kamehameha': 46}

if '--no-render' in argv:
    log('skipping renders (--no-render)')
else:
    only = argv[argv.index('--only') + 1] if '--only' in argv else None
    play('Idle', 24)
    for name, (loc, target, lens) in VIEWS.items():
        if only and name != only:
            continue
        if name == 'hand':
            # The hand hangs beside the thigh, so any fixed camera either framed the leg or sat
            # inside it. Raise the arm for this one shot and aim at the hand BONE's world position.
            rig.animation_data.action = None
            for bone_name, rot in (('upperarm.L', (-1.15, 0.0, -0.85)),
                                   ('forearm.L', (0.55, 0.0, 0.0)),
                                   ('hand.L', (0.10, 0.0, 0.0))):
                pb = rig.pose.bones.get(bone_name)
                if pb:
                    pb.rotation_mode = 'XYZ'
                    pb.rotation_euler = rot
            bpy.context.view_layer.update()
            hand_point = rig.matrix_world @ rig.pose.bones['hand.L'].head
            target = tuple(hand_point)
            # Step out along a fixed outward/forward direction: offset arithmetic put the camera
            # inside the torso and rendered a black frame.
            outward = Vector((-0.62, 0.72, 0.30)).normalized()
            loc = tuple(hand_point + outward * 0.55)
            lens = 85
        aim(loc, target, lens)
        scene.render.filepath = os.path.join(OUT, f'goku_{name}.png')
        bpy.ops.render.render(write_still=True)
        log(f'rendered {name}')
        if name == 'hand':
            play('Idle', 24)
    # One inspection frame per clip, from a three-quarter angle so limb positions are readable.
    aim((2.3, 2.1, 1.35), (0.0, 0.0, 1.0), 58)
    for clip, frame in ({} if '--views' in argv else ANIM_FRAMES).items():
        play(clip, frame)
        scene.render.filepath = os.path.join(OUT, f'goku_anim_{clip.lower()}.png')
        bpy.ops.render.render(write_still=True)
        log(f'rendered animation frame {clip}@{frame}')

log('done')
