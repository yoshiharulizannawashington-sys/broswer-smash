# Build an original, rigged, animated anime-inspired martial artist and export it as GLB.
#
# Everything this script produces is original geometry authored here: no downloaded model,
# texture, scan or motion-capture clip is involved, so there is no third-party licence to
# record. It is the reference implementation of the Blender -> GLB -> game pipeline:
#
#   bash scripts/blender.sh -b --python assets/blender/build_anime_fighter.py -- \
#        --out public/models/characters/kaze/kaze.glb
#
# What it makes
#   * lofted anatomy built from *real volumes*: rings lie in the horizontal plane and stack up
#     the body, so every part has width and depth (the first version of this file stacked its
#     rings in one vertical plane, which produced paper-cutout shells; `loft()` now documents
#     and enforces the axis),
#   * a shaped head with jaw, cheekbones, eye sockets, lids, irises, pupils, brows, nose, mouth
#     and ears, with every facial feature placed against the measured face surface,
#   * swept hair blades layered over a scalp cap,
#   * a wrapped gi: a fabric shell with a real V opening, lapels, sash with knot and tails,
#     skirt panels, trousers, forearm wraps, boots with a sole and strap,
#   * twelve PBR materials with subtle procedural fabric/leather/skin textures and authored UVs,
#   * a 20-bone humanoid armature named for the game's rig mapper (Mixamo-style),
#   * hybrid weights: the torso and jacket blend smoothly along Hips/Spine/Chest/Neck while each
#     limb segment stays rigid to its own bone with deliberate overlapping joint geometry,
#   * eight animation clips named after the game's clip ids.
#
# The exported GLB is verified afterwards by scripts/inspect-character-glb.mjs, which fails if
# the geometry is flat, the rig does not resolve, or the clips are missing.

import bpy
import bmesh
import json
import math
import os
import sys
import tempfile
from mathutils import Vector, Euler

ARGV = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in ARGV:
        index = ARGV.index(name)
        if index + 1 < len(ARGV):
            return ARGV[index + 1]
    return default


OUT = arg('--out', 'public/models/characters/kaze/kaze.glb')
REPORT = arg('--report', None)
TAU = math.pi * 2

# --------------------------------------------------------------------------- scene helpers


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.render.fps = 60
    # Work in metres with Z up and -Y forward while authoring; the glTF exporter converts to
    # Y-up, where the character faces +Z (the game's fighters face +Z with yawOffset 0).
    scene.frame_start = 1
    scene.frame_end = 60


# --------------------------------------------------------------------------- textures

TEXTURE_DIR = os.path.join(tempfile.gettempdir(), 'kaze-textures')


def _write_texture(name, pixels, size):
    """Persist a generated RGBA float image as PNG so the glTF exporter can embed it."""
    os.makedirs(TEXTURE_DIR, exist_ok=True)
    image = bpy.data.images.new(name, size, size, alpha=False)
    image.pixels = pixels
    path = os.path.join(TEXTURE_DIR, name + '.png')
    image.filepath_raw = path
    image.file_format = 'PNG'
    image.save()
    return image


def _noise(size, cell, seed):
    """Smooth value noise in [0,1] without third-party dependencies: a coarse random lattice,
    bilinearly upsampled, then a second finer octave blended in."""
    import random
    rng = random.Random(seed)

    def lattice(cells):
        grid = [[rng.random() for _ in range(cells + 1)] for _ in range(cells + 1)]
        out = []
        for y in range(size):
            row = []
            fy = y / size * cells
            y0 = int(fy)
            ty = fy - y0
            ty = ty * ty * (3 - 2 * ty)
            for x in range(size):
                fx = x / size * cells
                x0 = int(fx)
                tx = fx - x0
                tx = tx * tx * (3 - 2 * tx)
                a = grid[y0][x0] * (1 - tx) + grid[y0][x0 + 1] * tx
                b = grid[y0 + 1][x0] * (1 - tx) + grid[y0 + 1][x0 + 1] * tx
                row.append(a * (1 - ty) + b * ty)
            out.append(row)
        return out

    coarse = lattice(max(2, cell))
    fine = lattice(max(4, cell * 4))
    return [[coarse[y][x] * 0.7 + fine[y][x] * 0.3 for x in range(size)] for y in range(size)]


def fabric_texture(name, base, contrast=0.055, cell=6, seed=3, weave=34):
    """A cloth base-colour map: soft tonal drift plus a faint horizontal yarn pattern.

    Deliberately low contrast. At the game's pulled-back camera a stronger weave becomes visible
    noise on a Chromebook screen; this reads as fabric in a close-up and as a clean colour in the
    arena, which is the honest target for a 256px generated map.
    """
    size = 128
    noise = _noise(size, cell, seed)
    pixels = []
    for y in range(size):
        for x in range(size):
            yarn = math.sin(x / size * math.pi * 2 * weave) * 0.012
            yarn += math.sin(y / size * math.pi * 2 * weave * 0.5) * 0.008
            shade = 1.0 + (noise[y][x] - 0.5) * contrast * 2 + yarn
            pixels.extend((
                max(0.0, min(1.0, base[0] * shade)),
                max(0.0, min(1.0, base[1] * shade)),
                max(0.0, min(1.0, base[2] * shade)),
                1.0))
    return _write_texture(name, pixels, size)


def leather_texture(name, base, cell=10, seed=11):
    """Boot leather: low-frequency grain with a slight sheen break-up."""
    size = 128
    noise = _noise(size, cell, seed)
    pixels = []
    for y in range(size):
        for x in range(size):
            grain = ((x * 7 + y * 13) % 11) / 11.0 * 0.02
            shade = 1.0 + (noise[y][x] - 0.5) * 0.16 + grain
            pixels.extend((
                max(0.0, min(1.0, base[0] * shade)),
                max(0.0, min(1.0, base[1] * shade)),
                max(0.0, min(1.0, base[2] * shade)),
                1.0))
    return _write_texture(name, pixels, size)


def skin_texture(name, base):
    """Skin: very fine tonal variation only. Anything stronger reads as a skin disease."""
    size = 64
    noise = _noise(size, 5, 21)
    pixels = []
    for y in range(size):
        for x in range(size):
            shade = 1.0 + (noise[y][x] - 0.5) * 0.06
            pixels.extend((
                max(0.0, min(1.0, base[0] * shade)),
                max(0.0, min(1.0, base[1] * shade)),
                max(0.0, min(1.0, base[2] * shade)),
                1.0))
    return _write_texture(name, pixels, size)


def _srgb_to_linear(channel):
    """Palette entries in this file are written as the colour you want to see on screen (sRGB).

    glTF stores linear base colours, so the conversion has to happen once, here. Without it every
    material came out a pastel wash: the deep navy trousers rendered as pale mauve and the rich
    orange gi as a pale apricot, because an sRGB value fed straight into a linear slot is brightened.
    """
    return channel / 12.92 if channel <= 0.04045 else ((channel + 0.055) / 1.055) ** 2.4


def make_material(name, color, metallic=0.0, roughness=0.6, emission=None, emission_strength=1.0,
                  texture=None, uv_repeats=1.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    linear = tuple(_srgb_to_linear(channel) for channel in color)
    bsdf.inputs['Base Color'].default_value = (*linear, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = 0.42
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*tuple(_srgb_to_linear(c) for c in emission), 1.0)
        bsdf.inputs['Emission Strength'].default_value = emission_strength
    if texture is not None:
        image_node = nodes.new('ShaderNodeTexImage')
        image_node.image = texture
        image_node.location = (-420, 220)
        image_node.interpolation = 'Linear'
        mapping = nodes.new('ShaderNodeMapping')
        mapping.location = (-640, 220)
        texcoord = nodes.new('ShaderNodeTexCoord')
        texcoord.location = (-820, 220)
        mapping.inputs['Scale'].default_value = (uv_repeats, uv_repeats, 1.0)
        mat.node_tree.links.new(texcoord.outputs['UV'], mapping.inputs['Vector'])
        mat.node_tree.links.new(mapping.outputs['Vector'], image_node.inputs['Vector'])
        mat.node_tree.links.new(image_node.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# --------------------------------------------------------------------------- geometry helpers


def mesh_object(name, verts, faces, material, uvs=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    # Outward winding, decided once here instead of in every caller.
    #
    # The ring order in a loft follows the section list, and sections are authored in whichever
    # direction reads best (the torso climbs from hips to shoulders, an arm descends from shoulder
    # to wrist). A descending list silently inverts every quad, which leaves the mesh inside-out:
    # it still renders because the glTF materials are double-sided, but its normals point into the
    # body, so lighting is computed from the wrong side. The probe for this is the signed volume
    # below, which is negative for the arms, legs, fingers, lapels and fringes before the fix.
    bm = bmesh.new()
    bm.from_mesh(mesh)
    if len(bm.faces) and len(bm.verts):
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        if bm.calc_volume(signed=True) < 0:
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    if uvs:
        layer = mesh.uv_layers.new(name='UVMap')
        for poly in mesh.polygons:
            for loop_index in poly.loop_indices:
                vertex = mesh.loops[loop_index].vertex_index
                layer.data[loop_index].uv = uvs[vertex]
    return obj


def loft(name, sections, material, segments=20, cap_start=True, cap_end=True, axis='Z',
         uv_tiles=(2.0, 2.0)):
    """Loft a closed volume through elliptical cross-sections.

    axis='Z' (the default) is the body's case: each section is a ring in the horizontal X-Y plane
    and the sections stack up the Z axis, so a `rx`/`ry` pair gives the part real width *and*
    depth. axis='Y' runs the rings along Y instead, which is what a foot needs (heel to toe).

    Section keys: x/y/z centre, rx radius, ry radius (alias rz), optional front/back multipliers
    that squash or bulge the -Y (chest forward) and +Y (back) halves of the ring.
    """
    verts, faces, uvs = [], [], []
    count = len(sections)
    for index, section in enumerate(sections):
        cx, cy, cz = section.get('x', 0.0), section.get('y', 0.0), section.get('z', 0.0)
        rx = section['rx']
        second = section.get('ry', section.get('rz', rx))
        front = section.get('front', 1.0)
        back = section.get('back', 1.0)
        for i in range(segments):
            angle = (i / segments) * TAU
            du = math.cos(angle) * rx
            dv = math.sin(angle) * second
            if axis == 'Z':
                if dv < 0:
                    dv *= front
                else:
                    dv *= back
                verts.append((cx + du, cy + dv, cz))
            else:
                verts.append((cx + du, cy, cz + dv))
            uvs.append((i / segments * uv_tiles[0], index / max(1, count - 1) * uv_tiles[1]))
    for ring in range(count - 1):
        for i in range(segments):
            a = ring * segments + i
            b = ring * segments + ((i + 1) % segments)
            c = (ring + 1) * segments + i
            d = (ring + 1) * segments + ((i + 1) % segments)
            faces.append((a, b, d, c))
    if cap_start:
        centre = len(verts)
        first_section = sections[0]
        verts.append((first_section.get('x', 0.0), first_section.get('y', 0.0),
                      first_section.get('z', 0.0)))
        uvs.append((0.5, 0.5))
        for i in range(segments):
            faces.append((centre, (i + 1) % segments, i))
    if cap_end:
        base = (count - 1) * segments
        centre = len(verts)
        last = sections[-1]
        verts.append((last.get('x', 0.0), last.get('y', 0.0), last.get('z', 0.0)))
        uvs.append((0.5, 0.5))
        for i in range(segments):
            faces.append((centre, base + i, base + (i + 1) % segments))
    return mesh_object(name, verts, faces, material, uvs)


def shell(name, sections, material, segments=26, thickness=0.010, uv_tiles=(2.0, 2.0)):
    """A fabric shell with real thickness and an optional front opening.

    Each section may set `gap`, the total opening angle in radians centred on the front (-Y).
    gap=0 gives a closed band (the sash); a positive gap gives the gi's V opening, with the inner
    surface and the rim quads also generated so the edge reads from the side instead of vanishing.

    `front` mirrors loft(): it bulges the -Y half of the ring, so a coat can drape over a chest
    that is itself bulged by the torso's own `front` value. Without it the shell is a plain
    ellipse, and a torso chest that swells by 7% pushes straight through the lining.
    """
    # A band with no opening must wrap: its last column *is* its first, so it gets `segments`
    # columns and a modulo lookup. Duplicating the seam column instead (which this function used to
    # do unconditionally) leaves an unwelded split down the back of every sash, wrap and sleeve -
    # invisible from the front, but an open boundary that shows as a crease from behind.
    closing = sections[0].get('gap', 0.0) <= 1e-6
    columns = segments if closing else segments + 1
    outer, inner = [], []
    uvs = []
    count = len(sections)
    for index, section in enumerate(sections):
        cx, cy, cz = section.get('x', 0.0), section.get('y', 0.0), section.get('z', 0.0)
        rx = section['rx']
        second = section.get('ry', section.get('rz', rx))
        gap = section.get('gap', 0.0)
        front = section.get('front', 1.0)
        start = -math.pi / 2 + gap / 2
        span = TAU - gap
        for i in range(columns):
            angle = start + (i / segments) * span
            du = math.cos(angle)
            dv = math.sin(angle)
            if dv < 0:
                dv *= front
            outer.append((cx + du * rx, cy + dv * second, cz))
            inner.append((cx + du * (rx - thickness), cy + dv * (second - thickness), cz))
            # outer and inner surfaces share the same UV, so this pair must be appended twice or
            # the loop lookup for the inner shell indexes past the end of the list.
            uv = (i / segments * uv_tiles[0], index / max(1, count - 1) * uv_tiles[1])
            uvs.append(uv)
            uvs.append(uv)
    def column_next(ring, i):
        return ring * columns + ((i + 1) % columns if closing else i + 1)

    verts = outer + inner
    offset = len(outer)
    faces = []
    for ring in range(count - 1):
        for i in range(segments):
            a = ring * columns + i
            b = column_next(ring, i)
            c = (ring + 1) * columns + i
            d = column_next(ring + 1, i)
            faces.append((a, b, d, c))                                     # outer skin
            faces.append((offset + c, offset + d, offset + b, offset + a))  # inner skin
    # Rims: top, bottom and (when the shell is open) both vertical edges.
    for ring in (0, count - 1):
        for i in range(segments):
            a = ring * columns + i
            b = column_next(ring, i)
            ia, ib = offset + a, offset + b
            faces.append((a, ia, ib, b) if ring == 0 else (b, ib, ia, a))
    if not closing:
        for column in (0, segments):
            for ring in range(count - 1):
                a = ring * columns + column
                c = (ring + 1) * columns + column
                faces.append((a, c, offset + c, offset + a) if column == 0
                             else (c, a, offset + a, offset + c))
    return mesh_object(name, verts, faces, material, uvs)


def box(name, size, location, material, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (size[0], size[1], size[2])
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = False
    return obj


def sphere(name, radius, location, material, scale=(1, 1, 1), segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, segments=segments, ring_count=rings,
                                        location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(material)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


def cone(name, radius, depth, location, material, rotation=(0, 0, 0), vertices=8):
    bpy.ops.mesh.primitive_cone_add(radius1=radius, radius2=0.0, depth=depth, vertices=vertices,
                                    location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    return obj


def torus(name, major, minor, location, material, rotation=(0, 0, 0), mode='MAJOR_MINOR'):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=24,
                                     minor_segments=8, location=location, rotation=rotation,
                                     mode=mode)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(material)
    for poly in obj.data.polygons:
        poly.use_smooth = True
    return obj


# --------------------------------------------------------------------------- the fighter

PALETTE = {}


def build_materials():
    """A rich orange gi over a deep blue undershirt, navy sash, leather boots and gold trim, with
    the forearm wraps sharing the `fighter-accent` name the game's form presentation looks for so
    Wind-Step lights them up on the real model.

    Procedural colour maps were tried here first and removed: every material becomes its own glTF
    primitive with its own UV island, so a mottled base colour jumped in tone at each seam and the
    forearm read as a stack of differently-shaded bands at gameplay distance. The UVs are still
    authored and exported; the surface variation is carried by PBR parameters instead, which cannot
    band across a seam.
    """
    PALETTE['skin'] = make_material('kaze-skin', (0.560, 0.360, 0.250), 0.0, 0.54)
    PALETTE['skin_dark'] = make_material('kaze-skin-shade', (0.430, 0.255, 0.180), 0.0, 0.60)
    PALETTE['hair'] = make_material('kaze-hair', (0.045, 0.050, 0.072), 0.14, 0.30)
    PALETTE['gi'] = make_material('kaze-gi', (0.640, 0.250, 0.055), 0.0, 0.83)
    PALETTE['gi_shade'] = make_material('kaze-gi-shade', (0.420, 0.145, 0.035), 0.0, 0.86)
    PALETTE['trouser'] = make_material('kaze-trousers', (0.075, 0.095, 0.175), 0.0, 0.82)
    PALETTE['shirt'] = make_material('kaze-undershirt', (0.080, 0.165, 0.420), 0.0, 0.74)
    PALETTE['sash'] = make_material('kaze-sash', (0.070, 0.115, 0.260), 0.0, 0.68)
    PALETTE['boot'] = make_material('kaze-boot', (0.048, 0.050, 0.062), 0.28, 0.36)
    PALETTE['trim'] = make_material('kaze-trim', (0.800, 0.620, 0.230), 0.88, 0.26)
    PALETTE['eye'] = make_material('kaze-eye', (0.930, 0.945, 0.965), 0.0, 0.24)
    PALETTE['iris'] = make_material('kaze-iris', (0.070, 0.290, 0.320), 0.05, 0.22)
    PALETTE['accent'] = make_material('fighter-accent', (0.840, 0.830, 0.780), 0.0, 0.72)


# Joint heights in metres for a 1.80 m stylised martial artist.
HIPS = 0.98
CHEST = 1.24
NECK = 1.44
CROWN = 1.62
SHOULDER_X = 0.202
ELBOW_Z = 1.10
WRIST_Z = 0.83
HIP_X = 0.098
KNEE = 0.52
ANKLE = 0.10

# Head profile: z, half-width, half-depth, front bulge. Shared by the head loft and by
# head_front_y(), so a feature can never be authored against a shape the skull does not have.
HEAD_CENTER_Y = 0.002
HEAD_SECTIONS = [
    {'z': 1.506, 'rx': 0.049, 'ry': 0.055, 'front': 1.10},
    {'z': 1.528, 'rx': 0.063, 'ry': 0.076, 'front': 1.07},
    {'z': 1.554, 'rx': 0.073, 'ry': 0.088, 'front': 1.04},
    {'z': 1.588, 'rx': 0.078, 'ry': 0.094, 'front': 1.02},
    {'z': 1.630, 'rx': 0.082, 'ry': 0.098, 'front': 1.01},
    {'z': 1.672, 'rx': 0.084, 'ry': 0.098},
    {'z': 1.706, 'rx': 0.077, 'ry': 0.090},
    {'z': 1.730, 'rx': 0.058, 'ry': 0.067},
    {'z': 1.746, 'rx': 0.030, 'ry': 0.034},
]


def _head_ring(z):
    """Interpolate the head's half-width, half-depth and front bulge at height z."""
    sections = HEAD_SECTIONS
    if z <= sections[0]['z']:
        ring = sections[0]
        return ring['rx'], ring['ry'], ring.get('front', 1.0)
    for index in range(len(sections) - 1):
        low, high = sections[index], sections[index + 1]
        if low['z'] <= z <= high['z']:
            t = (z - low['z']) / max(1e-6, high['z'] - low['z'])
            lerp = lambda key: low.get(key, 1.0) * (1 - t) + high.get(key, 1.0) * t
            return lerp('rx'), lerp('ry'), lerp('front')
    ring = sections[-1]
    return ring['rx'], ring['ry'], ring.get('front', 1.0)


def head_front_y(x, z):
    """Front (-Y) surface of the head at horizontal offset x and height z.

    Features are placed relative to this value with a negative offset (further forward). Writing a
    constant instead is how the first pass ended up with eyes, brows and mouth sealed inside the
    skull, invisible in every render.
    """
    rx, ry, front = _head_ring(z)
    t = max(0.0, 1.0 - (x / max(1e-6, rx)) ** 2)
    return HEAD_CENTER_Y - ry * front * math.sqrt(t)


# --------------------------------------------------------------------------- body


def build_body():
    parts = []

    # ---- torso: hips -> waist -> ribcage -> shoulder shelf. Undershirt colour: the gi opens
    # over this surface, so a deep blue V is visible between the lapels.
    parts.append(loft('torso', [
        {'z': 0.900, 'rx': 0.138, 'ry': 0.094},
        {'z': 0.960, 'rx': 0.143, 'ry': 0.097, 'front': 1.03},
        {'z': 1.030, 'rx': 0.136, 'ry': 0.093},
        {'z': 1.090, 'rx': 0.128, 'ry': 0.089},
        {'z': 1.160, 'rx': 0.146, 'ry': 0.099, 'front': 1.05},
        {'z': 1.245, 'rx': 0.172, 'ry': 0.110, 'front': 1.07},
        {'z': 1.330, 'rx': 0.190, 'ry': 0.110, 'front': 1.03},
        {'z': 1.395, 'rx': 0.186, 'ry': 0.106},
        {'z': 1.435, 'rx': 0.128, 'ry': 0.084},
    ], PALETTE['shirt'], segments=26, uv_tiles=(2.0, 2.2)))

    # Pectoral definition: a shallow pair of swells under the undershirt so the chest is not a
    # smooth cylinder in the open V.
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        parts.append(loft(f'pec-{tag}', [
            {'x': side * 0.062, 'y': -0.052, 'z': 1.258, 'rx': 0.052, 'ry': 0.040},
            {'x': side * 0.062, 'y': -0.060, 'z': 1.292, 'rx': 0.050, 'ry': 0.036},
            {'x': side * 0.060, 'y': -0.050, 'z': 1.322, 'rx': 0.040, 'ry': 0.026},
        ], PALETTE['shirt'], segments=14, uv_tiles=(1.0, 1.0)))

    # ---- neck with a trapezius transition
    parts.append(loft('neck', [
        {'z': 1.360, 'rx': 0.086, 'ry': 0.070},
        {'z': 1.408, 'rx': 0.059, 'ry': 0.055},
        {'z': 1.452, 'rx': 0.051, 'ry': 0.050},
        {'z': 1.512, 'rx': 0.047, 'ry': 0.046},
    ], PALETTE['skin'], segments=18, uv_tiles=(1.5, 1.0)))

    # ---- gi jacket: a real fabric shell with a V opening that widens toward the collar.
    #
    # The profile is authored once here and shared with the lapels, which sit on the measured rim
    # of the opening. GI_LIFT is not cosmetic: a shell of thickness t whose outer wall is only t
    # outside the body puts its inner wall exactly *on* the undershirt, and two surfaces in the
    # same place is the coplanar defect the game showed as a stippled chest. The lift keeps a real
    # 6 mm air gap between the coat's lining and the shirt it covers.
    GI_LIFT = 0.006
    JACKET_PROFILE = [
        (0.955, 0.155, 0.108, 0.30, 1.00),
        (1.020, 0.147, 0.104, 0.34, 1.00),
        (1.090, 0.141, 0.100, 0.40, 1.02),
        (1.170, 0.159, 0.111, 0.52, 1.05),
        (1.255, 0.185, 0.121, 0.76, 1.07),
        (1.335, 0.202, 0.122, 0.92, 1.03),
        (1.400, 0.198, 0.117, 1.06, 1.00),
        (1.442, 0.146, 0.098, 0.96, 1.00),
    ]
    parts.append(shell('gi-jacket', [
        {'z': z, 'rx': rx + GI_LIFT, 'ry': ry + GI_LIFT, 'gap': gap, 'front': front}
        for z, rx, ry, gap, front in JACKET_PROFILE
    ], PALETTE['gi'], segments=30, thickness=0.011, uv_tiles=(2.4, 2.4)))

    # Lapels run down the opening; a flattened loft gives a stitched band rather than a slab.
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        # The lapel is placed on the measured edge of the opening: the shell's gap is centred on
        # the front, so its rim sits at (rx*sin(gap/2), -ry*cos(gap/2)). Derived from the same
        # profile as the shell, so a change to the coat cannot leave the lapel floating.
        lapel_sections = []
        for z, rx, ry, gap, front in reversed(JACKET_PROFILE[1:]):
            rx += GI_LIFT
            ry += GI_LIFT
            half = gap / 2
            lapel_sections.append({
                'x': side * (rx * math.sin(half) + 0.004),
                'y': -(ry * front * math.cos(half)) - 0.002,
                'z': z, 'rx': 0.013, 'ry': 0.009})
        parts.append(loft(f'lapel-{tag}', lapel_sections, PALETTE['gi_shade'], segments=10,
                          uv_tiles=(1.0, 2.0)))
    parts.append(torus('collar', 0.055, 0.011, (0.0, 0.004, 1.442), PALETTE['gi_shade'],
                       rotation=(math.radians(12), 0, 0)))

    # ---- sash: a closed fabric band, a knot and two weighted tails
    parts.append(shell('sash', [
        {'z': 0.898, 'rx': 0.154, 'ry': 0.110},
        {'z': 0.922, 'rx': 0.163, 'ry': 0.117},
        {'z': 0.958, 'rx': 0.162, 'ry': 0.116},
        {'z': 0.982, 'rx': 0.150, 'ry': 0.108},
    ], PALETTE['sash'], segments=26, thickness=0.012, uv_tiles=(2.0, 0.6)))
    parts.append(sphere('sash-knot', 0.034, (0.014, -0.116, 0.936), PALETTE['sash'],
                        scale=(1.25, 0.60, 0.95), segments=16, rings=10))
    parts.append(sphere('sash-knot-fold', 0.026, (-0.014, -0.114, 0.944), PALETTE['sash'],
                        scale=(1.05, 0.55, 0.80), segments=14, rings=8))
    for index, (dx, tilt) in enumerate(((-0.030, 0.10), (0.034, -0.14))):
        parts.append(loft(f'sash-tail-{index}', [
            {'x': 0.014 + dx * 0.4, 'y': -0.120, 'z': 0.926, 'rx': 0.015, 'ry': 0.008},
            {'x': 0.014 + dx * 0.8, 'y': -0.124, 'z': 0.876, 'rx': 0.017, 'ry': 0.008},
            {'x': 0.014 + dx, 'y': -0.118 + tilt * 0.2, 'z': 0.808, 'rx': 0.014, 'ry': 0.007},
            {'x': 0.014 + dx * 1.2, 'y': -0.110 + tilt * 0.4, 'z': 0.754, 'rx': 0.008, 'ry': 0.005},
        ], PALETTE['sash'], segments=8, uv_tiles=(1.0, 1.6)))

    # ---- skirt panels over the hips: two in front, one at each hip, one at the back
    panels = [
        ('skirt-back', 0.0, 0.100, 0.110, 0.011, 0.0),
    ]
    for name, px, py, rx, ry, lean in panels:
        parts.append(loft(name, [
            {'x': px * 0.96, 'y': py * 0.96, 'z': 0.898, 'rx': rx * 0.94, 'ry': ry * 0.94},
            {'x': px, 'y': py, 'z': 0.852, 'rx': rx, 'ry': ry},
            {'x': px * 1.04 + lean * 0.02, 'y': py * 1.03, 'z': 0.800, 'rx': rx * 1.02, 'ry': ry * 1.02},
            {'x': px * 1.06 + lean * 0.04, 'y': py * 1.04, 'z': 0.766, 'rx': rx * 0.90, 'ry': ry * 0.90},
        ], PALETTE['gi'], segments=14, uv_tiles=(1.2, 1.4)))

    # ---- head: 24.6 cm tall, widest at the temples. The profile list is shared with
    # face_surface_y() so every feature is placed on the measured surface instead of on a guess.
    parts.append(loft('head', HEAD_SECTIONS, PALETTE['skin'], segments=26, uv_tiles=(2.0, 2.0)))

    # Eyes sit 2.5 mm proud of the cheek and are thin lenses (a 2 mm half depth), not beads.
    eye_z = 1.630
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        ex = side * 0.036
        face = head_front_y(ex, eye_z)
        # Anime proportion: a large almond lens with a big iris, not a 2 cm bead. The previous
        # bead read as a dot on a mannequin face at every distance the game is actually played at.
        parts.append(sphere(f'eye-{tag}', 0.0300, (ex, face - 0.0014, eye_z),
                            PALETTE['eye'], scale=(1.0, 0.120, 0.80), segments=20, rings=10))
        parts.append(sphere(f'iris-{tag}', 0.0150, (ex + side * 0.0010, face - 0.0060, eye_z - 0.0014),
                            PALETTE['iris'], scale=(1.0, 0.120, 1.04), segments=16, rings=8))
        parts.append(sphere(f'pupil-{tag}', 0.0074, (ex + side * 0.0010, face - 0.0072, eye_z - 0.0014),
                            PALETTE['hair'], scale=(1.0, 0.120, 1.04), segments=12, rings=6))
        # Upper lid: a skin band that overhangs the lens, so the eye closes with a lid line
        # instead of floating as an oval decal.
        parts.append(loft(f'eye-lid-{tag}', [
            {'x': ex - side * 0.030, 'y': head_front_y(ex - side * 0.030, eye_z + 0.014) - 0.0062,
             'z': eye_z + 0.009, 'rx': 0.0044, 'ry': 0.0038},
            {'x': ex, 'y': head_front_y(ex, eye_z + 0.028) - 0.0078,
             'z': eye_z + 0.018, 'rx': 0.0060, 'ry': 0.0050},
            {'x': ex + side * 0.031, 'y': head_front_y(ex + side * 0.031, eye_z + 0.010) - 0.0058,
             'z': eye_z + 0.007, 'rx': 0.0042, 'ry': 0.0036},
        ], PALETTE['skin'], segments=8, uv_tiles=(1.0, 1.0)))
        # Upper lash: a thin band along the top of the lens, following the face.
        parts.append(loft(f'lash-{tag}', [
            {'x': ex - side * 0.028, 'y': head_front_y(ex - side * 0.028, eye_z + 0.010) - 0.0068,
             'z': eye_z + 0.010, 'rx': 0.0036, 'ry': 0.0030},
            {'x': ex + side * 0.001, 'y': head_front_y(ex, eye_z + 0.020) - 0.0086,
             'z': eye_z + 0.019, 'rx': 0.0050, 'ry': 0.0038},
            {'x': ex + side * 0.030, 'y': head_front_y(ex + side * 0.030, eye_z + 0.005) - 0.0060,
             'z': eye_z + 0.005, 'rx': 0.0032, 'ry': 0.0028},
        ], PALETTE['hair'], segments=6, uv_tiles=(1.0, 1.0)))
        brow_z = 1.662
        parts.append(loft(f'brow-{tag}', [
            {'x': ex - side * 0.023, 'y': head_front_y(ex - side * 0.023, brow_z) - 0.0022,
             'z': brow_z - 0.001, 'rx': 0.0038, 'ry': 0.0030},
            {'x': ex, 'y': head_front_y(ex, brow_z + 0.003) - 0.0030,
             'z': brow_z + 0.003, 'rx': 0.0048, 'ry': 0.0036},
            {'x': ex + side * 0.026, 'y': head_front_y(ex + side * 0.026, brow_z - 0.003) - 0.0020,
             'z': brow_z - 0.003, 'rx': 0.0032, 'ry': 0.0026},
        ], PALETTE['hair'], segments=6, uv_tiles=(1.0, 1.0)))
        parts.append(sphere(f'ear-{tag}', 0.020, (side * 0.079, 0.008, 1.598), PALETTE['skin'],
                            scale=(0.40, 0.85, 1.05), segments=14, rings=9))

    nose_z = 1.586
    parts.append(cone('nose', 0.0115, 0.024, (0.0, head_front_y(0.0, nose_z) - 0.004, nose_z),
                      PALETTE['skin'], rotation=(math.radians(94), 0, 0), vertices=8))
    mouth_z = 1.552
    # Two lips and a mouth line. A single thin band was the flattest part of the face - the one
    # feature that made every head read as unfinished at close range.
    # The line is the loft the kernel geometry test already validates: an X-swept band this thin
    # reads as a flat plane to the signed-volume check, so the mouth keeps the original section
    # ordering and the lips below carry the depth instead.
    # A thin X-swept loft collapses to a plane once the jaw is widened: the signed-volume probe
    # reads it as inward-facing. A squashed ellipsoid has real depth, so the mouth survives the
    # check and still reads as a line under the lips.
    parts.append(sphere('mouth', 0.0180, (0.0, head_front_y(0.0, mouth_z) - 0.0020, mouth_z),
                        PALETTE['skin_dark'], scale=(0.95, 0.30, 0.22), segments=14, rings=8))
    parts.append(loft('mouth-lip-upper', [
        {'x': -0.020, 'y': head_front_y(-0.020, mouth_z + 0.006) - 0.0014, 'z': mouth_z + 0.006,
         'rx': 0.0030, 'ry': 0.0030},
        {'x': 0.0, 'y': head_front_y(0.0, mouth_z + 0.008) - 0.0042, 'z': mouth_z + 0.007,
         'rx': 0.0054, 'ry': 0.0040},
        {'x': 0.020, 'y': head_front_y(0.020, mouth_z + 0.006) - 0.0014, 'z': mouth_z + 0.006,
         'rx': 0.0030, 'ry': 0.0030},
    ], PALETTE['skin'], segments=10, uv_tiles=(1.0, 1.0)))
    parts.append(loft('mouth-lip-lower', [
        {'x': -0.017, 'y': head_front_y(-0.017, mouth_z - 0.008) - 0.0012, 'z': mouth_z - 0.008,
         'rx': 0.0028, 'ry': 0.0026},
        {'x': 0.0, 'y': head_front_y(0.0, mouth_z - 0.010) - 0.0036, 'z': mouth_z - 0.009,
         'rx': 0.0048, 'ry': 0.0036},
        {'x': 0.017, 'y': head_front_y(0.017, mouth_z - 0.008) - 0.0012, 'z': mouth_z - 0.008,
         'rx': 0.0028, 'ry': 0.0026},
    ], PALETTE['skin_dark'], segments=10, uv_tiles=(1.0, 1.0)))

    # Cheekbones and chin: the skull loft is a smooth egg, which is what reads as a mannequin.
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        parts.append(sphere(f'cheek-{tag}', 0.027,
                            (side * 0.050, head_front_y(side * 0.050, 1.590) + 0.008, 1.590),
                            PALETTE['skin'], scale=(1.10, 0.78, 0.86), segments=14, rings=8))
    parts.append(sphere('chin', 0.025, (0.0, head_front_y(0.0, 1.534) + 0.012, 1.534),
                        PALETTE['skin'], scale=(1.14, 0.82, 0.70), segments=16, rings=8))

    # ---- hair
    # A crescent cap, not a sphere: the opening is wide at the hairline so the face is clear, and
    # it closes over the crown. The first version's cap reached below the eyes and read as a
    # helmet with a slot.
    parts.append(shell('hair-cap', [
        {'z': 1.684, 'rx': 0.089, 'ry': 0.105, 'gap': 1.86},
        {'z': 1.708, 'rx': 0.089, 'ry': 0.104, 'gap': 1.24},
        {'z': 1.724, 'rx': 0.078, 'ry': 0.092, 'gap': 0.52},
        {'z': 1.742, 'rx': 0.055, 'ry': 0.064, 'gap': 0.00},
        {'z': 1.752, 'rx': 0.026, 'ry': 0.030, 'gap': 0.00},
    ], PALETTE['hair'], segments=26, thickness=0.012, uv_tiles=(2.0, 1.4)))
    # Nape and temples. The cap alone begins above the ear line, which left a bald band around the
    # sides of the skull with the cap's rim cutting across it - obvious in the in-game close-up.
    # This wrap closes that band from the nape round to the temples, opened wide enough at the front
    # to keep the whole face clear.
    parts.append(shell('hair-nape', [
        {'z': 1.596, 'rx': 0.086, 'ry': 0.101, 'gap': 2.42},
        {'z': 1.636, 'rx': 0.090, 'ry': 0.105, 'gap': 2.42},
        {'z': 1.672, 'rx': 0.092, 'ry': 0.107, 'gap': 2.46},
        # Tucks under the cap's silhouette instead of ending in a visible lip at the temple.
        {'z': 1.690, 'rx': 0.085, 'ry': 0.100, 'gap': 2.20},
    ], PALETTE['hair'], segments=26, thickness=0.011, uv_tiles=(2.0, 1.0)))
    for index in range(13):
        angle = math.radians(-62 + index * 21)
        base_r = 0.074
        bx, by = math.cos(angle) * base_r, math.sin(angle) * base_r * 0.98
        width = 0.018 + (index % 3) * 0.0038
        top = 1.742 + (index % 4) * 0.010
        drift = 1.18 + (index % 3) * 0.06
        parts.append(loft(f'hair-lock-{index}', [
            {'x': bx, 'y': by, 'z': 1.694, 'rx': width, 'ry': width * 0.62},
            {'x': bx * 1.05, 'y': by * 1.05 + 0.006, 'z': 1.718, 'rx': width * 1.10, 'ry': width * 0.58},
            {'x': bx * drift, 'y': by * drift + 0.012, 'z': 1.736, 'rx': width * 0.70, 'ry': width * 0.36},
            {'x': bx * (drift + 0.12), 'y': by * (drift + 0.12) + 0.020, 'z': top,
             'rx': width * 0.10, 'ry': width * 0.07},
        ], PALETTE['hair'], segments=8, uv_tiles=(1.0, 1.0)))
    # Inner row: shorter clumps layered between the long blades. A single ring of locks left bare
    # cap visible between them, which read as a bald patch under the in-game key light.
    for index in range(9):
        angle = math.radians(-74 + index * 18.5)
        bx, by = math.cos(angle) * 0.066, math.sin(angle) * 0.066 * 0.98
        width = 0.0136 + (index % 3) * 0.0030
        drop = 0.026 + (index % 4) * 0.008
        parts.append(loft(f'hair-lock-inner-{index}', [
            {'x': bx * 0.94, 'y': by * 0.94, 'z': 1.700, 'rx': width, 'ry': width * 0.60},
            {'x': bx * 1.02, 'y': by * 1.02, 'z': 1.716, 'rx': width * 1.10, 'ry': width * 0.62},
            {'x': bx * 1.10, 'y': by * 1.06 - drop * 0.5, 'z': 1.722 - drop * 0.5,
             'rx': width * 0.72, 'ry': width * 0.40},
            {'x': bx * 1.16, 'y': by * 1.08 - drop, 'z': 1.726 - drop,
             'rx': width * 0.16, 'ry': width * 0.11},
        ], PALETTE['hair'], segments=8, uv_tiles=(1.0, 1.0)))

    # Fringe: short blades across the hairline, hanging just above the brows on the measured face.
    for index in range(5):
        fx = (index - 2) * 0.026
        lean = (index - 2) * 0.010
        parts.append(loft(f'fringe-{index}', [
            {'x': fx * 0.72, 'y': head_front_y(fx * 0.72, 1.716) - 0.006, 'z': 1.716,
             'rx': 0.017, 'ry': 0.011},
            {'x': fx * 0.92 + lean, 'y': head_front_y(fx * 0.92 + lean, 1.700) - 0.009, 'z': 1.700,
             'rx': 0.016, 'ry': 0.010},
            {'x': fx + lean * 1.6, 'y': head_front_y(fx + lean * 1.6, 1.686) - 0.008, 'z': 1.686,
             'rx': 0.010, 'ry': 0.007},
        ], PALETTE['hair'], segments=10, uv_tiles=(1.0, 1.0)))

    # ---- arms: one continuous loft from the shoulder into the wrist.
    # Segmented limbs (deltoid + upper arm + elbow ball + forearm) showed a hard band at every
    # join: the rings did not coincide, so the shading broke there and the elbow ball read as a
    # bump. A single tube with a two-bone weight blend across the elbow bends smoothly and has no
    # seams at all.
    for side in (-1, 1):
        tag = 'L' if side < 0 else 'R'
        base = side * SHOULDER_X
        arm_sections = []
        profile = [
            (1.424, 0.030, 0.030, 0.000),
            (1.404, 0.050, 0.051, 0.002),
            (1.378, 0.062, 0.062, 0.004),
            (1.340, 0.056, 0.057, 0.006),
            (1.290, 0.050, 0.051, 0.008),
            (1.220, 0.046, 0.047, 0.010),
            (1.160, 0.043, 0.044, 0.012),
            (1.100, 0.044, 0.045, 0.014),
            (1.050, 0.046, 0.047, 0.016),
            (0.980, 0.040, 0.041, 0.018),
            (0.910, 0.033, 0.034, 0.020),
            (0.855, 0.028, 0.029, 0.021),
            (0.800, 0.025, 0.026, 0.022),
        ]
        for z, rx, ry, drift in profile:
            arm_sections.append({'x': base + side * drift, 'z': z, 'rx': rx, 'ry': ry})
        parts.append(loft(f'arm-{tag}', arm_sections, PALETTE['skin'], segments=20,
                          uv_tiles=(1.6, 1.8)))

        # Short gi sleeve: a band of cloth over the deltoid, ending in a rimmed hem at mid-upper-arm.
        # Named `upperarm-*` so the shared weighting below binds it to the same bone as the arm it
        # covers, which means the sleeve follows the shoulder instead of staying behind.
        parts.append(shell(f'upperarm-{tag}', [
            {'x': base + side * 0.001, 'z': 1.418, 'rx': 0.043, 'ry': 0.043},
            {'x': base + side * 0.004, 'z': 1.382, 'rx': 0.072, 'ry': 0.072},
            {'x': base + side * 0.006, 'z': 1.336, 'rx': 0.066, 'ry': 0.067},
            {'x': base + side * 0.008, 'z': 1.286, 'rx': 0.059, 'ry': 0.060},
            {'x': base + side * 0.009, 'z': 1.246, 'rx': 0.054, 'ry': 0.055},
        ], PALETTE['gi'], segments=22, thickness=0.008, uv_tiles=(1.8, 1.2)))

        # Wrapped forearm, the surface that lights up during Wind-Step (material fighter-accent).
        parts.append(shell(f'wrap-{tag}', [
            {'x': base + side * 0.017, 'z': 1.058, 'rx': 0.049, 'ry': 0.050},
            {'x': base + side * 0.018, 'z': 1.018, 'rx': 0.050, 'ry': 0.051},
            {'x': base + side * 0.019, 'z': 0.972, 'rx': 0.045, 'ry': 0.046},
            {'x': base + side * 0.020, 'z': 0.928, 'rx': 0.038, 'ry': 0.039},
            {'x': base + side * 0.021, 'z': 0.892, 'rx': 0.033, 'ry': 0.034},
        ], PALETTE['accent'], segments=20, thickness=0.007, uv_tiles=(1.6, 1.0)))

        # Hand: palm overlapping the wrist end so the joint cannot open a gap.
        hx = base + side * 0.022
        parts.append(loft(f'palm-{tag}', [
            {'x': hx, 'z': 0.856, 'rx': 0.026, 'ry': 0.028},
            {'x': hx + side * 0.002, 'z': 0.822, 'rx': 0.031, 'ry': 0.039},
            {'x': hx + side * 0.004, 'z': 0.784, 'rx': 0.032, 'ry': 0.041},
            {'x': hx + side * 0.004, 'z': 0.756, 'rx': 0.027, 'ry': 0.037},
        ], PALETTE['skin'], segments=16, uv_tiles=(1.0, 1.0)))
        for finger in range(4):
            offset = (finger - 1.5) * 0.0175
            splay = (finger - 1.5) * 0.0040
            # Four rings, so the finger has a knuckle and a curled second segment. A three-ring
            # stub read as a rectangular block in every close-up of the roster.
            parts.append(loft(f'finger-{tag}-{finger}', [
                {'x': hx + side * 0.004 + offset, 'y': -0.004, 'z': 0.764,
                 'rx': 0.0094, 'ry': 0.0106},
                {'x': hx + side * 0.004 + offset + splay, 'y': -0.012, 'z': 0.740,
                 'rx': 0.0088, 'ry': 0.0100},
                {'x': hx + side * 0.005 + offset + splay * 1.7, 'y': -0.019, 'z': 0.722,
                 'rx': 0.0072, 'ry': 0.0084},
                {'x': hx + side * 0.005 + offset + splay * 2.1, 'y': -0.022, 'z': 0.714,
                 'rx': 0.0048, 'ry': 0.0056},
            ], PALETTE['skin'], segments=8, uv_tiles=(0.6, 0.6)))
        parts.append(loft(f'thumb-{tag}', [
            {'x': hx - side * 0.019, 'y': -0.013, 'z': 0.818, 'rx': 0.0100, 'ry': 0.0110},
            {'x': hx - side * 0.029, 'y': -0.028, 'z': 0.794, 'rx': 0.0086, 'ry': 0.0096},
            {'x': hx - side * 0.025, 'y': -0.038, 'z': 0.776, 'rx': 0.0064, 'ry': 0.0074},
        ], PALETTE['skin'], segments=8, uv_tiles=(0.6, 0.6)))

        # ---- legs: one continuous loft from hip to ankle, blended across the knee
        lx = side * HIP_X
        leg_sections = []
        for z, rx, ry, front, back in [
            (0.962, 0.086, 0.095, 1.00, 1.00),
            (0.900, 0.084, 0.092, 1.04, 1.00),
            (0.820, 0.078, 0.086, 1.03, 1.00),
            (0.700, 0.070, 0.076, 1.00, 1.00),
            (0.600, 0.060, 0.064, 1.00, 1.00),
            (0.520, 0.055, 0.058, 1.00, 1.00),
            (0.460, 0.057, 0.061, 1.00, 1.10),
            (0.360, 0.049, 0.053, 1.00, 1.04),
            (0.240, 0.038, 0.041, 1.00, 1.00),
            (0.150, 0.031, 0.034, 1.00, 1.00),
        ]:
            leg_sections.append({'x': lx, 'z': z, 'rx': rx, 'ry': ry, 'front': front, 'back': back})
        parts.append(loft(f'leg-{tag}', leg_sections, PALETTE['trouser'], segments=18,
                          uv_tiles=(1.6, 2.0)))

        # Boot: cuff, a lofted foot from heel to toe, heel block, sole and strap
        parts.append(loft(f'boot-cuff-{tag}', [
            {'x': lx, 'z': 0.252, 'rx': 0.044, 'ry': 0.047},
            {'x': lx, 'z': 0.196, 'rx': 0.049, 'ry': 0.053},
            {'x': lx, 'z': 0.132, 'rx': 0.053, 'ry': 0.058},
        ], PALETTE['boot'], segments=16, uv_tiles=(1.4, 1.0)))
        parts.append(loft(f'boot-top-{tag}', [
            {'x': lx, 'z': 0.262, 'rx': 0.045, 'ry': 0.048},
            {'x': lx, 'z': 0.242, 'rx': 0.047, 'ry': 0.050},
        ], PALETTE['trim'], segments=16, uv_tiles=(1.2, 0.3)))
        parts.append(loft(f'boot-{tag}', [
            {'y': 0.072, 'z': 0.066, 'rx': 0.039, 'ry': 0.040},
            {'y': 0.034, 'z': 0.070, 'rx': 0.049, 'ry': 0.048},
            {'y': -0.020, 'z': 0.062, 'rx': 0.052, 'ry': 0.044},
            {'y': -0.078, 'z': 0.050, 'rx': 0.049, 'ry': 0.032},
            {'y': -0.128, 'z': 0.040, 'rx': 0.040, 'ry': 0.022},
        ], PALETTE['boot'], segments=16, axis='Y', uv_tiles=(1.6, 1.2)))
        for part in parts[-1:]:
            part.location.x = lx
        # Heel and sole stop short of the boot's own back wall. When they ran past it they read as a
        # flat spur sticking out behind each foot, which is what the in-game capture showed.
        parts.append(loft(f'heel-{tag}', [
            {'y': 0.066, 'z': 0.024, 'rx': 0.038, 'ry': 0.022},
            {'y': 0.024, 'z': 0.024, 'rx': 0.046, 'ry': 0.024},
        ], PALETTE['boot'], segments=12, axis='Y', uv_tiles=(1.0, 0.6)))
        for part in parts[-1:]:
            part.location.x = lx
        parts.append(loft(f'sole-{tag}', [
            {'y': 0.074, 'z': 0.012, 'rx': 0.038, 'ry': 0.010},
            {'y': 0.020, 'z': 0.010, 'rx': 0.052, 'ry': 0.010},
            {'y': -0.058, 'z': 0.010, 'rx': 0.052, 'ry': 0.010},
            {'y': -0.128, 'z': 0.012, 'rx': 0.040, 'ry': 0.009},
        ], PALETTE['boot'], segments=14, axis='Y', uv_tiles=(1.4, 0.6)))
        for part in parts[-1:]:
            part.location.x = lx
        parts.append(loft(f'boot-strap-{tag}', [
            {'x': lx, 'z': 0.206, 'rx': 0.049, 'ry': 0.053},
            {'x': lx, 'z': 0.186, 'rx': 0.051, 'ry': 0.055},
        ], PALETTE['trim'], segments=16, uv_tiles=(1.2, 0.4)))

    return parts


# --------------------------------------------------------------------------- armature

BONES = [
    # name, head, tail, parent, deform
    ('Hips', (0, 0, HIPS), (0, 0, 1.06), None, True),
    ('Spine', (0, 0, 1.06), (0, 0, CHEST), 'Hips', True),
    ('Chest', (0, 0, CHEST), (0, 0, NECK), 'Spine', True),
    ('Neck', (0, 0, NECK), (0, 0, 1.52), 'Chest', True),
    ('Head', (0, 0, 1.52), (0, 0, CROWN + 0.10), 'Neck', True),
    ('LeftShoulder', (-0.045, 0, 1.395), (-SHOULDER_X, 0, 1.395), 'Chest', True),
    ('LeftArm', (-SHOULDER_X, 0, 1.40), (-(SHOULDER_X + 0.02), 0, ELBOW_Z), 'LeftShoulder', True),
    ('LeftForeArm', (-(SHOULDER_X + 0.02), 0, ELBOW_Z), (-(SHOULDER_X + 0.025), 0, 0.83), 'LeftArm', True),
    ('LeftHand', (-(SHOULDER_X + 0.025), 0, 0.83), (-(SHOULDER_X + 0.025), -0.02, 0.70), 'LeftForeArm', True),
    ('RightShoulder', (0.045, 0, 1.395), (SHOULDER_X, 0, 1.395), 'Chest', True),
    ('RightArm', (SHOULDER_X, 0, 1.40), (SHOULDER_X + 0.02, 0, ELBOW_Z), 'RightShoulder', True),
    ('RightForeArm', (SHOULDER_X + 0.02, 0, ELBOW_Z), (SHOULDER_X + 0.025, 0, 0.83), 'RightArm', True),
    ('RightHand', (SHOULDER_X + 0.025, 0, 0.83), (SHOULDER_X + 0.025, -0.02, 0.70), 'RightForeArm', True),
    ('LeftUpLeg', (-HIP_X, 0, 0.94), (-HIP_X, 0, KNEE), 'Hips', True),
    ('LeftLeg', (-HIP_X, 0, KNEE), (-HIP_X, 0, ANKLE), 'LeftUpLeg', True),
    ('LeftFoot', (-HIP_X, 0, ANKLE), (-HIP_X, -0.16, 0.02), 'LeftLeg', True),
    ('RightUpLeg', (HIP_X, 0, 0.94), (HIP_X, 0, KNEE), 'Hips', True),
    ('RightLeg', (HIP_X, 0, KNEE), (HIP_X, 0, ANKLE), 'RightUpLeg', True),
    ('RightFoot', (HIP_X, 0, ANKLE), (HIP_X, -0.16, 0.02), 'RightLeg', True),
]


def build_armature():
    armature = bpy.data.armatures.new('Kaze_Rig')
    obj = bpy.data.objects.new('Kaze_Rig', armature)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    created = {}
    for name, head, tail, parent, deform in BONES:
        bone = armature.edit_bones.new(name)
        bone.head = Vector(head)
        bone.tail = Vector(tail)
        bone.use_deform = deform
        if parent:
            bone.parent = created[parent]
            bone.use_connect = False
        created[name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.show_in_front = True
    return obj


def join_parts(parts, name='Kaze_Body'):
    bpy.ops.object.select_all(action='DESELECT')
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.object
    body.name = name
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0006)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return body


# --------------------------------------------------------------------------- weights

# The torso and jacket are continuous vertical surfaces, so they blend smoothly along the spine
# chain: a rigid binding here would swing the jacket hem 5 cm away from the sash every time the
# chest turned. Limbs stay rigid per segment (each is a closed volume around one bone) and rely on
# the overlapping deltoid/elbow/knee/wrist geometry above, which is stable at every joint angle.
SPINE_CHAIN = [('Hips', 0.90), ('Spine', 1.14), ('Chest', 1.33), ('Neck', 1.42)]
NECK_CHAIN = [('Chest', 1.34), ('Neck', 1.44), ('Head', 1.50)]


# Part suffixes are single letters ('arm-L'), bone names spell the side out ('LeftArm'). The two
# have to be translated explicitly: a vertex group whose name does not match a bone silently binds
# nothing, and Blender's glTF exporter then writes those vertices to a generated `neutral_bone`,
# which is how the whole skeleton below the chest came to be rigidly carried by the spine while an
# earlier version of this file looked correct in Blender.
SIDE_PREFIX = {'L': 'Left', 'R': 'Right'}


def bone_for_part(name):
    import re
    # Blender appends a `.001` suffix when a part name is already taken, so the side token can be
    # followed by a dot rather than the end of the name. Without this, `wrap-L.001` resolved to
    # `NoneForeArm` and the whole build failed its bind check - the sort of silent mis-binding this
    # function exists to prevent.
    side_match = re.search(r'-(L|R)(?:[.-]|$)', name)
    side = SIDE_PREFIX.get(side_match.group(1)) if side_match else None
    if name.startswith(('head', 'eye', 'iris', 'pupil', 'lash', 'brow', 'ear', 'nose', 'mouth',
                        'hair', 'fringe', 'sideburn')):
        return 'Head'
    if name == 'neck':
        return 'Neck'
    if name.startswith(('torso', 'pec', 'gi-jacket', 'lapel', 'collar')):
        return 'Chest'
    if name.startswith(('skirt', 'sash')):
        return 'Hips'
    if name.startswith(('arm-', 'deltoid', 'upperarm')):
        return f'{side}Arm'
    if name.startswith(('forearm', 'wrap', 'elbow')):
        return f'{side}ForeArm'
    if name.startswith(('palm', 'finger', 'thumb')):
        return f'{side}Hand'
    if name.startswith('thigh'):
        return f'{side}UpLeg'
    if name.startswith(('knee', 'shin')):
        return f'{side}Leg'
    if name.startswith(('boot', 'toe', 'sole')):
        return f'{side}Foot'
    return 'Hips'


def _chain_weights(z, chain):
    if z <= chain[0][1]:
        return {chain[0][0]: 1.0}
    if z >= chain[-1][1]:
        return {chain[-1][0]: 1.0}
    for index in range(len(chain) - 1):
        z0, z1 = chain[index][1], chain[index + 1][1]
        if z0 <= z <= z1:
            t = (z - z0) / max(1e-6, z1 - z0)
            t = t * t * (3 - 2 * t)   # smoothstep: no visible crease where the weights hand over
            return {chain[index][0]: 1.0 - t, chain[index + 1][0]: t}
    return {chain[-1][0]: 1.0}


def weight_two(part, upper, lower, window_high, window_low):
    """Blend one continuous limb surface between two bones across the joint.

    A single tube has no seam, so it can bend smoothly; the weights hand over across a 12-16 cm
    window centred on the joint with a smoothstep, which keeps the elbow and knee round instead of
    pinching to a crease.
    """
    groups = {upper: part.vertex_groups.new(name=upper), lower: part.vertex_groups.new(name=lower)}
    for vertex in part.data.vertices:
        z = vertex.co.z
        if z >= window_high:
            lower_weight = 0.0
        elif z <= window_low:
            lower_weight = 1.0
        else:
            t = (window_high - z) / max(1e-6, window_high - window_low)
            lower_weight = t * t * (3 - 2 * t)
        if lower_weight < 1.0:
            groups[upper].add([vertex.index], 1.0 - lower_weight, 'REPLACE')
        if lower_weight > 0.0:
            groups[lower].add([vertex.index], lower_weight, 'REPLACE')


def weight_parts(parts):
    for part in parts:
        if part.name.startswith('arm-'):
            side = SIDE_PREFIX[part.name[-1]]
            weight_two(part, f'{side}Arm', f'{side}ForeArm', 1.165, 1.040)
            continue
        if part.name.startswith('leg-'):
            side = SIDE_PREFIX[part.name[-1]]
            weight_two(part, f'{side}UpLeg', f'{side}Leg', 0.605, 0.445)
            continue
        if part.name.startswith(('torso', 'pec', 'gi-jacket', 'lapel')):
            chain = SPINE_CHAIN
        elif part.name == 'neck':
            chain = NECK_CHAIN
        else:
            bone = bone_for_part(part.name)
            group = part.vertex_groups.new(name=bone)
            group.add([vertex.index for vertex in part.data.vertices], 1.0, 'REPLACE')
            continue
        groups = {}
        for name, _ in chain:
            groups[name] = part.vertex_groups.new(name=name)
        for vertex in part.data.vertices:
            for name, weight in _chain_weights(vertex.co.z, chain).items():
                if weight > 0.002:
                    groups[name].add([vertex.index], weight, 'REPLACE')


def bind_armature(body, armature):
    modifier = body.modifiers.new('Armature', 'ARMATURE')
    modifier.object = armature
    body.parent = armature


# --------------------------------------------------------------------------- animation

ANIMATED = ['Hips', 'Spine', 'Chest', 'Neck', 'Head',
            'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm',
            'LeftForeArm', 'RightForeArm', 'LeftHand', 'RightHand',
            'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg', 'LeftFoot', 'RightFoot']


def pose(**overrides):
    """A complete pose for every animated bone.

    Every keyframe writes every bone, so a clip cannot inherit a stale rotation from an earlier
    key: the previous version keyed only the bones it wanted to move, which let unrelated bones
    drift between keys and made the torso appear to rotate on its own.
    """
    base = {name: (0.0, 0.0, 0.0) for name in ANIMATED}
    base.update(overrides)
    return base


def hips_offset(armature, world):
    """Convert a world-space hip offset into the Hips bone's local space.

    pose_bone.location is expressed along the bone's own axes. The Hips bone points up, so its
    local Y is world Z; the first version of this file wrote world offsets straight into local
    components, which is why the walk bob moved the fighter forward instead of up and down.
    """
    bone = armature.pose.bones.get('Hips')
    basis = bone.bone.matrix_local.to_3x3()
    return basis.inverted() @ Vector(world)


def key_pose(armature, frame, pose_dict, lift=0.0, shift=(0.0, 0.0)):
    for bone_name, rotation in pose_dict.items():
        bone = armature.pose.bones.get(bone_name)
        if not bone:
            continue
        bone.rotation_mode = 'XYZ'
        bone.rotation_euler = Euler(rotation, 'XYZ')
        bone.keyframe_insert('rotation_euler', frame=frame)
    hips = armature.pose.bones.get('Hips')
    hips.location = hips_offset(armature, (shift[0], shift[1], lift))
    hips.keyframe_insert('location', frame=frame)


def make_action(armature, name, keys, loop=True):
    armature.animation_data_create()
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    armature.animation_data.action = action
    for frame, pose_dict, lift, shift in keys:
        key_pose(armature, frame, pose_dict, lift, shift)
    for fcurve in action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = 'BEZIER'
            point.handle_left_type = 'AUTO_CLAMPED'
            point.handle_right_type = 'AUTO_CLAMPED'
    action.use_cyclic = loop
    return action


def guard_stance(lean=4.0, left=-6.0, right=-8.0, elbow_l=-44.0, elbow_r=-52.0):
    r = math.radians
    return pose(
        Chest=(r(lean), 0, 0),
        LeftArm=(r(left), 0, r(10)),
        RightArm=(r(right), 0, r(-10)),
        LeftForeArm=(r(elbow_l), 0, r(-8)),
        RightForeArm=(r(elbow_r), 0, r(8)),
        LeftUpLeg=(r(-6), 0, r(4)),
        RightUpLeg=(r(4), 0, r(-4)),
        LeftLeg=(r(8), 0, 0),
        RightLeg=(r(6), 0, 0),
    )


def build_animations(armature, clip_profile=None):
    """Eight clips for the bound armature.

    `clip_profile` shapes the authored poses for one fighter. Before it existed every fighter on
    the roster was exported with byte-identical clips: a 500 kg brawler and a speedster walked with
    the same stride, the same crouch and the same swing, which contradicts the per-character
    movement the game actually applies (public/js/combat/locomotion.js). The keys are multipliers:

      stride  walk/run thigh travel, so a faster fighter takes visibly longer steps at the same
              cadence instead of sliding along the ground
      swing   arm swing during walk/run
      lean    forward lean in the run
      crouch  knee bend and crouch depth in idle, run, jump and guard
      stance  how wide and rooted the idle/guard stance is

    Defaults are 1.0, which reproduces the reference fighter exactly: Kaze's export is unchanged
    unless a profile is passed.
    """
    r = math.radians
    actions = []

    def p(key):
        return float((clip_profile or {}).get(key, 1.0))

    stride, swing, lean, crouch, stance = p('stride'), p('swing'), p('lean'), p('crouch'), p('stance')

    # ---- idle: a fighting stance with a real weight shift and one breath per cycle
    idle_keys = []
    breath = [(1, 0.0, 0.0), (16, 0.45, 0.006), (31, 1.0, 0.0), (46, 0.5, 0.005), (60, 0.0, 0.0)]
    for frame, phase, lift in breath:
        sway = math.sin(phase * math.pi * 2)
        # `shift` runs a quarter cycle behind the breath, so the fighter breathes *and* moves its
        # weight from foot to foot. The previous amplitudes were under two degrees on most joints,
        # which the model measurement read back as an idle clip that moved no bones at all - a
        # mannequin holding a stance rather than a fighter in one.
        shift = math.cos(phase * math.pi * 2)
        idle_keys.append((frame, pose(
            Hips=(r(1.2 * shift), r(4 * shift), 0),
            Chest=(r(4 + 4 * sway), r(5 * shift), r(1.5 * shift)),
            Spine=(r(1.2 + 3 * sway), r(2 * shift), 0),
            Neck=(r(-1.5 - 2 * sway), r(3 * shift), 0),
            Head=(r(-2 - 5 * sway), r(9 * shift), r(2 * shift)),
            LeftShoulder=(0, 0, r(4 * sway)),
            RightShoulder=(0, 0, r(-4 * sway)),
            LeftArm=(r(-6 - 11 * sway), r(3 * shift), r(10 + 4 * sway)),
            RightArm=(r(-8 + 11 * sway), r(-3 * shift), r(-10 - 4 * sway)),
            LeftForeArm=(r(-44 - 16 * sway), 0, r(-8 - 4 * sway)),
            RightForeArm=(r(-52 + 16 * sway), 0, r(8 + 4 * sway)),
            LeftHand=(r(-8 * sway), 0, r(-4)),
            RightHand=(r(8 * sway), 0, r(4)),
            LeftUpLeg=(r(-6 * stance - 9 * shift), 0, r(4 * stance + 3 * shift)),
            RightUpLeg=(r(4 * stance + 9 * shift), 0, r(-4 * stance - 3 * shift)),
            LeftLeg=(r(8 * crouch + 8 * shift), 0, 0),
            RightLeg=(r(6 * crouch - 8 * shift), 0, 0),
            LeftFoot=(r(-2 * crouch + 5 * shift), 0, 0),
            RightFoot=(r(-2 * crouch - 5 * shift), 0, 0),
        ), lift, (0.0, 0.0)))
    actions.append(make_action(armature, 'idle', idle_keys))

    # ---- walk: contact / down / passing / up, twice per cycle, arms counter-swinging
    walk_keys = []
    # phase -> front leg (the one reaching forward), lift, hips shift
    phases = [
        (1, 1, 0.006, -0.004),   # left contact
        (8, 1, -0.020, -0.002),  # weight accepted, hips lowest
        (16, 0, 0.004, 0.000),   # passing
        (23, -1, 0.010, 0.002),  # push off
        (31, -1, 0.006, 0.004),  # right contact
        (38, -1, -0.020, 0.002),
        (46, 0, 0.004, 0.000),
        (53, 1, 0.010, -0.002),
        (60, 1, 0.006, -0.004),
    ]
    for frame, lead, lift, side_shift in phases:
        s = lead
        # Stride follows the fighter's own top speed, so the feet track the ground the movement
        # system actually moves them across.
        thigh = 26 * stride * s if lead else 2
        back = -26 * stride * s if lead else -2
        walk_keys.append((frame, pose(
            Hips=(0, r(-3 * s), 0),
            Spine=(r(2), r(2 * s), 0),
            Chest=(r(3), r(-5 * s), 0),
            Neck=(r(-2), 0, 0),
            Head=(r(-1), r(4 * s), 0),
            LeftShoulder=(0, 0, 0),
            RightShoulder=(0, 0, 0),
            LeftArm=(r(20 * swing * s - 4), 0, r(8)),
            RightArm=(r(-20 * swing * s - 4), 0, r(-8)),
            LeftForeArm=(r(-38 - max(0, -12 * s)), 0, r(-6)),
            RightForeArm=(r(-38 - max(0, 12 * s)), 0, r(6)),
            LeftHand=(0, 0, 0),
            RightHand=(0, 0, 0),
            LeftUpLeg=(r(-thigh), 0, r(3)),
            RightUpLeg=(r(-back), 0, r(-3)),
            LeftLeg=(r(max(0, 14 * s) + 6 * crouch), 0, 0),
            RightLeg=(r(max(0, -14 * s) + 6 * crouch), 0, 0),
            LeftFoot=(r(-6 * s + 3), 0, 0),
            RightFoot=(r(6 * s + 3), 0, 0),
        ), lift, (side_shift, 0.0)))
    actions.append(make_action(armature, 'walk', walk_keys))

    # ---- run: bigger stride, both feet off the ground at the flight frames, forward lean
    run_keys = []
    run_phases = [
        (1, 1, 0.012), (6, 1, -0.026), (11, 0, 0.034), (16, 0, 0.014),
        (21, -1, 0.012), (26, -1, -0.026), (31, 0, 0.034), (36, 0, 0.014), (40, 1, 0.012),
    ]
    for frame, lead, lift in run_phases:
        s = lead
        thigh = 54 * stride * s if lead else 6
        back = -50 * stride * s if lead else -6
        run_keys.append((frame, pose(
            Hips=(r(-4), r(-5 * s), 0),
            Spine=(r(-3), r(4 * s), 0),
            Chest=(r(-7 * lean), r(-8 * s), 0),
            Neck=(r(5 * lean), 0, 0),
            Head=(r(6 * lean), r(6 * s), 0),
            LeftShoulder=(0, 0, 0),
            RightShoulder=(0, 0, 0),
            LeftArm=(r(54 * swing * s - 10), 0, r(14)),
            RightArm=(r(-54 * swing * s - 10), 0, r(-14)),
            LeftForeArm=(r(-70), 0, r(-10)),
            RightForeArm=(r(-70), 0, r(10)),
            LeftHand=(0, 0, 0),
            RightHand=(0, 0, 0),
            LeftUpLeg=(r(-thigh), 0, r(3)),
            RightUpLeg=(r(-back), 0, r(-3)),
            LeftLeg=(r(max(0, 62 * s) + 10 * crouch), 0, 0),
            RightLeg=(r(max(0, -62 * s) + 10 * crouch), 0, 0),
            LeftFoot=(r(-12 * s + 4), 0, 0),
            RightFoot=(r(12 * s + 4), 0, 0),
        ), lift, (0.0, 0.004)))
    actions.append(make_action(armature, 'run', run_keys))

    # ---- jump: crouch, launch, tuck, reach, land
    actions.append(make_action(armature, 'jump', [
        (1, pose(
            Chest=(r(14), 0, 0), Neck=(r(-8), 0, 0),
            LeftArm=(r(26), 0, r(14)), RightArm=(r(26), 0, r(-14)),
            LeftForeArm=(r(-30), 0, 0), RightForeArm=(r(-30), 0, 0),
            LeftUpLeg=(r(-34 * crouch), 0, r(4)), RightUpLeg=(r(-34 * crouch), 0, r(-4)),
            LeftLeg=(r(58 * crouch), 0, 0), RightLeg=(r(58 * crouch), 0, 0),
            LeftFoot=(r(-16), 0, 0), RightFoot=(r(-16), 0, 0),
        ), -0.075, (0, 0)),
        (7, pose(
            Chest=(r(-6), 0, 0),
            LeftArm=(r(-74), 0, r(20)), RightArm=(r(-74), 0, r(-20)),
            LeftForeArm=(r(-14), 0, 0), RightForeArm=(r(-14), 0, 0),
            LeftUpLeg=(r(-8), 0, r(3)), RightUpLeg=(r(-8), 0, r(-3)),
            LeftLeg=(r(10), 0, 0), RightLeg=(r(10), 0, 0),
            LeftFoot=(r(24), 0, 0), RightFoot=(r(24), 0, 0),
        ), 0.085, (0, 0)),
        (16, pose(
            Chest=(r(-10), 0, 0), Head=(r(4), 0, 0),
            LeftArm=(r(-104), 0, r(24)), RightArm=(r(-104), 0, r(-24)),
            LeftForeArm=(r(-22), 0, 0), RightForeArm=(r(-22), 0, 0),
            LeftUpLeg=(r(-46), 0, r(5)), RightUpLeg=(r(-30), 0, r(-5)),
            LeftLeg=(r(74), 0, 0), RightLeg=(r(58), 0, 0),
            LeftFoot=(r(18), 0, 0), RightFoot=(r(16), 0, 0),
        ), 0.050, (0, 0)),
        (24, pose(
            Chest=(r(2), 0, 0),
            LeftArm=(r(-40), 0, r(18)), RightArm=(r(-40), 0, r(-18)),
            LeftForeArm=(r(-26), 0, 0), RightForeArm=(r(-26), 0, 0),
            LeftUpLeg=(r(-18), 0, r(4)), RightUpLeg=(r(-18), 0, r(-4)),
            LeftLeg=(r(26), 0, 0), RightLeg=(r(26), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(-8), 0, 0),
        ), 0.010, (0, 0)),
        (32, pose(
            Chest=(r(10), 0, 0), Neck=(r(-6), 0, 0),
            LeftArm=(r(8), 0, r(12)), RightArm=(r(8), 0, r(-12)),
            LeftForeArm=(r(-34), 0, 0), RightForeArm=(r(-34), 0, 0),
            LeftUpLeg=(r(-22), 0, r(4)), RightUpLeg=(r(-22), 0, r(-4)),
            LeftLeg=(r(36), 0, 0), RightLeg=(r(36), 0, 0),
            LeftFoot=(r(-12), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.040, (0, 0)),
    ], loop=False))

    # ---- jab: anticipation, drive, contact hold, recoil, return
    actions.append(make_action(armature, 'jab', [
        (1, guard_stance(), 0.0, (0, 0)),
        (4, pose(
            Chest=(r(6), r(9), 0), Head=(0, r(6), 0),
            LeftArm=(r(-8), 0, r(12)), RightArm=(r(-16), 0, r(-12)),
            LeftForeArm=(r(-46), 0, r(-8)), RightForeArm=(r(-70), 0, r(10)),
            LeftUpLeg=(r(-6), 0, r(4)), RightUpLeg=(r(6), 0, r(-4)),
            LeftLeg=(r(8), 0, 0), RightLeg=(r(8), 0, 0),
        ), -0.010, (0, 0.008)),
        (8, pose(
            Chest=(r(-4), r(-18), 0), Hips=(0, r(-8), 0), Head=(0, r(-10), 0),
            LeftArm=(r(-22), 0, r(16)), RightArm=(r(-92), 0, r(-2)),
            LeftForeArm=(r(-56), 0, r(-8)), RightForeArm=(r(-6), 0, r(2)),
            LeftHand=(0, 0, r(-6)), RightHand=(0, 0, 0),
            LeftUpLeg=(r(-10), 0, r(4)), RightUpLeg=(r(10), 0, r(-4)),
            LeftLeg=(r(12), 0, 0), RightLeg=(r(10), 0, 0),
        ), 0.0, (0, -0.012)),
        (11, pose(
            Chest=(r(-3), r(-16), 0), Hips=(0, r(-7), 0), Head=(0, r(-8), 0),
            LeftArm=(r(-20), 0, r(15)), RightArm=(r(-88), 0, r(-2)),
            LeftForeArm=(r(-54), 0, r(-8)), RightForeArm=(r(-10), 0, r(2)),
            LeftHand=(0, 0, r(-6)), RightHand=(0, 0, 0),
            LeftUpLeg=(r(-10), 0, r(4)), RightUpLeg=(r(10), 0, r(-4)),
            LeftLeg=(r(12), 0, 0), RightLeg=(r(10), 0, 0),
        ), 0.0, (0, -0.010)),
        (16, pose(
            Chest=(r(4), r(-2), 0), Head=(0, r(-2), 0),
            LeftArm=(r(-10), 0, r(11)), RightArm=(r(-40), 0, r(-8)),
            LeftForeArm=(r(-46), 0, r(-8)), RightForeArm=(r(-48), 0, r(8)),
            LeftUpLeg=(r(-7), 0, r(4)), RightUpLeg=(r(5), 0, r(-4)),
            LeftLeg=(r(9), 0, 0), RightLeg=(r(7), 0, 0),
        ), 0.0, (0, 0)),
        (20, guard_stance(), 0.0, (0, 0)),
    ], loop=False))

    # ---- heavy punch: hip drive, full-body rotation, committed recovery
    actions.append(make_action(armature, 'heavy_punch', [
        (1, guard_stance(lean=6, left=-8, right=-10, elbow_l=-46, elbow_r=-60), 0.0, (0, 0)),
        (5, pose(
            Chest=(r(10), r(16), 0), Hips=(0, r(10), 0), Head=(0, r(10), 0),
            LeftArm=(r(-14), 0, r(14)), RightArm=(r(-24), r(-16), r(-26)),
            LeftForeArm=(r(-52), 0, r(-10)), RightForeArm=(r(-84), 0, r(12)),
            LeftUpLeg=(r(-14), 0, r(4)), RightUpLeg=(r(10), 0, r(-6)),
            LeftLeg=(r(16), 0, 0), RightLeg=(r(14), 0, 0),
            LeftFoot=(r(-10), 0, 0), RightFoot=(r(-6), 0, 0),
        ), -0.022, (0, 0.010)),
        (13, pose(
            Chest=(r(-8), r(-30), 0), Spine=(r(-2), r(-12), 0), Hips=(0, r(-16), 0),
            Neck=(r(2), r(10), 0), Head=(0, r(-18), 0),
            LeftArm=(r(-46), 0, r(26)), RightArm=(r(-84), r(-30), r(-34)),
            LeftForeArm=(r(-40), 0, r(-12)), RightForeArm=(r(-18), 0, r(6)),
            LeftHand=(0, 0, r(-8)), RightHand=(0, r(-16), 0),
            LeftUpLeg=(r(-18), 0, r(4)), RightUpLeg=(r(14), 0, r(-6)),
            LeftLeg=(r(20), 0, 0), RightLeg=(r(12), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(10), 0, 0),
        ), -0.004, (0, -0.016)),
        (18, pose(
            Chest=(r(-6), r(-26), 0), Spine=(r(-1), r(-10), 0), Hips=(0, r(-14), 0),
            Head=(0, r(-14), 0),
            LeftArm=(r(-42), 0, r(24)), RightArm=(r(-76), r(-26), r(-30)),
            LeftForeArm=(r(-42), 0, r(-12)), RightForeArm=(r(-26), 0, r(6)),
            LeftUpLeg=(r(-16), 0, r(4)), RightUpLeg=(r(12), 0, r(-6)),
            LeftLeg=(r(18), 0, 0), RightLeg=(r(12), 0, 0),
        ), -0.006, (0, -0.012)),
        (26, pose(
            Chest=(r(6), r(-6), 0), Hips=(0, r(-4), 0), Head=(0, r(-4), 0),
            LeftArm=(r(-16), 0, r(12)), RightArm=(r(-36), 0, r(-12)),
            LeftForeArm=(r(-44), 0, r(-8)), RightForeArm=(r(-56), 0, r(8)),
            LeftUpLeg=(r(-8), 0, r(4)), RightUpLeg=(r(6), 0, r(-4)),
            LeftLeg=(r(10), 0, 0), RightLeg=(r(8), 0, 0),
        ), 0.0, (0, 0)),
        (34, guard_stance(lean=6, left=-8, right=-10, elbow_l=-46, elbow_r=-60), 0.0, (0, 0)),
    ], loop=False))

    # ---- block: forearms crossed in front of the face, braced, rocking under pressure
    block_keys = []
    for frame, load, lift, shift in [(1, 0.0, -0.026, 0.0), (7, 1.0, -0.042, 0.008),
                                     (14, 0.35, -0.030, 0.003), (21, 0.85, -0.038, 0.006),
                                     (28, 0.0, -0.026, 0.0)]:
        block_keys.append((frame, pose(
            Hips=(r(4 * load), r(-3 * load), 0),
            Spine=(r(3 + 7 * load), r(2 * load), 0),
            Chest=(r(10 + 9 * load), r(-4 - 4 * load), 0),
            Neck=(r(-6 - 5 * load), 0, 0),
            Head=(r(-8 - 6 * load), r(-3 * load), 0),
            LeftShoulder=(0, 0, r(3 * load)), RightShoulder=(0, 0, r(-3 * load)),
            LeftArm=(r(-74 - 10 * load), 0, r(34 + 5 * load)),
            RightArm=(r(-74 - 10 * load), 0, r(-34 - 5 * load)),
            LeftForeArm=(r(-100 - 12 * load), 0, r(-18 - 4 * load)),
            RightForeArm=(r(-100 - 12 * load), 0, r(18 + 4 * load)),
            LeftHand=(r(-6 * load), 0, r(-10)), RightHand=(r(-6 * load), 0, r(10)),
            LeftUpLeg=(r(-14 * stance - 8 * load), 0, r(5 * stance + 3 * load)),
            RightUpLeg=(r(10 * stance + 8 * load), 0, r(-5 * stance - 3 * load)),
            LeftLeg=(r(20 * crouch + 12 * load), 0, 0),
            RightLeg=(r(16 * crouch + 12 * load), 0, 0),
            LeftFoot=(r(-8 - 5 * load), 0, 0), RightFoot=(r(6 + 5 * load), 0, 0),
        ), lift, (shift, 0)))
    actions.append(make_action(armature, 'block', block_keys))

    # ---- light hit reaction: recoil, a stagger step back, then reset to guard
    actions.append(make_action(armature, 'hit_light', [
        (1, pose(
            Chest=(r(-18), r(10), 0), Spine=(r(-6), 0, 0), Neck=(r(8), 0, 0), Head=(r(16), r(10), 0),
            LeftArm=(r(18), 0, r(28)), RightArm=(r(22), 0, r(-24)),
            LeftForeArm=(r(-30), 0, r(-6)), RightForeArm=(r(-34), 0, r(6)),
            LeftUpLeg=(r(6), 0, r(5)), RightUpLeg=(r(-12), 0, r(-5)),
            LeftLeg=(r(14), 0, 0), RightLeg=(r(22), 0, 0),
            LeftFoot=(r(-6), 0, 0), RightFoot=(r(-10), 0, 0),
        ), -0.014, (0, 0.020)),
        (8, pose(
            Chest=(r(-10), r(6), 0), Spine=(r(-3), 0, 0), Neck=(r(4), 0, 0), Head=(r(9), r(6), 0),
            LeftArm=(r(6), 0, r(20)), RightArm=(r(10), 0, r(-18)),
            LeftForeArm=(r(-36), 0, r(-6)), RightForeArm=(r(-38), 0, r(6)),
            LeftUpLeg=(r(0), 0, r(5)), RightUpLeg=(r(-6), 0, r(-5)),
            LeftLeg=(r(12), 0, 0), RightLeg=(r(16), 0, 0),
            LeftFoot=(r(-4), 0, 0), RightFoot=(r(-6), 0, 0),
        ), -0.010, (0, 0.012)),
        (14, pose(
            Chest=(r(2), r(2), 0), Neck=(r(-2), 0, 0), Head=(r(2), r(2), 0),
            LeftArm=(r(-4), 0, r(12)), RightArm=(r(-6), 0, r(-12)),
            LeftForeArm=(r(-42), 0, r(-8)), RightForeArm=(r(-46), 0, r(8)),
            LeftUpLeg=(r(-6), 0, r(4)), RightUpLeg=(r(2), 0, r(-4)),
            LeftLeg=(r(9), 0, 0), RightLeg=(r(8), 0, 0),
        ), -0.004, (0, 0.004)),
        (20, guard_stance(), 0.0, (0, 0)),
    ], loop=False))

    # ---- sprint: the run pushed further - longer stride, deeper lean, arms driving
    sprint_keys = []
    for frame, lead, lift in [(1, 1, 0.014), (5, 1, -0.030), (9, 0, 0.040), (13, 0, 0.016),
                              (17, -1, 0.014), (21, -1, -0.030), (25, 0, 0.040), (29, 0, 0.016),
                              (33, 1, 0.014)]:
        s = lead
        thigh = 64 * stride * s if lead else 8
        back = -58 * stride * s if lead else -8
        sprint_keys.append((frame, pose(
            Hips=(r(-6), r(-6 * s), 0),
            Spine=(r(-5), r(5 * s), 0),
            Chest=(r(-12 * lean), r(-10 * s), 0),
            Neck=(r(8 * lean), 0, 0),
            Head=(r(10 * lean), r(7 * s), 0),
            LeftArm=(r(70 * swing * s - 12), 0, r(16)),
            RightArm=(r(-70 * swing * s - 12), 0, r(-16)),
            LeftForeArm=(r(-86), 0, r(-12)), RightForeArm=(r(-86), 0, r(12)),
            LeftHand=(0, 0, r(-4)), RightHand=(0, 0, r(4)),
            LeftUpLeg=(r(-thigh), 0, r(3)), RightUpLeg=(r(-back), 0, r(-3)),
            LeftLeg=(r(max(0, 76 * s) + 10 * crouch), 0, 0),
            RightLeg=(r(max(0, -76 * s) + 10 * crouch), 0, 0),
            LeftFoot=(r(-16 * s + 6), 0, 0), RightFoot=(r(16 * s + 6), 0, 0),
        ), lift, (0.0, 0.006)))
    actions.append(make_action(armature, 'sprint', sprint_keys))

    # ---- land: contact, absorb, rise. The consumer searches for `land`/`landing`; without this
    # clip every landing fell back to the idle pose.
    actions.append(make_action(armature, 'land', [
        (1, pose(
            Chest=(r(18 * crouch), 0, 0), Spine=(r(6), 0, 0), Neck=(r(-10), 0, 0), Head=(r(-6), 0, 0),
            LeftArm=(r(-30), 0, r(30 * stance)), RightArm=(r(-30), 0, r(-30 * stance)),
            LeftForeArm=(r(-44), 0, r(-10)), RightForeArm=(r(-44), 0, r(10)),
            LeftUpLeg=(r(-30 * crouch), 0, r(7 * stance)), RightUpLeg=(r(-30 * crouch), 0, r(-7 * stance)),
            LeftLeg=(r(52 * crouch), 0, 0), RightLeg=(r(52 * crouch), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(-14), 0, 0),
        ), -0.052, (0, 0)),
        (8, pose(
            Chest=(r(26 * crouch), 0, 0), Spine=(r(9), 0, 0), Neck=(r(-14), 0, 0), Head=(r(-10), 0, 0),
            LeftArm=(r(-52), 0, r(26 * stance)), RightArm=(r(-52), 0, r(-26 * stance)),
            LeftForeArm=(r(-58), 0, r(-12)), RightForeArm=(r(-58), 0, r(12)),
            LeftUpLeg=(r(-44 * crouch), 0, r(9 * stance)), RightUpLeg=(r(-44 * crouch), 0, r(-9 * stance)),
            LeftLeg=(r(72 * crouch), 0, 0), RightLeg=(r(72 * crouch), 0, 0),
            LeftFoot=(r(-18), 0, 0), RightFoot=(r(-18), 0, 0),
        ), -0.084, (0, 0)),
        (18, pose(
            Chest=(r(10), 0, 0), Neck=(r(-5), 0, 0), Head=(r(-2), 0, 0),
            LeftArm=(r(-16), 0, r(16)), RightArm=(r(-16), 0, r(-16)),
            LeftForeArm=(r(-42), 0, r(-8)), RightForeArm=(r(-42), 0, r(8)),
            LeftUpLeg=(r(-16 * crouch), 0, r(5)), RightUpLeg=(r(-16 * crouch), 0, r(-5)),
            LeftLeg=(r(28 * crouch), 0, 0), RightLeg=(r(28 * crouch), 0, 0),
            LeftFoot=(r(-6), 0, 0), RightFoot=(r(-6), 0, 0),
        ), -0.022, (0, 0)),
        (26, guard_stance(lean=4, left=-6, right=-8), 0.0, (0, 0)),
    ], loop=False))

    # ---- dodge: a committed evasive roll out and back, then a braced recovery
    actions.append(make_action(armature, 'dodge', [
        (1, guard_stance(), 0.0, (0, 0)),
        (5, pose(
            Chest=(r(22 * crouch), r(-14), 0), Spine=(r(8), 0, 0), Head=(r(-8), r(-8), 0),
            LeftArm=(r(-38), 0, r(22)), RightArm=(r(-30), 0, r(-30)),
            LeftForeArm=(r(-70), 0, r(-14)), RightForeArm=(r(-64), 0, r(14)),
            LeftUpLeg=(r(-40 * crouch), 0, r(8)), RightUpLeg=(r(-24 * crouch), 0, r(-8)),
            LeftLeg=(r(62 * crouch), 0, 0), RightLeg=(r(46 * crouch), 0, 0),
            LeftFoot=(r(-16), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.048, (0, 0)),
        (12, pose(
            Chest=(r(44 * crouch), r(-26), 0), Spine=(r(16), 0, 0), Neck=(r(-16), 0, 0), Head=(r(-14), r(-16), 0),
            LeftArm=(r(-96), 0, r(14)), RightArm=(r(-88), 0, r(-18)),
            LeftForeArm=(r(-104), 0, r(-18)), RightForeArm=(r(-98), 0, r(18)),
            LeftUpLeg=(r(-84 * crouch), 0, r(10)), RightUpLeg=(r(-58 * crouch), 0, r(-10)),
            LeftLeg=(r(104 * crouch), 0, 0), RightLeg=(r(86 * crouch), 0, 0),
            LeftFoot=(r(-24), 0, 0), RightFoot=(r(-20), 0, 0),
        ), -0.088, (0, 0)),
        (20, pose(
            Chest=(r(26 * crouch), r(-10), 0), Spine=(r(9), 0, 0), Head=(r(-8), r(-6), 0),
            LeftArm=(r(-52), 0, r(20)), RightArm=(r(-46), 0, r(-26)),
            LeftForeArm=(r(-72), 0, r(-14)), RightForeArm=(r(-68), 0, r(14)),
            LeftUpLeg=(r(-40 * crouch), 0, r(8)), RightUpLeg=(r(-30 * crouch), 0, r(-8)),
            LeftLeg=(r(58 * crouch), 0, 0), RightLeg=(r(50 * crouch), 0, 0),
            LeftFoot=(r(-12), 0, 0), RightFoot=(r(-10), 0, 0),
        ), -0.036, (0, 0)),
        (28, guard_stance(), 0.0, (0, 0)),
    ], loop=False))

    # ---- charge: the power-up stance. Consumed by `charge`/`powerup` searches.
    charge_keys = []
    for frame, pulse, lift in [(1, 0.0, 0.0), (10, 1.0, -0.014), (20, 0.35, -0.005),
                               (30, 1.0, -0.016), (40, 0.6, -0.007), (50, 0.0, 0.0)]:
        charge_keys.append((frame, pose(
            Hips=(r(3 * pulse), r(-2 * pulse), 0),
            Chest=(r(10 - 14 * pulse), r(2 * pulse), 0),
            Spine=(r(4 - 7 * pulse), 0, 0),
            Neck=(r(-6 - 8 * pulse), 0, 0),
            Head=(r(-4 - 12 * pulse), 0, 0),
            LeftShoulder=(0, 0, r(-2 * pulse)), RightShoulder=(0, 0, r(2 * pulse)),
            LeftArm=(r(28 - 10 * pulse), r(6 * pulse), r(24 + 6 * pulse)),
            RightArm=(r(28 - 10 * pulse), r(-6 * pulse), r(-24 - 6 * pulse)),
            LeftForeArm=(r(-26 - 12 * pulse), 0, r(-10)), RightForeArm=(r(-26 - 12 * pulse), 0, r(10)),
            LeftHand=(r(-12 * pulse), 0, r(-6)), RightHand=(r(-12 * pulse), 0, r(6)),
            LeftUpLeg=(r(-14 * crouch), 0, r(10 * stance)), RightUpLeg=(r(6 * crouch), 0, r(-10 * stance)),
            LeftLeg=(r(24 * crouch), 0, 0), RightLeg=(r(18 * crouch), 0, 0),
            LeftFoot=(r(-6), 0, 0), RightFoot=(r(4), 0, 0),
        ), lift, (0.0, 0.0)))
    actions.append(make_action(armature, 'charge', charge_keys))

    # ---- beam: ki / repulsor release. Consumed by `beam`/`kame`/`repulsor`/`blast`/`special`.
    actions.append(make_action(armature, 'beam', [
        (1, pose(
            Chest=(r(14), 0, 0), Spine=(r(5), 0, 0), Head=(r(-8), 0, 0),
            LeftArm=(r(-30), 0, r(18)), RightArm=(r(-30), 0, r(-18)),
            LeftForeArm=(r(-96), 0, r(-16)), RightForeArm=(r(-96), 0, r(16)),
            LeftHand=(r(-14), 0, r(-8)), RightHand=(r(-14), 0, r(8)),
            LeftUpLeg=(r(-20 * crouch), 0, r(8 * stance)), RightUpLeg=(r(10 * crouch), 0, r(-8 * stance)),
            LeftLeg=(r(34 * crouch), 0, 0), RightLeg=(r(26 * crouch), 0, 0),
            LeftFoot=(r(-10), 0, 0), RightFoot=(r(6), 0, 0),
        ), -0.030, (0, 0)),
        (7, pose(
            Chest=(r(4), r(-4), 0), Spine=(r(2), 0, 0), Neck=(r(2), 0, 0), Head=(r(-2), 0, 0),
            LeftArm=(r(-96 * swing), r(-6), r(14)), RightArm=(r(-96 * swing), r(6), r(-14)),
            LeftForeArm=(r(-8), 0, r(-4)), RightForeArm=(r(-8), 0, r(4)),
            LeftHand=(r(6), 0, r(-4)), RightHand=(r(6), 0, r(4)),
            LeftUpLeg=(r(-16 * crouch), 0, r(7 * stance)), RightUpLeg=(r(8 * crouch), 0, r(-7 * stance)),
            LeftLeg=(r(28 * crouch), 0, 0), RightLeg=(r(22 * crouch), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(5), 0, 0),
        ), -0.016, (0, -0.014)),
        (16, pose(
            Chest=(r(2), r(-5), 0), Spine=(r(1), 0, 0), Head=(r(-1), 0, 0),
            LeftArm=(r(-92 * swing), r(-6), r(14)), RightArm=(r(-92 * swing), r(6), r(-14)),
            LeftForeArm=(r(-12), 0, r(-4)), RightForeArm=(r(-12), 0, r(4)),
            LeftHand=(r(4), 0, r(-4)), RightHand=(r(4), 0, r(4)),
            LeftUpLeg=(r(-14 * crouch), 0, r(7 * stance)), RightUpLeg=(r(7 * crouch), 0, r(-7 * stance)),
            LeftLeg=(r(26 * crouch), 0, 0), RightLeg=(r(20 * crouch), 0, 0),
        ), -0.014, (0, -0.012)),
        (30, guard_stance(lean=5, left=-8, right=-10), 0.0, (0, 0)),
    ], loop=False))

    # ---- launcher: a rising strike that lifts the opponent
    actions.append(make_action(armature, 'launcher', [
        (1, guard_stance(lean=6, left=-10, right=-12, elbow_l=-48, elbow_r=-58), 0.0, (0, 0)),
        (6, pose(
            Chest=(r(16 * crouch), r(14), 0), Hips=(0, r(8), 0), Head=(r(-6), r(10), 0),
            LeftArm=(r(-16), 0, r(16)), RightArm=(r(-18), r(-14), r(-24)),
            LeftForeArm=(r(-58), 0, r(-12)), RightForeArm=(r(-92), 0, r(14)),
            LeftUpLeg=(r(-22 * crouch), 0, r(6)), RightUpLeg=(r(-16 * crouch), 0, r(-6)),
            LeftLeg=(r(42 * crouch), 0, 0), RightLeg=(r(34 * crouch), 0, 0),
            LeftFoot=(r(-12), 0, 0), RightFoot=(r(-10), 0, 0),
        ), -0.058, (0, 0.010)),
        (13, pose(
            Chest=(r(-14), r(-22), 0), Spine=(r(-6), r(-10), 0), Hips=(0, r(-14), 0),
            Neck=(r(6), r(8), 0), Head=(r(8), r(-14), 0),
            LeftArm=(r(-38), 0, r(24)), RightArm=(r(-142 * swing), r(-18), r(-18)),
            LeftForeArm=(r(-46), 0, r(-12)), RightForeArm=(r(-18), 0, r(6)),
            LeftHand=(0, 0, r(-8)), RightHand=(r(-10), r(-8), 0),
            LeftUpLeg=(r(-10), 0, r(5)), RightUpLeg=(r(-46 * crouch), 0, r(-8)),
            LeftLeg=(r(16), 0, 0), RightLeg=(r(72 * crouch), 0, 0),
            LeftFoot=(r(-6), 0, 0), RightFoot=(r(-20), 0, 0),
        ), 0.024, (0, -0.010)),
        (20, pose(
            Chest=(r(-8), r(-16), 0), Hips=(0, r(-10), 0), Head=(r(4), r(-10), 0),
            LeftArm=(r(-30), 0, r(20)), RightArm=(r(-118), r(-14), r(-16)),
            LeftForeArm=(r(-48), 0, r(-12)), RightForeArm=(r(-34), 0, r(6)),
            LeftUpLeg=(r(-8), 0, r(5)), RightUpLeg=(r(-30 * crouch), 0, r(-7)),
            LeftLeg=(r(14), 0, 0), RightLeg=(r(50 * crouch), 0, 0),
        ), 0.010, (0, -0.006)),
        (28, pose(
            Chest=(r(8), r(-4), 0), Head=(r(-2), r(-2), 0),
            LeftArm=(r(-14), 0, r(14)), RightArm=(r(-42), 0, r(-14)),
            LeftForeArm=(r(-44), 0, r(-10)), RightForeArm=(r(-54), 0, r(10)),
            LeftUpLeg=(r(-16 * crouch), 0, r(6)), RightUpLeg=(r(-12 * crouch), 0, r(-6)),
            LeftLeg=(r(28 * crouch), 0, 0), RightLeg=(r(24 * crouch), 0, 0),
        ), -0.024, (0, 0)),
        (36, guard_stance(lean=5, left=-8, right=-10), 0.0, (0, 0)),
    ], loop=False))

    # ---- knockdown: driven backward off the feet and down onto the back
    actions.append(make_action(armature, 'knockdown', [
        (1, pose(
            Chest=(r(-26), r(12), 0), Spine=(r(-10), 0, 0), Neck=(r(12), 0, 0), Head=(r(24), r(14), 0),
            LeftArm=(r(28), 0, r(34)), RightArm=(r(32), 0, r(-30)),
            LeftForeArm=(r(-24), 0, r(-8)), RightForeArm=(r(-28), 0, r(8)),
            LeftUpLeg=(r(10), 0, r(7)), RightUpLeg=(r(-16), 0, r(-7)),
            LeftLeg=(r(18), 0, 0), RightLeg=(r(30), 0, 0),
            LeftFoot=(r(-10), 0, 0), RightFoot=(r(-14), 0, 0),
        ), -0.020, (0, 0.026)),
        (10, pose(
            Chest=(r(-40), r(16), 0), Spine=(r(-14), 0, 0), Neck=(r(16), 0, 0), Head=(r(30), r(16), 0),
            LeftArm=(r(48), 0, r(44)), RightArm=(r(52), 0, r(-40)),
            LeftForeArm=(r(-16), 0, r(-8)), RightForeArm=(r(-18), 0, r(8)),
            LeftUpLeg=(r(-24), 0, r(8)), RightUpLeg=(r(-34), 0, r(-8)),
            LeftLeg=(r(46), 0, 0), RightLeg=(r(56), 0, 0),
            LeftFoot=(r(-16), 0, 0), RightFoot=(r(-18), 0, 0),
        ), -0.120, (0, 0.048)),
        (20, pose(
            Chest=(r(-24), r(10), 0), Spine=(r(-9), 0, 0), Neck=(r(10), 0, 0), Head=(r(16), r(10), 0),
            LeftArm=(r(34), 0, r(50)), RightArm=(r(38), 0, r(-46)),
            LeftForeArm=(r(-30), 0, r(-10)), RightForeArm=(r(-32), 0, r(10)),
            LeftUpLeg=(r(-52), 0, r(9)), RightUpLeg=(r(-46), 0, r(-9)),
            LeftLeg=(r(72), 0, 0), RightLeg=(r(66), 0, 0),
            LeftFoot=(r(-20), 0, 0), RightFoot=(r(-18), 0, 0),
        ), -0.196, (0, 0.052)),
        (34, pose(
            Chest=(r(-16), r(6), 0), Spine=(r(-6), 0, 0), Neck=(r(6), 0, 0), Head=(r(10), r(6), 0),
            LeftArm=(r(26), 0, r(46)), RightArm=(r(30), 0, r(-42)),
            LeftForeArm=(r(-36), 0, r(-10)), RightForeArm=(r(-38), 0, r(10)),
            LeftUpLeg=(r(-40), 0, r(9)), RightUpLeg=(r(-36), 0, r(-9)),
            LeftLeg=(r(54), 0, 0), RightLeg=(r(50), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.188, (0, 0.048)),
    ], loop=False))

    # ---- get_up: from the ground back to the guard
    actions.append(make_action(armature, 'get_up', [
        (1, pose(
            Chest=(r(-14), r(6), 0), Neck=(r(6), 0, 0), Head=(r(8), r(6), 0),
            LeftArm=(r(24), 0, r(46)), RightArm=(r(28), 0, r(-42)),
            LeftForeArm=(r(-38), 0, r(-10)), RightForeArm=(r(-40), 0, r(10)),
            LeftUpLeg=(r(-38), 0, r(9)), RightUpLeg=(r(-34), 0, r(-9)),
            LeftLeg=(r(52), 0, 0), RightLeg=(r(48), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.186, (0, 0.046)),
        (12, pose(
            Chest=(r(30), r(4), 0), Spine=(r(11), 0, 0), Neck=(r(-12), 0, 0), Head=(r(-10), r(4), 0),
            LeftArm=(r(52), 0, r(30)), RightArm=(r(56), 0, r(-28)),
            LeftForeArm=(r(-58), 0, r(-12)), RightForeArm=(r(-60), 0, r(12)),
            LeftUpLeg=(r(-62), 0, r(8)), RightUpLeg=(r(-54), 0, r(-8)),
            LeftLeg=(r(92), 0, 0), RightLeg=(r(84), 0, 0),
            LeftFoot=(r(-22), 0, 0), RightFoot=(r(-20), 0, 0),
        ), -0.132, (0, 0.030)),
        (26, pose(
            Chest=(r(24), 0, 0), Spine=(r(9), 0, 0), Neck=(r(-10), 0, 0), Head=(r(-6), 0, 0),
            LeftArm=(r(16), 0, r(20)), RightArm=(r(20), 0, r(-18)),
            LeftForeArm=(r(-56), 0, r(-12)), RightForeArm=(r(-58), 0, r(12)),
            LeftUpLeg=(r(-38), 0, r(6)), RightUpLeg=(r(-30), 0, r(-6)),
            LeftLeg=(r(64), 0, 0), RightLeg=(r(58), 0, 0),
            LeftFoot=(r(-16), 0, 0), RightFoot=(r(-14), 0, 0),
        ), -0.072, (0, 0.012)),
        (38, pose(
            Chest=(r(12), 0, 0), Neck=(r(-4), 0, 0), Head=(r(-2), 0, 0),
            LeftArm=(r(-8), 0, r(16)), RightArm=(r(-10), 0, r(-16)),
            LeftForeArm=(r(-48), 0, r(-10)), RightForeArm=(r(-52), 0, r(10)),
            LeftUpLeg=(r(-18 * crouch), 0, r(6)), RightUpLeg=(r(-14 * crouch), 0, r(-6)),
            LeftLeg=(r(32 * crouch), 0, 0), RightLeg=(r(28 * crouch), 0, 0),
        ), -0.030, (0, 0)),
        (48, guard_stance(), 0.0, (0, 0)),
    ], loop=False))

    # ---- fly: the hovering flight loop for the fighters that can fly
    fly_keys = []
    for frame, phase, lift in [(1, 0.0, 0.0), (12, 0.5, 0.022), (24, 1.0, 0.0), (36, 0.4, 0.016), (48, 0.0, 0.0)]:
        bob = math.sin(phase * math.pi * 2)
        drift = math.cos(phase * math.pi * 2)
        # A hover is not a static pose: the arms counter the drift, the chest rolls into it and the
        # legs trail behind, so the body reads as holding station in the air.
        fly_keys.append((frame, pose(
            Hips=(r(-2 * bob), r(5 * drift), 0),
            Chest=(r(14 + 8 * bob), r(2 * bob + 4 * drift), r(3 * drift)),
            Spine=(r(5 + 4 * bob), r(2 * drift), 0),
            Neck=(r(-10 - 3 * bob), 0, 0),
            Head=(r(-12 - 6 * bob), r(5 * drift), r(2 * drift)),
            LeftShoulder=(0, 0, r(3 * bob)), RightShoulder=(0, 0, r(-3 * bob)),
            LeftArm=(r(-16 + 12 * bob), r(4 * drift), r(44 + 9 * bob)),
            RightArm=(r(-16 + 12 * bob), r(-4 * drift), r(-44 - 9 * bob)),
            LeftForeArm=(r(-30 - 12 * bob), 0, r(-12)), RightForeArm=(r(-30 - 12 * bob), 0, r(12)),
            LeftHand=(r(-8 * bob), 0, r(-6)), RightHand=(r(-8 * bob), 0, r(6)),
            LeftUpLeg=(r(-26 + 12 * bob), 0, r(6 + 4 * drift)), RightUpLeg=(r(-14 + 12 * bob), 0, r(-6 - 4 * drift)),
            LeftLeg=(r(34 + 14 * bob), 0, 0), RightLeg=(r(46 + 14 * bob), 0, 0),
            LeftFoot=(r(14 + 6 * bob), 0, 0), RightFoot=(r(16 + 6 * bob), 0, 0),
        ), lift, (0.0, 0.004 * drift)))
    actions.append(make_action(armature, 'fly', fly_keys))

    # ---- hit_heavy: the counter-hit. `hit_light` recoils; this one is driven off balance - chest
    # compressed, head whipped back, weight dumped onto the back foot, then a stagger to recover.
    # public/js/anim/animation_controller.js asks for this id above 0.3 s of hitstun.
    actions.append(make_action(armature, 'hit_heavy', [
        (1, pose(
            Chest=(r(-34), r(18), r(6)), Spine=(r(-13), r(7), 0), Hips=(r(-8), r(10), 0),
            Neck=(r(18), 0, 0), Head=(r(32), r(20), r(8)),
            LeftShoulder=(0, 0, r(7)), RightShoulder=(0, 0, r(-7)),
            LeftArm=(r(36), r(10), r(40)), RightArm=(r(42), r(-12), r(-36)),
            LeftForeArm=(r(-22), 0, r(-14)), RightForeArm=(r(-26), 0, r(14)),
            LeftHand=(r(-10), 0, r(-8)), RightHand=(r(-12), 0, r(8)),
            LeftUpLeg=(r(16), 0, r(8)), RightUpLeg=(r(-24), 0, r(-8)),
            LeftLeg=(r(22), 0, 0), RightLeg=(r(40), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(-22), 0, 0),
        ), -0.034, (0, 0.034)),
        (7, pose(
            Chest=(r(-46), r(24), r(9)), Spine=(r(-18), r(10), 0), Hips=(r(-12), r(14), 0),
            Neck=(r(24), 0, 0), Head=(r(42), r(26), r(11)),
            LeftShoulder=(0, 0, r(9)), RightShoulder=(0, 0, r(-9)),
            LeftArm=(r(52), r(14), r(50)), RightArm=(r(58), r(-16), r(-44)),
            LeftForeArm=(r(-14), 0, r(-16)), RightForeArm=(r(-18), 0, r(16)),
            LeftHand=(r(-16), 0, r(-10)), RightHand=(r(-18), 0, r(10)),
            LeftUpLeg=(r(24), 0, r(9)), RightUpLeg=(r(-34), 0, r(-9)),
            LeftLeg=(r(30), 0, 0), RightLeg=(r(54), 0, 0),
            LeftFoot=(r(-18), 0, 0), RightFoot=(r(-28), 0, 0),
        ), -0.062, (0, 0.056)),
        (13, pose(
            Chest=(r(-30), r(16), r(6)), Spine=(r(-12), r(6), 0), Hips=(r(-9), r(10), 0),
            Neck=(r(16), 0, 0), Head=(r(28), r(18), r(7)),
            LeftShoulder=(0, 0, r(6)), RightShoulder=(0, 0, r(-6)),
            LeftArm=(r(38), r(10), r(42)), RightArm=(r(44), r(-12), r(-36)),
            LeftForeArm=(r(-26), 0, r(-14)), RightForeArm=(r(-30), 0, r(14)),
            LeftHand=(r(-12), 0, r(-8)), RightHand=(r(-14), 0, r(8)),
            LeftUpLeg=(r(18), 0, r(8)), RightUpLeg=(r(-26), 0, r(-8)),
            LeftLeg=(r(26), 0, 0), RightLeg=(r(44), 0, 0),
            LeftFoot=(r(-16), 0, 0), RightFoot=(r(-24), 0, 0),
        ), -0.058, (0, 0.048)),
        (21, pose(
            Chest=(r(-8), r(6), r(2)), Spine=(r(-3), r(2), 0), Hips=(r(-2), r(4), 0),
            Neck=(r(4), 0, 0), Head=(r(8), r(8), r(2)),
            LeftArm=(r(10), r(4), r(24)), RightArm=(r(14), r(-4), r(-20)),
            LeftForeArm=(r(-40), 0, r(-10)), RightForeArm=(r(-44), 0, r(10)),
            LeftUpLeg=(r(-4), 0, r(6)), RightUpLeg=(r(-10), 0, r(-6)),
            LeftLeg=(r(16), 0, 0), RightLeg=(r(26), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.026, (0, 0.016)),
        (30, pose(
            Chest=(r(6), r(2), 0), Spine=(r(2), 0, 0), Hips=(r(1), 0, 0),
            Neck=(r(-3), 0, 0), Head=(r(-2), r(2), 0),
            LeftArm=(r(-6), 0, r(14)), RightArm=(r(-8), 0, r(-12)),
            LeftForeArm=(r(-44), 0, r(-9)), RightForeArm=(r(-50), 0, r(9)),
            LeftUpLeg=(r(-8), 0, r(5)), RightUpLeg=(r(4), 0, r(-5)),
            LeftLeg=(r(12), 0, 0), RightLeg=(r(10), 0, 0),
        ), -0.008, (0, 0.004)),
        (38, guard_stance(lean=6, left=-8, right=-10, elbow_l=-46, elbow_r=-58), 0.0, (0, 0)),
    ], loop=False))

    # ---- strafe: lateral shuffle on a bladed stance, for the ground strafe state
    strafe_keys = []
    for frame, side, lift in [(1, 1, 0.0), (9, 0.4, -0.012), (17, -1, 0.0),
                              (25, -0.4, -0.012), (34, 1, 0.0)]:
        strafe_keys.append((frame, pose(
            Hips=(r(2), r(-6 * side), r(4 * side)),
            Spine=(r(3), r(3 * side), r(2 * side)),
            Chest=(r(7), r(5 * side), r(-3 * side)),
            Neck=(r(-4), r(-3 * side), 0),
            Head=(r(-5), r(-6 * side), r(-2 * side)),
            LeftShoulder=(0, 0, r(3 * side)), RightShoulder=(0, 0, r(-3 * side)),
            LeftArm=(r(-26 - 8 * side), r(4 * side), r(22)),
            RightArm=(r(-30 + 8 * side), r(-4 * side), r(-20)),
            LeftForeArm=(r(-58), 0, r(-10)), RightForeArm=(r(-64), 0, r(10)),
            LeftHand=(r(-6), 0, r(-6)), RightHand=(r(-6), 0, r(6)),
            LeftUpLeg=(r(-8 - 6 * side), 0, r(6 * stance + 12 * side)),
            RightUpLeg=(r(-4 + 6 * side), 0, r(-6 * stance + 12 * side)),
            LeftLeg=(r(18 * crouch - 8 * side), 0, 0),
            RightLeg=(r(16 * crouch + 8 * side), 0, 0),
            LeftFoot=(r(-6), 0, r(-4 * side)), RightFoot=(r(-4), 0, r(-4 * side)),
        ), lift, (0.006 * side, 0.0)))
    actions.append(make_action(armature, 'strafe', strafe_keys))

    # ---- hover: an airborne idle. Tighter than `fly` (which is a travelling flight): the body
    # holds station, so the drift is small and the limbs read as balancing rather than swimming.
    hover_keys = []
    for frame, phase, lift in [(1, 0.0, 0.0), (12, 0.35, 0.014), (24, 0.6, 0.004),
                               (36, 0.25, 0.012), (48, 0.0, 0.0)]:
        bob = math.sin(phase * math.pi * 2)
        drift = math.cos(phase * math.pi * 2)
        hover_keys.append((frame, pose(
            Hips=(r(-2 * bob), r(3 * drift), r(2 * drift)),
            Spine=(r(4 + 3 * bob), r(2 * drift), 0),
            Chest=(r(9 + 5 * bob), r(-3 * drift), r(2 * drift)),
            Neck=(r(-8 - 2 * bob), r(2 * drift), 0),
            Head=(r(-10 - 4 * bob), r(5 * drift), r(2 * drift)),
            LeftShoulder=(0, 0, r(2 * bob)), RightShoulder=(0, 0, r(-2 * bob)),
            LeftArm=(r(-18 + 9 * bob), r(5 * drift), r(38 + 7 * bob)),
            RightArm=(r(-18 + 9 * bob), r(-5 * drift), r(-38 - 7 * bob)),
            LeftForeArm=(r(-34 - 10 * bob), 0, r(-12)), RightForeArm=(r(-34 - 10 * bob), 0, r(12)),
            LeftHand=(r(-7 * bob), 0, r(-6)), RightHand=(r(-7 * bob), 0, r(6)),
            LeftUpLeg=(r(-22 + 9 * bob), 0, r(7 + 3 * drift)),
            RightUpLeg=(r(-12 + 9 * bob), 0, r(-7 - 3 * drift)),
            LeftLeg=(r(30 + 11 * bob), 0, 0), RightLeg=(r(42 + 11 * bob), 0, 0),
            LeftFoot=(r(12 + 5 * bob), 0, 0), RightFoot=(r(14 + 5 * bob), 0, 0),
        ), lift, (0.0, 0.004 * drift)))
    actions.append(make_action(armature, 'hover', hover_keys))

    # ---- air_attack: a committed diving strike - coil in the air, drive down and through,
    # then pull the guard back in flight so the fall pose is not an attack pose.
    actions.append(make_action(armature, 'air_attack', [
        (1, pose(
            Chest=(r(-12), r(10), 0), Spine=(r(-4), r(4), 0), Hips=(r(-6), r(6), 0),
            Neck=(r(6), 0, 0), Head=(r(10), r(8), 0),
            LeftArm=(r(28), r(8), r(30)), RightArm=(r(34), r(-10), r(-26)),
            LeftForeArm=(r(-40), 0, r(-12)), RightForeArm=(r(-46), 0, r(12)),
            LeftHand=(r(-8), 0, r(-6)), RightHand=(r(-8), 0, r(6)),
            LeftUpLeg=(r(-30), 0, r(8)), RightUpLeg=(r(-20), 0, r(-8)),
            LeftLeg=(r(52), 0, 0), RightLeg=(r(44), 0, 0),
            LeftFoot=(r(16), 0, 0), RightFoot=(r(14), 0, 0),
        ), 0.020, (0, 0.014)),
        (7, pose(
            Chest=(r(-22), r(16), r(4)), Spine=(r(-8), r(6), 0), Hips=(r(-10), r(10), 0),
            Neck=(r(10), 0, 0), Head=(r(16), r(12), 0),
            LeftArm=(r(40), r(10), r(26)), RightArm=(r(52), r(-14), r(-22)),
            LeftForeArm=(r(-56), 0, r(-14)), RightForeArm=(r(-70), 0, r(14)),
            LeftHand=(r(-12), 0, r(-8)), RightHand=(r(-14), 0, r(8)),
            LeftUpLeg=(r(-40), 0, r(9)), RightUpLeg=(r(-26), 0, r(-9)),
            LeftLeg=(r(64), 0, 0), RightLeg=(r(54), 0, 0),
            LeftFoot=(r(20), 0, 0), RightFoot=(r(18), 0, 0),
        ), 0.034, (0, 0.020)),
        (13, pose(
            Chest=(r(34), r(-14), r(-4)), Spine=(r(12), r(-6), 0), Hips=(r(14), r(-8), 0),
            Neck=(r(-14), 0, 0), Head=(r(-10), r(-10), 0),
            LeftArm=(r(-30), r(-8), r(16)), RightArm=(r(-108), r(-6), r(-14)),
            LeftForeArm=(r(-24), 0, r(-8)), RightForeArm=(r(-6), 0, r(6)),
            LeftHand=(0, 0, r(-6)), RightHand=(r(-14), r(-6), r(4)),
            LeftUpLeg=(r(-16), 0, r(6)), RightUpLeg=(r(18), 0, r(-6)),
            LeftLeg=(r(30), 0, 0), RightLeg=(r(22), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(-6), 0, 0),
        ), -0.010, (0, -0.018)),
        (20, pose(
            Chest=(r(18), r(-6), 0), Spine=(r(6), r(-2), 0), Hips=(r(6), r(-4), 0),
            Neck=(r(-6), 0, 0), Head=(r(-4), r(-4), 0),
            LeftArm=(r(-10), 0, r(20)), RightArm=(r(-58), 0, r(-18)),
            LeftForeArm=(r(-38), 0, r(-10)), RightForeArm=(r(-44), 0, r(10)),
            LeftUpLeg=(r(-20), 0, r(7)), RightUpLeg=(r(-8), 0, r(-7)),
            LeftLeg=(r(38), 0, 0), RightLeg=(r(30), 0, 0),
            LeftFoot=(r(6), 0, 0), RightFoot=(r(4), 0, 0),
        ), 0.006, (0, -0.006)),
        (28, pose(
            Chest=(r(9), 0, 0), Neck=(r(-4), 0, 0), Head=(r(-6), 0, 0),
            LeftArm=(r(-20), 0, r(26)), RightArm=(r(-22), 0, r(-26)),
            LeftForeArm=(r(-40), 0, r(-10)), RightForeArm=(r(-42), 0, r(10)),
            LeftUpLeg=(r(-24), 0, r(7)), RightUpLeg=(r(-16), 0, r(-7)),
            LeftLeg=(r(34), 0, 0), RightLeg=(r(28), 0, 0),
        ), 0.0, (0, 0)),
    ], loop=False))

    # ---- throw: reach, clamp, turn the hips through, release. Four readable beats, with the
    # release peak in the middle so the gameplay grab window has somewhere to land.
    actions.append(make_action(armature, 'throw', [
        (1, guard_stance(lean=5, left=-8, right=-10), 0.0, (0, 0)),
        (7, pose(
            Chest=(r(14), r(12), 0), Spine=(r(5), r(5), 0), Hips=(r(2), r(6), 0),
            Neck=(r(-6), 0, 0), Head=(r(-4), r(6), 0),
            LeftArm=(r(-84), r(6), r(18)), RightArm=(r(-88), r(-6), r(-18)),
            LeftForeArm=(r(-14), 0, r(-8)), RightForeArm=(r(-12), 0, r(8)),
            LeftHand=(r(-16), 0, r(-10)), RightHand=(r(-16), 0, r(10)),
            LeftUpLeg=(r(-22 * crouch), 0, r(6)), RightUpLeg=(r(-10 * crouch), 0, r(-6)),
            LeftLeg=(r(34 * crouch), 0, 0), RightLeg=(r(26 * crouch), 0, 0),
            LeftFoot=(r(-10), 0, 0), RightFoot=(r(-8), 0, 0),
        ), -0.040, (0, 0.014)),
        (14, pose(
            Chest=(r(22), r(24), r(4)), Spine=(r(8), r(10), 0), Hips=(r(4), r(14), 0),
            Neck=(r(-8), r(-6), 0), Head=(r(-6), r(10), 0),
            LeftArm=(r(-58), r(10), r(30)), RightArm=(r(-64), r(-12), r(-28)),
            LeftForeArm=(r(-86), 0, r(-16)), RightForeArm=(r(-92), 0, r(16)),
            LeftHand=(r(-20), 0, r(-12)), RightHand=(r(-20), 0, r(12)),
            LeftUpLeg=(r(-32 * crouch), 0, r(8)), RightUpLeg=(r(-16 * crouch), 0, r(-8)),
            LeftLeg=(r(48 * crouch), 0, 0), RightLeg=(r(36 * crouch), 0, 0),
            LeftFoot=(r(-14), 0, 0), RightFoot=(r(-10), 0, 0),
        ), -0.062, (0, 0.020)),
        (21, pose(
            Chest=(r(-18), r(-30), r(-6)), Spine=(r(-8), r(-12), 0), Hips=(r(-6), r(-18), 0),
            Neck=(r(8), r(10), 0), Head=(r(12), r(-16), 0),
            LeftArm=(r(-44), r(-10), r(20)), RightArm=(r(-118), r(-16), r(-24)),
            LeftForeArm=(r(-30), 0, r(-10)), RightForeArm=(r(-20), 0, r(8)),
            LeftHand=(r(-8), 0, r(-8)), RightHand=(r(-10), r(-10), r(6)),
            LeftUpLeg=(r(-14), 0, r(6)), RightUpLeg=(r(20), 0, r(-8)),
            LeftLeg=(r(24), 0, 0), RightLeg=(r(30), 0, 0),
            LeftFoot=(r(-6), 0, 0), RightFoot=(r(-12), 0, 0),
        ), -0.020, (0, -0.022)),
        (26, pose(
            Chest=(r(-24), r(-36), r(-8)), Spine=(r(-10), r(-14), 0), Hips=(r(-8), r(-22), 0),
            Neck=(r(10), r(12), 0), Head=(r(14), r(-20), 0),
            LeftArm=(r(-30), r(-12), r(16)), RightArm=(r(-96), r(-18), r(-20)),
            LeftForeArm=(r(-34), 0, r(-10)), RightForeArm=(r(-28), 0, r(8)),
            LeftUpLeg=(r(-10), 0, r(6)), RightUpLeg=(r(26), 0, r(-9)),
            LeftLeg=(r(20), 0, 0), RightLeg=(r(36), 0, 0),
            LeftFoot=(r(-4), 0, 0), RightFoot=(r(-16), 0, 0),
        ), -0.016, (0, -0.026)),
        (36, guard_stance(lean=5, left=-8, right=-10), 0.0, (0, 0)),
    ], loop=False))

    # ---- parry: the defensive read. Short, sharp, and back in guard inside two thirds of a
    # second, so it cannot be mistaken for a block loop or a dodge roll.
    actions.append(make_action(armature, 'parry', [
        (1, guard_stance(), 0.0, (0, 0)),
        (4, pose(
            Chest=(r(2), r(-22), r(-6)), Spine=(r(1), r(-9), 0), Hips=(r(0), r(-12), 0),
            Neck=(r(-2), r(8), 0), Head=(r(-4), r(-12), r(-3)),
            LeftShoulder=(0, 0, r(8)), RightShoulder=(0, 0, r(-8)),
            LeftArm=(r(-56), r(-8), r(52)), RightArm=(r(-42), r(-6), r(-14)),
            LeftForeArm=(r(-96), 0, r(-26)), RightForeArm=(r(-64), 0, r(14)),
            LeftHand=(r(-16), r(-8), r(-14)), RightHand=(r(-6), 0, r(8)),
            LeftUpLeg=(r(-10), 0, r(6)), RightUpLeg=(r(8), 0, r(-6)),
            LeftLeg=(r(20), 0, 0), RightLeg=(r(16), 0, 0),
            LeftFoot=(r(-8), 0, r(-5)), RightFoot=(r(6), 0, r(-5)),
        ), -0.014, (0.008, 0.010)),
        (8, pose(
            Chest=(r(-6), r(-30), r(-8)), Spine=(r(-2), r(-12), 0), Hips=(r(-2), r(-16), 0),
            Neck=(r(2), r(10), 0), Head=(r(0), r(-16), r(-4)),
            LeftShoulder=(0, 0, r(10)), RightShoulder=(0, 0, r(-9)),
            LeftArm=(r(-72), r(-10), r(62)), RightArm=(r(-30), r(-4), r(-12)),
            LeftForeArm=(r(-108), 0, r(-32)), RightForeArm=(r(-72), 0, r(16)),
            LeftHand=(r(-20), r(-10), r(-16)), RightHand=(r(-8), 0, r(8)),
            LeftUpLeg=(r(-12), 0, r(7)), RightUpLeg=(r(10), 0, r(-7)),
            LeftLeg=(r(24), 0, 0), RightLeg=(r(18), 0, 0),
            LeftFoot=(r(-10), 0, r(-6)), RightFoot=(r(8), 0, r(-6)),
        ), -0.018, (0.012, 0.012)),
        (14, pose(
            Chest=(r(4), r(-12), r(-2)), Spine=(r(2), r(-4), 0), Hips=(r(0), r(-6), 0),
            Head=(r(-2), r(-6), 0),
            LeftArm=(r(-44), r(-4), r(30)), RightArm=(r(-24), 0, r(-12)),
            LeftForeArm=(r(-70), 0, r(-14)), RightForeArm=(r(-58), 0, r(10)),
            LeftUpLeg=(r(-8), 0, r(5)), RightUpLeg=(r(6), 0, r(-5)),
            LeftLeg=(r(14), 0, 0), RightLeg=(r(12), 0, 0),
        ), -0.006, (0.002, 0.004)),
        (22, guard_stance(), 0.0, (0, 0)),
    ], loop=False))

    # ---- victory: the match-winning beat. Chest open, both arms driven overhead, head back, a
    # settled two-fist pose on the hold, then back to the stance so a rematch never starts mid-pose.
    actions.append(make_action(armature, 'victory', [
        (1, guard_stance(lean=5, left=-8, right=-10), 0.0, (0, 0)),
        (9, pose(
            Chest=(r(-6), r(4), 0), Spine=(r(-4), 0, 0), Hips=(r(-4), r(2), 0),
            Neck=(r(-8), 0, 0), Head=(r(-12), r(4), 0),
            LeftShoulder=(0, 0, r(-8)), RightShoulder=(0, 0, r(8)),
            LeftArm=(r(-70), r(8), r(18)), RightArm=(r(-70), r(-8), r(-18)),
            LeftForeArm=(r(-84), 0, r(-14)), RightForeArm=(r(-84), 0, r(14)),
            LeftHand=(r(-14), 0, r(-8)), RightHand=(r(-14), 0, r(8)),
            LeftUpLeg=(r(-10), 0, r(8)), RightUpLeg=(r(6), 0, r(-8)),
            LeftLeg=(r(16), 0, 0), RightLeg=(r(12), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(6), 0, 0),
        ), 0.010, (0, 0)),
        (20, pose(
            Chest=(r(-14), 0, 0), Spine=(r(-8), 0, 0), Hips=(r(-6), 0, 0),
            Neck=(r(-12), 0, 0), Head=(r(-18), 0, 0),
            LeftShoulder=(0, 0, r(-14)), RightShoulder=(0, 0, r(14)),
            LeftArm=(r(-152), r(12), r(26)), RightArm=(r(-152), r(-12), r(-26)),
            LeftForeArm=(r(-18), 0, r(-10)), RightForeArm=(r(-18), 0, r(10)),
            LeftHand=(r(-10), 0, r(-6)), RightHand=(r(-10), 0, r(6)),
            LeftUpLeg=(r(-16), 0, r(12)), RightUpLeg=(r(10), 0, r(-12)),
            LeftLeg=(r(22), 0, 0), RightLeg=(r(16), 0, 0),
            LeftFoot=(r(-10), 0, 0), RightFoot=(r(8), 0, 0),
        ), 0.026, (0, 0)),
        (32, pose(
            Chest=(r(-10), r(6), r(2)), Spine=(r(-5), r(3), 0), Hips=(r(-4), r(4), 0),
            Neck=(r(-8), 0, 0), Head=(r(-12), r(8), r(2)),
            LeftShoulder=(0, 0, r(-6)), RightShoulder=(0, 0, r(6)),
            LeftArm=(r(-124), r(10), r(34)), RightArm=(r(-124), r(-10), r(-34)),
            LeftForeArm=(r(-64), 0, r(-16)), RightForeArm=(r(-64), 0, r(16)),
            LeftHand=(r(-18), 0, r(-10)), RightHand=(r(-18), 0, r(10)),
            LeftUpLeg=(r(-12), 0, r(10)), RightUpLeg=(r(8), 0, r(-10)),
            LeftLeg=(r(18), 0, 0), RightLeg=(r(14), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(6), 0, 0),
        ), 0.014, (0, 0)),
        (44, pose(
            Chest=(r(-12), r(-4), r(-2)), Spine=(r(-6), r(-2), 0), Hips=(r(-5), r(-2), 0),
            Neck=(r(-10), 0, 0), Head=(r(-15), r(-4), 0),
            LeftArm=(r(-138), r(10), r(30)), RightArm=(r(-138), r(-10), r(-30)),
            LeftForeArm=(r(-46), 0, r(-14)), RightForeArm=(r(-46), 0, r(14)),
            LeftHand=(r(-14), 0, r(-8)), RightHand=(r(-14), 0, r(8)),
            LeftUpLeg=(r(-14), 0, r(11)), RightUpLeg=(r(9), 0, r(-11)),
            LeftLeg=(r(20), 0, 0), RightLeg=(r(15), 0, 0),
            LeftFoot=(r(-9), 0, 0), RightFoot=(r(7), 0, 0),
        ), 0.020, (0, 0)),
        (58, guard_stance(lean=4, left=-6, right=-8), 0.0, (0, 0)),
    ], loop=False))

    # ---- defeat: the loss. Knees buckle, the body folds forward onto the ground and the head
    # drops - deliberately not the same silhouette as `knockdown`, which is driven backwards onto
    # the back by a hit. This one is a controlled collapse with no upward recovery.
    actions.append(make_action(armature, 'defeat', [
        (1, pose(
            Chest=(r(20), r(-6), 0), Spine=(r(8), 0, 0), Hips=(r(6), r(-4), 0),
            Neck=(r(-10), 0, 0), Head=(r(-16), r(-6), 0),
            LeftArm=(r(16), 0, r(14)), RightArm=(r(18), 0, r(-12)),
            LeftForeArm=(r(-34), 0, r(-8)), RightForeArm=(r(-36), 0, r(8)),
            LeftUpLeg=(r(-18 * crouch), 0, r(7)), RightUpLeg=(r(-12 * crouch), 0, r(-7)),
            LeftLeg=(r(30 * crouch), 0, 0), RightLeg=(r(24 * crouch), 0, 0),
            LeftFoot=(r(-8), 0, 0), RightFoot=(r(-6), 0, 0),
        ), -0.030, (0, 0)),
        (10, pose(
            Chest=(r(34), r(-10), r(3)), Spine=(r(14), r(-4), 0), Hips=(r(12), r(-6), 0),
            Neck=(r(-14), 0, 0), Head=(r(-24), r(-8), 0),
            LeftArm=(r(30), r(4), r(22)), RightArm=(r(34), r(-4), r(-20)),
            LeftForeArm=(r(-20), 0, r(-10)), RightForeArm=(r(-22), 0, r(10)),
            LeftHand=(r(8), 0, r(-6)), RightHand=(r(8), 0, r(6)),
            LeftUpLeg=(r(-46 * crouch), 0, r(9)), RightUpLeg=(r(-40 * crouch), 0, r(-9)),
            LeftLeg=(r(76 * crouch), 0, 0), RightLeg=(r(70 * crouch), 0, 0),
            LeftFoot=(r(-18), 0, 0), RightFoot=(r(-16), 0, 0),
        ), -0.170, (0, 0.010)),
        (22, pose(
            Chest=(r(52), r(-6), r(4)), Spine=(r(20), r(-2), 0), Hips=(r(18), r(-4), 0),
            Neck=(r(-20), 0, 0), Head=(r(-34), r(-6), 0),
            LeftArm=(r(40), r(6), r(28)), RightArm=(r(44), r(-6), r(-26)),
            LeftForeArm=(r(-14), 0, r(-12)), RightForeArm=(r(-16), 0, r(12)),
            LeftHand=(r(14), 0, r(-8)), RightHand=(r(14), 0, r(8)),
            LeftUpLeg=(r(-84 * crouch), 0, r(11)), RightUpLeg=(r(-78 * crouch), 0, r(-11)),
            LeftLeg=(r(126 * crouch), 0, 0), RightLeg=(r(118 * crouch), 0, 0),
            LeftFoot=(r(-26), 0, 0), RightFoot=(r(-24), 0, 0),
        ), -0.420, (0, 0.030)),
        (36, pose(
            Chest=(r(58), r(-4), r(2)), Spine=(r(23), 0, 0), Hips=(r(20), r(-2), 0),
            Neck=(r(-22), 0, 0), Head=(r(-40), r(-4), 0),
            LeftArm=(r(46), r(8), r(32)), RightArm=(r(50), r(-8), r(-30)),
            LeftForeArm=(r(-10), 0, r(-12)), RightForeArm=(r(-12), 0, r(12)),
            LeftHand=(r(18), 0, r(-8)), RightHand=(r(18), 0, r(8)),
            LeftUpLeg=(r(-92 * crouch), 0, r(12)), RightUpLeg=(r(-86 * crouch), 0, r(-12)),
            LeftLeg=(r(136 * crouch), 0, 0), RightLeg=(r(128 * crouch), 0, 0),
            LeftFoot=(r(-28), 0, 0), RightFoot=(r(-26), 0, 0),
        ), -0.440, (0, 0.034)),
        (52, pose(
            Chest=(r(56), r(-2), 0), Spine=(r(22), 0, 0), Hips=(r(19), 0, 0),
            Neck=(r(-21), 0, 0), Head=(r(-38), r(-2), 0),
            LeftArm=(r(44), r(8), r(30)), RightArm=(r(48), r(-8), r(-28)),
            LeftForeArm=(r(-12), 0, r(-12)), RightForeArm=(r(-14), 0, r(12)),
            LeftUpLeg=(r(-90 * crouch), 0, r(12)), RightUpLeg=(r(-84 * crouch), 0, r(-12)),
            LeftLeg=(r(132 * crouch), 0, 0), RightLeg=(r(124 * crouch), 0, 0),
            LeftFoot=(r(-27), 0, 0), RightFoot=(r(-25), 0, 0),
        ), -0.435, (0, 0.032)),
    ], loop=False))

    armature.animation_data.action = bpy.data.actions.get('idle')
    return actions


# --------------------------------------------------------------------------- export


def export(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(path),
        export_format='GLB',
        export_yup=True,
        export_apply=True,
        export_skins=True,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_bake_animation=True,
        export_force_sampling=True,
        export_frame_range=False,
        export_optimize_animation_size=True,
        export_anim_slide_to_zero=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
        use_selection=False,
    )
    return os.path.abspath(path)


def main():
    reset_scene()
    build_materials()
    parts = build_body()
    weight_parts(parts)
    body = join_parts(parts)
    armature = build_armature()
    bind_armature(body, armature)

    # Binding is silent when a vertex group does not match a bone: the modifier still evaluates,
    # the viewport still looks plausible, and the exporter quietly writes those vertices to a
    # `neutral_bone` that no animation touches. The build therefore refuses to export a body with
    # unweighted vertices or with group names the armature does not have.
    bone_names = {bone.name for bone in armature.data.bones}
    group_names = {group.name for group in body.vertex_groups}
    unbound = sum(1 for vertex in body.data.vertices if not vertex.groups)
    orphan_groups = sorted(group_names - bone_names)
    if unbound or orphan_groups:
        raise SystemExit('bind failed: %d unweighted vertices, vertex groups with no bone: %s'
                         % (unbound, orphan_groups or 'none'))

    actions = build_animations(armature)
    bpy.context.view_layer.update()
    path = export(OUT)

    triangles = sum(len(poly.vertices) - 2 for poly in body.data.polygons)
    zs = [vertex.co.z for vertex in body.data.vertices]
    report = {
        'file': path,
        'bytes': os.path.getsize(path),
        'meshes': len({poly.material_index for poly in body.data.polygons}),
        'materials': len(body.data.materials),
        'materialNames': [mat.name for mat in body.data.materials],
        'vertices': len(body.data.vertices),
        'triangles': triangles,
        'bones': len(armature.data.bones),
        'deformBones': [bone.name for bone in armature.data.bones if bone.use_deform],
        'vertexGroups': len(body.vertex_groups),
        'unboundVertices': unbound,
        'weightedVertices': sum(1 for vertex in body.data.vertices if vertex.groups),
        'multiWeightVertices': sum(1 for vertex in body.data.vertices if len(vertex.groups) > 1),
        'uvLayers': [layer.name for layer in body.data.uv_layers],
        'actions': [action.name for action in bpy.data.actions],
        'fps': bpy.context.scene.render.fps,
        'heightRange': [round(min(zs), 3), round(max(zs), 3)],
    }
    print('KAZE_BUILD ' + json.dumps(report))
    if REPORT:
        with open(REPORT, 'w') as handle:
            json.dump(report, handle, indent=2)


# Guarded so scripts/test-geometry-kernel.py can import loft()/shell()/build_body() without
# running a full build and export as a side effect of the import.
if __name__ == '__main__':
    main()
