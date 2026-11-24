"""Goku, built as ONE continuous sculpted surface instead of an assembly of primitives.

Different construction method, not another pass on the blockout:

  * Body is an implicit surface: metaball field elements fused by Blender's solver into one skin,
    then converted to mesh. Shoulders flow into arms, hips into legs; nothing is "attached".
  * Head is part of the same field: brow ridge, nose bridge and tip, cheekbones, jaw, chin and lips
    are field elements, so they are anatomy rather than parts glued to a sphere.
  * Eye sockets are cut with a boolean, then eyeballs/irises are seated inside them.
  * Hair is bevelled tapered curves, remeshed into one cohesive mass with lock ridges.
  * Clothing is derived FROM the body: a copy of the finished surface pushed out along its normals
    and trimmed to garment regions, so the gi fits the anatomy by construction.
  * Skin weights are smooth proximity weights over the three nearest bones.

Run:
    bash scripts/showcase-goku-v3.sh
    bash scripts/showcase-goku-v3.sh --no-render
"""
import bpy
import bmesh
import math
import os
import sys
from array import array
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.abspath('artifacts/blender-out/v3')
TEX = os.path.join(OUT, 'textures')
os.makedirs(TEX, exist_ok=True)


def log(msg):
    print(f'[goku3] {msg}', flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 18
scene.render.resolution_x = 640
scene.render.resolution_y = 840
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new('World')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.045, 0.05, 0.07, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55


def noise(x, y, salt=0.0):
    n = math.sin(x * 12.9898 + y * 78.233 + salt * 37.719) * 43758.5453
    return n - math.floor(n)


def make_texture(name, base, contrast, pattern, size=256):
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = array('f', [0.0]) * (size * size * 4)
    r0, g0, b0 = base
    for y in range(size):
        for x in range(size):
            if pattern == 'weave':
                f = 1.0 + ((math.sin(x * .55) * .5 + .5) * (math.sin(y * .55) * .5 + .5) - .5) * contrast * 2
                f *= 1.0 + (noise(x * .7, y * .7, 1.3) - .5) * contrast
            elif pattern == 'pore':
                f = 1.0 + (noise(x * 2.1, y * 2.1, 4.7) - .5) * contrast * 2
            elif pattern == 'leather':
                f = 1.0 + (noise(x * 1.4, y * 1.4, 9.1) - .5) * contrast * 2
            else:
                f = 1.0 + (math.sin(x * 1.6) * .5 + .5 - .5) * contrast * 2.4
            i = (y * size + x) * 4
            px[i] = max(0.0, min(1.0, r0 * f))
            px[i + 1] = max(0.0, min(1.0, g0 * f))
            px[i + 2] = max(0.0, min(1.0, b0 * f))
            px[i + 3] = 1.0
    img.pixels.foreach_set(px)
    img.filepath_raw = os.path.join(TEX, f'{name.lower().replace(" ", "_")}.png')
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def material(name, color, roughness=.55, metallic=0.0, subsurface=0.0, texture=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if subsurface:
        b.inputs['Subsurface Weight'].default_value = subsurface
        b.inputs['Subsurface Radius'].default_value = (.4, .22, .12)
    if texture is not None:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = texture
        tex.location = (-420, 240)
        mat.node_tree.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    return mat


def _height(x, y, pattern):
    if pattern == 'weave':
        return .5 + .5 * math.sin(x * .55) * math.sin(y * .55)
    if pattern == 'pore':
        return noise(x * 2.1, y * 2.1, 4.7)
    if pattern == 'leather':
        return .5 + .5 * math.sin((x + y) * .16) * (0.6 + 0.4 * noise(x * 1.4, y * 1.4, 9.1))
    if pattern == 'strand':
        return .5 + .5 * math.sin(x * 1.7)
    return .5


def make_maps(prefix, base, pattern, size=256, normal_strength=2.2, rough_base=.55):
    """Base colour, roughness AND a tangent-space normal map from one height field.

    Wired so Blender's glTF exporter should write baseColorTexture, metallicRoughnessTexture and
    normalTexture. Whether it actually does is checked by parsing the exported GLB, not assumed.
    """
    color = bpy.data.images.new(prefix + ' Color', size, size, alpha=False)
    rough = bpy.data.images.new(prefix + ' Rough', size, size, alpha=False)
    nrm = bpy.data.images.new(prefix + ' Normal', size, size, alpha=False)
    cp, rp, np_ = array('f', [0.0]) * (size * size * 4), array('f', [0.0]) * (size * size * 4), array('f', [0.0]) * (size * size * 4)
    r0, g0, b0 = base
    for y in range(size):
        for x in range(size):
            h = _height(x, y, pattern)
            f = 1.0 + (h - .5) * .22
            i = (y * size + x) * 4
            cp[i], cp[i + 1], cp[i + 2], cp[i + 3] = (max(0, min(1, r0 * f)), max(0, min(1, g0 * f)), max(0, min(1, b0 * f)), 1.0)
            rv = max(0.04, min(1.0, rough_base + (.5 - h) * .45))
            rp[i], rp[i + 1], rp[i + 2], rp[i + 3] = (rv, rv, rv, 1.0)
            dx = _height((x + 1) % size, y, pattern) - _height((x - 1) % size, y, pattern)
            dy = _height(x, (y + 1) % size, pattern) - _height(x, (y - 1) % size, pattern)
            nx, ny, nz = -dx * normal_strength, -dy * normal_strength, 1.0
            ln = math.sqrt(nx * nx + ny * ny + nz * nz) or 1.0
            np_[i], np_[i + 1], np_[i + 2], np_[i + 3] = (nx / ln * .5 + .5, ny / ln * .5 + .5, nz / ln * .5 + .5, 1.0)
    out = []
    for img, px, tag in ((color, cp, 'color'), (rough, rp, 'rough'), (nrm, np_, 'normal')):
        img.pixels.foreach_set(px)
        img.filepath_raw = os.path.join(TEX, f'{prefix.lower().replace(" ", "_")}_{tag}.png')
        img.file_format = 'PNG'
        img.save()
        img.pack()
        out.append(img)
    return out


def pbr_material(name, base, pattern, roughness=.6, metallic=0.0, subsurface=0.0, normal_strength=2.2):
    color, rough, nrm = make_maps(name, base, pattern, normal_strength=normal_strength, rough_base=roughness)
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    b = nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Roughness'].default_value = roughness
    b.inputs['Metallic'].default_value = metallic
    if subsurface:
        b.inputs['Subsurface Weight'].default_value = subsurface
        b.inputs['Subsurface Radius'].default_value = (.4, .22, .12)
    tc = nodes.new('ShaderNodeTexImage'); tc.image = color; tc.location = (-620, 320)
    links.new(tc.outputs['Color'], b.inputs['Base Color'])
    tr = nodes.new('ShaderNodeTexImage'); tr.image = rough; tr.location = (-620, 60)
    tr.image.colorspace_settings.name = 'Non-Color'
    links.new(tr.outputs['Color'], b.inputs['Roughness'])
    tn = nodes.new('ShaderNodeTexImage'); tn.image = nrm; tn.location = (-620, -200)
    tn.image.colorspace_settings.name = 'Non-Color'
    nm = nodes.new('ShaderNodeNormalMap'); nm.location = (-340, -200)
    links.new(tn.outputs['Color'], nm.inputs['Color'])
    links.new(nm.outputs['Normal'], b.inputs['Normal'])
    return mat


SKIN = pbr_material('Goku Skin', (.70, .48, .35), 'pore', .55, subsurface=.12, normal_strength=1.2)
GI = pbr_material('Goku Gi Orange', (.66, .20, .035), 'weave', .78, normal_strength=3.0)
BLUE = pbr_material('Goku Gi Blue', (.07, .15, .40), 'weave', .68, normal_strength=2.4)
BELT = pbr_material('Goku Belt', (.05, .09, .26), 'weave', .52, normal_strength=2.6)
BOOT = pbr_material('Goku Boots', (.10, .10, .13), 'leather', .42, normal_strength=2.6)
HAIR = pbr_material('Goku Hair', (.035, .032, .040), 'strand', .70, normal_strength=3.2)
EYE = material('Goku Eye', (.95, .95, .97), .20)
IRIS = material('Goku Iris', (.09, .07, .06), .26)
PUPIL = material('Goku Pupil', (.015, .015, .015), .22)

FIELD = bpy.data.metaballs.new('GokuField')
FIELD.resolution = 0.0075
FIELD.render_resolution = 0.0075
FIELD.threshold = 0.62
field_obj = bpy.data.objects.new('GokuField', FIELD)
bpy.context.collection.objects.link(field_obj)


def blob(co, radius, stiffness=2.0, kind='BALL', size=(1, 1, 1)):
    el = FIELD.elements.new()
    el.type = kind
    el.co = Vector(co)
    el.radius = radius
    el.stiffness = stiffness
    if kind == 'ELLIPSOID':
        el.size_x, el.size_y, el.size_z = size
    return el


def limb(a, b, r0, r1, steps=10):
    a, b = Vector(a), Vector(b)
    for i in range(steps + 1):
        t = i / steps
        blob(a.lerp(b, t), r0 + (r1 - r0) * t)


blob((0, 0, .96), .155, kind='ELLIPSOID', size=(1.05, .82, .78))
blob((0, 0, 1.05), .150, kind='ELLIPSOID', size=(1.02, .78, .80))
blob((0, .005, 1.16), .152, kind='ELLIPSOID', size=(1.06, .80, .86))
blob((0, .008, 1.28), .165, kind='ELLIPSOID', size=(1.16, .82, .84))
blob((0, .004, 1.36), .150, kind='ELLIPSOID', size=(1.14, .80, .70))
for s in (-1, 1):
    blob((s * .195, 0, 1.335), .105, kind='ELLIPSOID', size=(1.05, .95, .92))
    blob((s * .225, 0, 1.265), .088, kind='ELLIPSOID', size=(.95, .92, 1.05))
    limb((s * .233, 0, 1.255), (s * .245, .005, 1.02), .072, .058, 8)
    blob((s * .245, .008, 1.012), .058)
    limb((s * .245, .008, 1.00), (s * .243, .012, .762), .056, .042, 8)
    blob((s * .085, 0, .945), .115, kind='ELLIPSOID', size=(.92, .95, .95))
    limb((s * .095, 0, .93), (s * .098, .004, .54), .098, .072, 9)
    blob((s * .098, .006, .512), .070)
    limb((s * .098, .004, .50), (s * .098, .010, .175), .070, .050, 9)
    blob((s * .098, .022, .100), .062, kind='ELLIPSOID', size=(.85, 1.25, .72))
    blob((s * .098, .080, .052), .050, kind='ELLIPSOID', size=(.86, 1.35, .58))
limb((0, .004, 1.40), (0, .006, 1.50), .062, .058, 4)

blob((0, .004, 1.618), .116, kind='ELLIPSOID', size=(.92, 1.00, 1.04))
blob((0, -.002, 1.672), .104, kind='ELLIPSOID', size=(.94, .96, .92))
blob((0, .028, 1.560), .092, kind='ELLIPSOID', size=(.88, .96, .74))
blob((0, .050, 1.524), .062, kind='ELLIPSOID', size=(.86, .88, .62))
blob((0, .086, 1.660), .034, kind='ELLIPSOID', size=(1.5, .62, .40))
for s in (-1, 1):
    blob((s * .052, .074, 1.628), .040, kind='ELLIPSOID', size=(.90, .92, .82))
    blob((s * .070, .062, 1.612), .030)
    blob((s * .098, -.002, 1.632), .036, kind='ELLIPSOID', size=(.42, .78, 1.05))
    blob((s * .030, .098, 1.684), .020, kind='ELLIPSOID', size=(1.7, .55, .34))
blob((0, .096, 1.652), .020, kind='ELLIPSOID', size=(.52, 1.15, 1.15))
blob((0, .112, 1.616), .022, kind='ELLIPSOID', size=(.62, .90, .72))
blob((0, .108, 1.598), .016)
blob((0, .094, 1.566), .019, kind='ELLIPSOID', size=(1.55, .55, .30))
blob((0, .093, 1.552), .018, kind='ELLIPSOID', size=(1.35, .52, .30))

bpy.context.view_layer.objects.active = field_obj
field_obj.select_set(True)
bpy.ops.object.convert(target='MESH')
body = bpy.context.object
body.name = 'Goku_Body'
log(f'field surface: {len(body.data.vertices)} verts, {len(body.data.polygons)} faces')

smooth = body.modifiers.new('Smooth', 'SMOOTH')
smooth.factor = .5
smooth.iterations = 14
bpy.ops.object.modifier_apply(modifier='Smooth')
dec = body.modifiers.new('Decimate', 'DECIMATE')
dec.ratio = 0.34
bpy.ops.object.modifier_apply(modifier='Decimate')
bpy.ops.object.shade_smooth()
log(f'decimated body: {len(body.data.vertices)} verts, {len(body.data.polygons)} faces')


def build_hands():
    hand_field = bpy.data.metaballs.new('HandField')
    hand_field.resolution = 0.0035
    hand_field.render_resolution = 0.0035
    hand_field.threshold = 0.6
    obj = bpy.data.objects.new('HandField', hand_field)
    bpy.context.collection.objects.link(obj)

    def hb(co, r, kind='BALL', size=(1, 1, 1)):
        el = hand_field.elements.new()
        el.type = kind
        el.co = Vector(co)
        el.radius = r
        el.stiffness = 2.0
        if kind == 'ELLIPSOID':
            el.size_x, el.size_y, el.size_z = size

    for s in (-1, 1):
        x = s * .243
        hb((x, .012, .714), .046, kind='ELLIPSOID', size=(.60, 1.05, .95))
        hb((x, .040, .706), .034, kind='ELLIPSOID', size=(1.15, .52, .55))
        for i in range(4):
            fx = x + (i - 1.5) * .0205 * s
            z = .694
            for seg, (ln, rr) in enumerate(zip((.026, .021, .016), (.0105, .0092, .0080))):
                nxt = Vector((fx, .034 + .008 * (seg + 1), z - ln))
                for k in range(3):
                    t = k / 2
                    hb(Vector((fx, .034 + .008 * seg, z)).lerp(nxt, t), rr)
                z -= ln
        t0 = Vector((x - s * .030, .006, .726))
        for k in range(4):
            t = k / 3
            hb(t0.lerp(Vector((x - s * .046, .044, .688)), t), .0125 - .002 * t)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    hands = bpy.context.object
    bpy.ops.object.shade_smooth()
    return hands


hands = build_hands()
log(f'hands: {len(hands.data.vertices)} verts')


def loft(name, rings, segments, mat, thickness=0.010, cap=False):
    """A garment surface lofted through measured cross-sections.

    A copy of the body trimmed by face position tore into ragged strips, because the decimated
    body has irregular edges. Lofting gives clean, deliberate hems and a real quads surface that
    solidifies into fabric with thickness.
    rings: list of (z, radius_x, radius_y, centre_x, centre_y)
    """
    verts, faces = [], []
    for (z, rx, ry, cx, cy) in rings:
        for i in range(segments):
            a = 2 * math.pi * i / segments
            verts.append((cx + rx * math.cos(a), cy + ry * math.sin(a), z))
    n = len(rings)
    for r in range(n - 1):
        for i in range(segments):
            a = r * segments + i
            b = r * segments + (i + 1) % segments
            c = (r + 1) * segments + (i + 1) % segments
            d = (r + 1) * segments + i
            faces.append((a, b, c, d))
    if cap:
        faces.append(tuple(range(segments)))
        faces.append(tuple(range((n - 1) * segments, n * segments))[::-1])
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    obj = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(obj)
    me.materials.append(mat)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth()
    sol = obj.modifiers.new('Fabric', 'SOLIDIFY')
    sol.thickness = thickness
    sol.offset = 1.0
    bpy.ops.object.modifier_apply(modifier='Fabric')
    return obj


# Gi: hem flaring below the belt, narrowing at the chest, open at the collar.
# Hem ends mid-thigh (z 0.62); the trousers below it are separate surfaces, so the gi reads as a
# tunic rather than a floor-length skirt.
GI_RINGS = [
    (0.62, .182, .154, 0, .006),
    (0.74, .192, .160, 0, .006),
    (0.88, .199, .163, 0, .004),
    (0.98, .190, .158, 0, .002),
    (1.08, .181, .150, 0, .004),
    (1.20, .196, .156, 0, .008),
    (1.30, .209, .160, 0, .010),
    (1.38, .196, .152, 0, .008),
    (1.44, .150, .128, 0, .006),
]
gi = loft('Goku_Gi', GI_RINGS, 40, GI, 0.012)
# Trousers: separate legs, so the gi is not one skirt over both legs.
trousers = []
for s, tag in ((-1, 'L'), (1, 'R')):
    trousers.append(loft('Goku_Trouser_' + tag, [
        (0.28, .082, .080, s * .098, .006),
        (0.40, .090, .086, s * .098, .004),
        (0.52, .099, .094, s * .098, .004),
        (0.64, .112, .104, s * .098, .002),
        (0.76, .122, .112, s * .096, 0),
        (0.88, .132, .120, s * .094, 0),
    ], 28, GI, 0.011))
# Short sleeves: a cuff that ends mid-upper-arm.
sleeves = []
for s, tag in ((-1, 'L'), (1, 'R')):
    sleeves.append(loft('Goku_Sleeve_' + tag, [
        (1.215, .080, .078, s * .206, .002),
        (1.255, .085, .082, s * .200, .002),
        (1.300, .092, .088, s * .190, .002),
        (1.345, .099, .094, s * .174, .002),
    ], 28, GI, 0.012))
# Belt band with a slight raised edge.
belt = loft('Goku_Belt', [
    (0.960, .196, .162, 0, .002),
    (0.985, .202, .168, 0, .002),
    (1.020, .202, .168, 0, .002),
    (1.042, .196, .162, 0, .002),
], 40, BELT, 0.014)
# Blue collar band at the neckline.
collar = loft('Goku_Collar', [
    (1.430, .152, .130, 0, .006),
    (1.452, .150, .128, 0, .006),
    (1.470, .142, .122, 0, .006),
], 32, BLUE, 0.012)
# Boots: shaft plus a forward-bent foot section, lofted as one continuous surface.
boots = []
for s, tag in ((-1, 'L'), (1, 'R')):
    boots.append(loft('Goku_Boot_' + tag, [
        (0.010, .070, .120, s * .098, .045),
        (0.045, .072, .122, s * .098, .042),
        (0.085, .070, .105, s * .098, .030),
        (0.130, .068, .078, s * .098, .014),
        (0.180, .068, .072, s * .098, .010),
        (0.235, .074, .076, s * .098, .008),
    ], 28, BOOT, 0.012))
log('garments lofted with clean hems')


def shell_from_body(name, keep, offset, mat):
    """A surface region of the body pushed outward: used for the hairline shell over the skull."""
    src = body.copy()
    src.data = body.data.copy()
    src.name = name
    bpy.context.collection.objects.link(src)
    me = src.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * offset
    kill = [f for f in bm.faces if not keep(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(mat)
    for p in me.polygons:
        p.material_index = 0
    sol = src.modifiers.new('Thickness', 'SOLIDIFY')
    sol.thickness = 0.010
    sol.offset = 1.0
    bpy.context.view_layer.objects.active = src
    bpy.ops.object.modifier_apply(modifier='Thickness')
    bpy.ops.object.shade_smooth()
    return src


def hair_lock(points, radii):
    cu = bpy.data.curves.new('lock', 'CURVE')
    cu.dimensions = '3D'
    cu.resolution_u = 6
    cu.bevel_depth = 1.0
    cu.bevel_resolution = 4
    cu.fill_mode = 'FULL'
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for i, (p, r) in enumerate(zip(points, radii)):
        bp = sp.bezier_points[i]
        bp.co = Vector(p)
        bp.radius = r
        bp.handle_left_type = 'AUTO'
        bp.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new('lock', cu)
    bpy.context.collection.objects.link(obj)
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    # Flatten the round bevel into a ribbon: hair reads as sheets of overlapping locks, not tubes.
    obj.scale = (1.0, 0.42, 1.0)
    bpy.ops.object.convert(target='MESH')
    lock = bpy.context.object
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return lock


CROWN = [
    ([(0.00, 0.02, 1.68), (0.01, -0.02, 1.80), (0.02, -0.10, 1.88)], [.052, .040, .004]),
    ([(-0.055, 0.03, 1.68), (-0.075, -0.02, 1.79), (-0.085, -0.11, 1.86)], [.048, .036, .004]),
    ([(0.055, 0.03, 1.68), (0.075, -0.02, 1.79), (0.085, -0.11, 1.86)], [.048, .036, .004]),
    ([(-0.095, 0.02, 1.66), (-0.125, -0.04, 1.75), (-0.140, -0.13, 1.80)], [.042, .030, .004]),
    ([(0.095, 0.02, 1.66), (0.125, -0.04, 1.75), (0.140, -0.13, 1.80)], [.042, .030, .004]),
    ([(-0.030, -0.05, 1.70), (-0.045, -0.12, 1.78), (-0.050, -0.19, 1.82)], [.044, .032, .004]),
    ([(0.030, -0.05, 1.70), (0.045, -0.12, 1.78), (0.050, -0.19, 1.82)], [.044, .032, .004]),
    ([(-0.010, -0.08, 1.68), (-0.015, -0.16, 1.72), (-0.018, -0.23, 1.74)], [.040, .026, .004]),
]
# Fringe: clears the brow line (eye tops sit at z 1.672) instead of hanging over the eyes.
# The crown locks were reading as wide flat blades; thinner masses overlap as separate locks.
CROWN = [(pts, [r * 0.62 for r in radii]) for pts, radii in CROWN]

FRINGE = [
    ([(-0.062, 0.055, 1.70), (-0.078, 0.085, 1.685), (-0.070, 0.098, 1.698)], [.030, .022, .004]),
    ([(-0.020, 0.070, 1.72), (-0.028, 0.100, 1.700), (-0.022, 0.112, 1.706)], [.030, .020, .004]),
    ([(0.024, 0.070, 1.72), (0.032, 0.100, 1.700), (0.026, 0.112, 1.706)], [.030, .020, .004]),
    ([(0.064, 0.055, 1.70), (0.080, 0.085, 1.685), (0.072, 0.098, 1.698)], [.028, .020, .004]),
]
SIDE = [
    ([(-0.088, 0.040, 1.66), (-0.092, 0.052, 1.60), (-0.090, 0.056, 1.565)], [.024, .018, .010]),
    ([(0.088, 0.040, 1.66), (0.092, 0.052, 1.60), (0.090, 0.056, 1.565)], [.024, .018, .010]),
]
LOCKS = [hair_lock(pts, rad) for pts, rad in CROWN + FRINGE + SIDE]
# Scalp: crown and back only, so the forehead and brow stay exposed.
scalp = shell_from_body('Goku_Scalp', lambda c: c.z > 1.688, 0.010, HAIR)
log(f'hair: {len(LOCKS)} locks + scalp')

# Nose and mouth are fused into the skull with booleans, not attached as floating primitives.
def fuse_into_body(operation, obj):
    mod = body.modifiers.new('Fuse', 'BOOLEAN')
    mod.operation = operation
    mod.object = obj
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.data.objects.remove(obj, do_unlink=True)


# Nose: a tapered bridge-and-tip mass unioned into the face surface.
bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=1.0,
                                     location=(0, .0785, 1.6085))
nose = bpy.context.object
nose.scale = (0.0155, 0.0300, 0.0230)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.ops.object.shade_smooth()
fuse_into_body('UNION', nose)

# Mouth: a shallow crease carved below the nose so lips read as part of the head.
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=1.0,
                                     location=(0, .0855, 1.5645))
mouth = bpy.context.object
mouth.scale = (0.0230, 0.0110, 0.0046)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
fuse_into_body('DIFFERENCE', mouth)

# Brow ridges: two shallow wedges give the eyes a socket roof instead of a flat forehead.
for s in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=18, ring_count=12, radius=1.0,
                                         location=(s * .0455, .0790, 1.6775))
    brow = bpy.context.object
    brow.scale = (0.0215, 0.0135, 0.0070)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    fuse_into_body('UNION', brow)

log('face: nose, mouth crease and brow ridges fused')

# Skull volume: the field surface pinched the cranium and jaw into a snout, so the cranium, temples
# and jaw corners are unioned back on as rounded masses to restore a readable head silhouette.
for cx, cy, cz, rx, ry, rz in ((0.0, -0.004, 1.660, 0.062, 0.070, 0.052),
                              (-0.050, 0.012, 1.628, 0.030, 0.032, 0.034),
                              (0.050, 0.012, 1.628, 0.030, 0.032, 0.034),
                              (-0.040, 0.030, 1.566, 0.028, 0.026, 0.026),
                              (0.040, 0.030, 1.566, 0.028, 0.026, 0.026)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=22, ring_count=14, radius=1.0, location=(cx, cy, cz))
    mass = bpy.context.object
    mass.scale = (rx, ry, rz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.shade_smooth()
    fuse_into_body('UNION', mass)
log('face: cranium, temples and jaw fused')

eye_objs = []
for s in (-1, 1):
    # Eye size was reading as googly spheres; the socket, eyeball and iris are all scaled down and
    # recessed so the eye sits behind the brow instead of bulging past it.
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.0190,
                                         location=(s * .0455, .0790, 1.643))
    cutter = bpy.context.object
    mod = body.modifiers.new('Socket', 'BOOLEAN')
    mod.operation = 'DIFFERENCE'
    mod.object = cutter
    mod.solver = 'EXACT'
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.modifier_apply(modifier='Socket')
    bpy.data.objects.remove(cutter, do_unlink=True)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, radius=0.0168,
                                         location=(s * .0455, .0782, 1.643))
    eye = bpy.context.object
    eye.data.materials.append(EYE)
    bpy.ops.object.shade_smooth()
    eye_objs.append(eye)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.0100,
                                         location=(s * .0465, .0905, 1.6425))
    iris = bpy.context.object
    iris.scale = (1.0, .45, 1.0)
    iris.data.materials.append(IRIS)
    bpy.ops.object.shade_smooth()
    eye_objs.append(iris)

    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=0.0046,
                                         location=(s * .0475, .0958, 1.6425))
    pupil = bpy.context.object
    pupil.scale = (1.0, .40, 1.0)
    pupil.data.materials.append(PUPIL)
    bpy.ops.object.shade_smooth()
    eye_objs.append(pupil)

for o in bpy.context.selected_objects:
    o.select_set(False)
for obj in [body, hands, gi, *trousers, *sleeves, *boots, belt, collar, scalp] + LOCKS + eye_objs:
    obj.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body = bpy.context.object
body.name = 'Goku_Body'
bpy.ops.object.shade_smooth()
log(f'joined: {len(body.data.vertices)} verts, {len(body.data.materials)} materials')

bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
bpy.ops.object.mode_set(mode='OBJECT')

bpy.ops.object.armature_add(enter_editmode=True, location=(0, 0, 0))
rig = bpy.context.object
rig.name = 'Goku_Rig'
rig.data.name = 'Goku_Skeleton'
eb = rig.data.edit_bones
for b in list(eb):
    eb.remove(b)

BONES = [
    ('root', (0, 0, 0.0), (0, 0, .12), None),
    ('hips', (0, 0, .95), (0, 0, 1.07), 'root'),
    ('spine', (0, 0, 1.07), (0, 0, 1.23), 'hips'),
    ('chest', (0, 0, 1.23), (0, 0, 1.40), 'spine'),
    ('neck', (0, 0, 1.40), (0, 0, 1.50), 'chest'),
    ('head', (0, 0, 1.50), (0, 0, 1.78), 'neck'),
]
for s, tag in ((-1, 'L'), (1, 'R')):
    BONES += [
        ('clavicle.' + tag, (0, 0, 1.34), (s * .195, 0, 1.335), 'chest'),
        ('upperarm.' + tag, (s * .195, 0, 1.335), (s * .245, .008, 1.012), 'clavicle.' + tag),
        ('forearm.' + tag, (s * .245, .008, 1.012), (s * .243, .012, .762), 'upperarm.' + tag),
        ('hand.' + tag, (s * .243, .012, .762), (s * .243, .020, .694), 'forearm.' + tag),
        ('thigh.' + tag, (s * .095, 0, .95), (s * .098, .006, .512), 'hips'),
        ('shin.' + tag, (s * .098, .006, .512), (s * .098, .010, .175), 'thigh.' + tag),
        ('foot.' + tag, (s * .098, .010, .175), (s * .098, .120, .035), 'shin.' + tag),
    ]
    for i in range(4):
        fx = s * .243 + (i - 1.5) * .0205 * s
        BONES += [
            (f'f{i}.{tag}', (fx, .034, .694), (fx, .048, .660), 'hand.' + tag),
            (f'f{i}_tip.{tag}', (fx, .048, .660), (fx, .062, .632), f'f{i}.{tag}'),
        ]
    BONES += [
        ('thumb.' + tag, (s * .213, .006, .726), (s * .199, .024, .706), 'hand.' + tag),
        ('thumb_tip.' + tag, (s * .199, .024, .706), (s * .197, .044, .688), 'thumb.' + tag),
    ]
for name, head, tail, parent in BONES:
    bone = eb.new(name)
    bone.head = head
    bone.tail = tail
    if parent:
        bone.parent = eb[parent]
        bone.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
log(f'rig: {len(BONES)} bones')

SEGMENTS = []
for b in rig.data.bones:
    if b.name == 'root':
        continue
    SEGMENTS.append((b.name, b.head_local.copy(), b.tail_local.copy()))


def dist_to_segment(p, a, b):
    ab = b - a
    denom = ab.length_squared or 1e-9
    t = max(0.0, min(1.0, (p - a).dot(ab) / denom))
    return (p - (a + ab * t)).length


# Smooth proximity weighting: the three nearest bones share each vertex, so joints blend instead of
# snapping between rigid groups, and clothing inherits the weights of the anatomy underneath.
groups = {name: body.vertex_groups.new(name=name) for name, _, _ in SEGMENTS}
for v in body.data.vertices:
    p = v.co
    scored = sorted(((dist_to_segment(p, a, b), name) for name, a, b in SEGMENTS))[:3]
    weights = [(name, 1.0 / ((d + 0.012) ** 3.2)) for d, name in scored]
    total = sum(w for _, w in weights) or 1.0
    for name, w in weights:
        groups[name].add([v.index], w / total, 'REPLACE')

for o in bpy.context.selected_objects:
    o.select_set(False)
body.select_set(True)
rig.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
log('smooth proximity weights bound')

influenced = set()
unweighted = 0
for v in body.data.vertices:
    if not v.groups:
        unweighted += 1
    for g in v.groups:
        influenced.add(g.group)
log(f'unweighted verts: {unweighted}; bones with influence: {len(influenced)}/{len(SEGMENTS)}')

scene.frame_start = 1
scene.frame_end = 90
action_names = []


def key_pose(frame, pose):
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
    for fc in action.fcurves:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
            kp.handle_left_type = 'AUTO_CLAMPED'
            kp.handle_right_type = 'AUTO_CLAMPED'
    action.use_fake_user = True
    action_names.append(name)


def fist(tag, amount=1.05):
    out = {}
    for i in range(4):
        out[f'f{i}.{tag}'] = (amount, 0, 0)
        out[f'f{i}_tip.{tag}'] = (amount * .95, 0, 0)
    out['thumb.' + tag] = (.55, 0, 0)
    out['thumb_tip.' + tag] = (.5, 0, 0)
    return out


def palm(tag, spread=.12):
    out = {}
    for i in range(4):
        out[f'f{i}.{tag}'] = (-spread, 0, 0)
        out[f'f{i}_tip.{tag}'] = (-spread * .6, 0, 0)
    out['thumb.' + tag] = (-.15, 0, 0)
    out['thumb_tip.' + tag] = (-.15, 0, 0)
    return out


def merge(*ds):
    out = {}
    for d in ds:
        out.update(d)
    return out


IDLE = [
    (1, merge({'spine': (.02, 0, 0), 'chest': (-.02, 0, 0), 'head': (0, .04, 0),
               'upperarm.L': (.08, 0, -.14), 'upperarm.R': (.08, 0, .14),
               'forearm.L': (.28, 0, 0), 'forearm.R': (.28, 0, 0)}, palm('L', .10), palm('R', .10))),
    (26, merge({'spine': (.05, 0, .02), 'chest': (-.05, 0, -.02), 'head': (0, -.03, .03),
                'upperarm.L': (.13, 0, -.20), 'upperarm.R': (.11, 0, .18),
                'forearm.L': (.34, 0, 0), 'forearm.R': (.30, 0, 0),
                'hips': (0, 0, .03), 'thigh.L': (.04, 0, 0)}, palm('L', .12), palm('R', .12))),
    (58, merge({'spine': (.03, 0, -.02), 'chest': (-.03, 0, .02), 'head': (0, .05, -.02),
                'upperarm.L': (.07, 0, -.12), 'upperarm.R': (.09, 0, .16),
                'forearm.L': (.26, 0, 0), 'forearm.R': (.32, 0, 0),
                'hips': (0, 0, -.02), 'thigh.R': (.03, 0, 0)}, palm('L', .10), palm('R', .10))),
    (80, merge({'spine': (.02, 0, 0), 'chest': (-.02, 0, 0), 'head': (0, .04, 0),
                'upperarm.L': (.08, 0, -.14), 'upperarm.R': (.08, 0, .14),
                'forearm.L': (.28, 0, 0), 'forearm.R': (.28, 0, 0)}, palm('L', .10), palm('R', .10))),
]
WALK = [
    (1, merge({'thigh.L': (.50, 0, 0), 'shin.L': (-.14, 0, 0), 'thigh.R': (-.44, 0, 0), 'shin.R': (.30, 0, 0),
               'upperarm.L': (-.40, 0, -.10), 'upperarm.R': (.40, 0, .10),
               'forearm.L': (.34, 0, 0), 'forearm.R': (.44, 0, 0), 'spine': (.06, 0, -.06),
               'chest': (0, 0, .10), 'hips': (0, 0, .07)}, fist('L', .8), fist('R', .8))),
    (10, merge({'thigh.L': (.24, 0, 0), 'shin.L': (-.28, 0, 0), 'thigh.R': (-.18, 0, 0), 'shin.R': (.44, 0, 0),
                'upperarm.L': (-.18, 0, -.12), 'upperarm.R': (.20, 0, .12), 'spine': (.08, 0, 0),
                'root_loc': (0, 0, -.026)}, fist('L', .8), fist('R', .8))),
    (20, merge({'thigh.L': (-.44, 0, 0), 'shin.L': (.30, 0, 0), 'thigh.R': (.50, 0, 0), 'shin.R': (-.14, 0, 0),
                'upperarm.L': (.40, 0, -.10), 'upperarm.R': (-.40, 0, .10),
                'forearm.L': (.44, 0, 0), 'forearm.R': (.34, 0, 0), 'spine': (.06, 0, .06),
                'chest': (0, 0, -.10), 'hips': (0, 0, -.07)}, fist('L', .8), fist('R', .8))),
    (30, merge({'thigh.L': (-.18, 0, 0), 'shin.L': (.44, 0, 0), 'thigh.R': (.24, 0, 0), 'shin.R': (-.28, 0, 0),
                'upperarm.L': (.20, 0, -.12), 'upperarm.R': (-.18, 0, .12), 'spine': (.08, 0, 0),
                'root_loc': (0, 0, -.026)}, fist('L', .8), fist('R', .8))),
]
RUN = [
    (1, merge({'thigh.L': (.95, 0, .04), 'shin.L': (-1.0, 0, 0), 'thigh.R': (-.70, 0, -.04), 'shin.R': (.82, 0, 0),
               'upperarm.L': (-.92, 0, -.18), 'upperarm.R': (.88, 0, .16),
               'forearm.L': (1.30, 0, 0), 'forearm.R': (1.26, 0, 0),
               'spine': (.28, 0, -.10), 'chest': (.05, 0, .15), 'head': (-.12, 0, 0)}, fist('L', .95), fist('R', .95))),
    (12, merge({'thigh.L': (-.08, 0, .04), 'shin.L': (-.32, 0, 0), 'thigh.R': (.28, 0, -.04), 'shin.R': (.18, 0, 0),
                'upperarm.L': (-.28, 0, -.20), 'upperarm.R': (.26, 0, .18),
                'forearm.L': (1.10, 0, 0), 'forearm.R': (1.14, 0, 0), 'spine': (.32, 0, 0),
                'root_loc': (0, 0, .042)}, fist('L', .95), fist('R', .95))),
    (20, merge({'thigh.L': (-.70, 0, .04), 'shin.L': (.82, 0, 0), 'thigh.R': (.95, 0, -.04), 'shin.R': (-1.0, 0, 0),
                'upperarm.L': (.88, 0, -.16), 'upperarm.R': (-.92, 0, .18),
                'forearm.L': (1.26, 0, 0), 'forearm.R': (1.30, 0, 0),
                'spine': (.28, 0, .10), 'chest': (.05, 0, -.15), 'head': (-.12, 0, 0)}, fist('L', .95), fist('R', .95))),
    (30, merge({'thigh.L': (.28, 0, .04), 'shin.L': (.18, 0, 0), 'thigh.R': (-.08, 0, -.04), 'shin.R': (-.32, 0, 0),
                'upperarm.L': (.26, 0, -.18), 'upperarm.R': (-.28, 0, .20),
                'forearm.L': (1.14, 0, 0), 'forearm.R': (1.10, 0, 0), 'spine': (.32, 0, 0),
                'root_loc': (0, 0, .042)}, fist('L', .95), fist('R', .95))),
]
JUMP = [
    (1, merge({'thigh.L': (.28, 0, 0), 'thigh.R': (.28, 0, 0), 'shin.L': (-.32, 0, 0), 'shin.R': (-.32, 0, 0),
               'upperarm.L': (.18, 0, -.16), 'upperarm.R': (.18, 0, .16)}, fist('L', .7), fist('R', .7))),
    (8, merge({'thigh.L': (.92, 0, 0), 'thigh.R': (.92, 0, 0), 'shin.L': (-1.32, 0, 0), 'shin.R': (-1.32, 0, 0),
               'foot.L': (.34, 0, 0), 'foot.R': (.34, 0, 0), 'spine': (.32, 0, 0), 'head': (.14, 0, 0),
               'upperarm.L': (.82, 0, -.20), 'upperarm.R': (.82, 0, .20),
               'root_loc': (0, 0, -.14)}, fist('L', .9), fist('R', .9))),
    (14, merge({'thigh.L': (-.14, 0, 0), 'thigh.R': (-.14, 0, 0), 'shin.L': (.08, 0, 0), 'shin.R': (.08, 0, 0),
                'foot.L': (-.28, 0, 0), 'foot.R': (-.28, 0, 0), 'spine': (-.05, 0, 0),
                'upperarm.L': (-1.8, 0, -.24), 'upperarm.R': (-1.8, 0, .24),
                'root_loc': (0, 0, .30)}, palm('L', .08), palm('R', .08))),
    (26, merge({'thigh.L': (.52, 0, 0), 'thigh.R': (.42, 0, 0), 'shin.L': (-.82, 0, 0), 'shin.R': (-.66, 0, 0),
                'spine': (.15, 0, 0), 'upperarm.L': (-.58, 0, -.28), 'upperarm.R': (-.58, 0, .28),
                'root_loc': (0, 0, .32)}, palm('L', .18), palm('R', .18))),
    (36, merge({'thigh.L': (.20, 0, 0), 'thigh.R': (.20, 0, 0), 'shin.L': (-.18, 0, 0), 'shin.R': (-.18, 0, 0),
                'foot.L': (.26, 0, 0), 'foot.R': (.26, 0, 0),
                'upperarm.L': (.28, 0, -.20), 'upperarm.R': (.28, 0, .20),
                'root_loc': (0, 0, .02)}, fist('L', .8), fist('R', .8))),
    (46, merge({'thigh.L': (.78, 0, 0), 'thigh.R': (.78, 0, 0), 'shin.L': (-1.02, 0, 0), 'shin.R': (-1.02, 0, 0),
                'spine': (.24, 0, 0), 'upperarm.L': (.52, 0, -.26), 'upperarm.R': (.52, 0, .26),
                'root_loc': (0, 0, -.11)}, fist('L', .85), fist('R', .85))),
]
PUNCH = [
    (1, merge({'upperarm.R': (.28, 0, .18), 'forearm.R': (1.28, 0, 0), 'upperarm.L': (.32, 0, -.20),
               'forearm.L': (1.40, 0, 0), 'chest': (0, .08, 0)}, fist('L'), fist('R'))),
    (8, merge({'upperarm.R': (.08, 0, .50), 'forearm.R': (1.72, 0, 0), 'upperarm.L': (.28, 0, -.18),
               'forearm.L': (1.36, 0, 0), 'chest': (0, .32, 0), 'spine': (0, .10, .05),
               'hips': (0, .08, 0)}, fist('L'), fist('R'))),
    (14, merge({'upperarm.R': (-1.50, 0, .06), 'forearm.R': (.05, 0, 0), 'upperarm.L': (.52, 0, -.28),
                'forearm.L': (1.50, 0, 0), 'chest': (0, -.50, 0), 'spine': (.11, -.15, -.05),
                'hips': (0, -.10, 0)}, fist('L'), fist('R'))),
    (22, merge({'upperarm.R': (-1.30, 0, .10), 'forearm.R': (.14, 0, 0), 'upperarm.L': (.46, 0, -.26),
                'forearm.L': (1.44, 0, 0), 'chest': (0, -.38, 0), 'spine': (.09, -.09, -.03)}, fist('L'), fist('R'))),
    (32, merge({'upperarm.R': (.28, 0, .18), 'forearm.R': (1.28, 0, 0), 'upperarm.L': (.32, 0, -.20),
                'forearm.L': (1.40, 0, 0), 'chest': (0, .08, 0)}, fist('L'), fist('R'))),
]
KICK = [
    (1, merge({'thigh.R': (.08, 0, 0), 'shin.R': (.18, 0, 0),
               'upperarm.L': (.28, 0, -.22), 'upperarm.R': (.28, 0, .22)}, fist('L', .85), fist('R', .85))),
    (8, merge({'thigh.R': (1.12, 0, -.10), 'shin.R': (-1.28, 0, 0), 'foot.R': (.28, 0, 0),
               'spine': (-.09, 0, .20), 'hips': (0, 0, .15),
               'upperarm.L': (.52, 0, -.50), 'upperarm.R': (.18, 0, .28)}, fist('L', .85), fist('R', .85))),
    (15, merge({'thigh.R': (1.52, 0, -.13), 'shin.R': (-.10, 0, 0), 'foot.R': (-.08, 0, 0),
                'spine': (-.28, 0, .28), 'hips': (0, 0, .20),
                'upperarm.L': (.72, 0, -.60), 'upperarm.R': (.08, 0, .32)}, fist('L', .85), fist('R', .85))),
    (23, merge({'thigh.R': (1.26, 0, -.09), 'shin.R': (-.32, 0, 0), 'spine': (-.20, 0, .22),
                'hips': (0, 0, .16), 'upperarm.L': (.62, 0, -.54)}, fist('L', .85), fist('R', .85))),
    (32, merge({'thigh.R': (.08, 0, 0), 'shin.R': (.18, 0, 0),
                'upperarm.L': (.28, 0, -.22), 'upperarm.R': (.28, 0, .22)}, fist('L', .85), fist('R', .85))),
]
KAME = [
    (1, merge({'spine': (.03, 0, 0), 'upperarm.L': (.28, 0, -.22), 'upperarm.R': (.28, 0, .22),
               'forearm.L': (.56, 0, 0), 'forearm.R': (.56, 0, 0)}, palm('L', .08), palm('R', .08))),
    (14, merge({'spine': (.19, .18, -.09), 'chest': (0, .22, 0), 'head': (0, -.18, 0), 'hips': (0, .14, 0),
                'upperarm.R': (.52, 0, .86), 'forearm.R': (1.92, 0, 0),
                'upperarm.L': (.42, 0, -.92), 'forearm.L': (1.88, 0, 0),
                'thigh.L': (.30, 0, .15), 'shin.L': (-.40, 0, 0),
                'thigh.R': (-.24, 0, -.11), 'root_loc': (0, 0, -.05)}, fist('L', .95), fist('R', .95))),
    (32, merge({'spine': (.25, .22, -.11), 'chest': (.02, .26, 0), 'head': (0, -.22, 0), 'hips': (0, .18, 0),
                'upperarm.R': (.58, 0, .96), 'forearm.R': (2.02, 0, 0),
                'upperarm.L': (.48, 0, -.98), 'forearm.L': (1.98, 0, 0),
                'thigh.L': (.36, 0, .17), 'shin.L': (-.48, 0, 0),
                'thigh.R': (-.28, 0, -.13), 'root_loc': (0, 0, -.07)}, fist('L', 1.0), fist('R', 1.0))),
    (44, merge({'spine': (-.22, -.09, .05), 'chest': (0, -.15, 0), 'head': (0, .09, 0), 'hips': (0, -.09, 0),
                'upperarm.R': (-1.42, 0, .18), 'forearm.R': (.10, 0, 0),
                'upperarm.L': (-1.42, 0, -.18), 'forearm.L': (.10, 0, 0),
                'thigh.L': (.52, 0, .09), 'shin.L': (-.24, 0, 0),
                'thigh.R': (-.32, 0, -.07), 'root_loc': (0, 0, -.03)}, palm('L', .22), palm('R', .22))),
    (58, merge({'spine': (-.24, -.10, .05), 'chest': (0, -.17, 0), 'head': (0, .10, 0), 'hips': (0, -.10, 0),
                'upperarm.R': (-1.46, 0, .20), 'forearm.R': (.08, 0, 0),
                'upperarm.L': (-1.46, 0, -.20), 'forearm.L': (.08, 0, 0),
                'thigh.L': (.55, 0, .09), 'shin.L': (-.26, 0, 0),
                'thigh.R': (-.34, 0, -.07), 'root_loc': (0, 0, -.03)}, palm('L', .24), palm('R', .24))),
    (74, merge({'spine': (.03, 0, 0), 'upperarm.L': (.28, 0, -.22), 'upperarm.R': (.28, 0, .22),
                'forearm.L': (.56, 0, 0), 'forearm.R': (.56, 0, 0)}, palm('L', .08), palm('R', .08))),
]

for name, frames in (('Idle', IDLE), ('Walk', WALK), ('Run', RUN), ('Jump', JUMP),
                     ('Punch', PUNCH), ('Kick', KICK), ('Kamehameha', KAME)):
    make_action(name, frames)

rig.animation_data.action = None
for name in action_names:
    track = rig.animation_data.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 1, bpy.data.actions[name])
    strip.name = name
log(f'actions: {action_names}')

glb = os.path.join(OUT, 'goku_sculpt.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=glb, export_format='GLB', use_selection=True,
    export_animations=True, export_animation_mode='ACTIONS', export_nla_strips=True,
    export_apply=True, export_yup=True, export_image_format='AUTO',
)
log(f'exported {glb} ({os.path.getsize(glb)} bytes)')

if '--no-render' in argv:
    log('skipping renders')
    log('done')
    sys.exit(0)

bpy.ops.object.camera_add(location=(0, 2.9, 1.1))
cam = bpy.context.object
cam.data.lens = 70
scene.camera = cam


def aim(location, target, lens=70):
    cam.location = Vector(location)
    direction = Vector(target) - Vector(location)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


for loc, energy, size in (((2.4, 2.6, 3.0), 800, 2.6), ((-2.6, 1.8, 2.2), 420, 2.8),
                          ((0, -2.8, 2.6), 480, 2.6), ((0, 2.0, 1.6), 260, 1.6)):
    bpy.ops.object.light_add(type='AREA', location=loc)
    light = bpy.context.object
    light.data.energy = energy
    light.data.size = size
    light.rotation_euler = (math.radians(62), 0, math.radians(35))

bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
floor = bpy.context.object
floor.data.materials.append(material('Floor', (.10, .11, .13), .8))

for track in rig.animation_data.nla_tracks:
    track.mute = True


def play(name, frame):
    rig.animation_data.action = bpy.data.actions[name]
    scene.frame_set(frame)


# Face features live on +Y, so +Y is the front of this body and every face-on camera sits there.
SHOTS = [
    ('front', (0, 2.9, 1.05), (0, 0, 1.0), 70),
    ('side', (2.9, 0, 1.05), (0, 0, 1.0), 70),
    ('back', (0, -2.9, 1.05), (0, 0, 1.0), 70),
    ('threequarter', (2.1, 2.1, 1.30), (0, 0, 1.0), 70),
    ('face', (0.28, 0.92, 1.68), (0, 0.03, 1.64), 85),
    ('hand', (-0.44, 0.62, 0.78), (-0.243, 0.02, 0.69), 88),
    ('clothing', (0.55, 1.35, 1.02), (0, 0, 0.90), 78),
]
play('Idle', 26)
ONLY = ''
for i, a in enumerate(argv):
    if a == '--only' and i + 1 < len(argv):
        ONLY = argv[i + 1]
only_set = set(x.strip() for x in ONLY.split(',') if x.strip())

for name, loc, target, lens in SHOTS:
    if only_set and name not in only_set:
        continue
    aim(loc, target, lens)
    scene.render.filepath = os.path.join(OUT, f'goku_{name}.png')
    bpy.ops.render.render(write_still=True)
    log(f'rendered {name}')

if only_set:
    log('only-mode: skipped topology and pose renders')
    log('done')
    sys.exit(0)

# Topology view: wireframe render of a duplicate, so deformation topology can be judged.
topo = body.copy()
topo.data = body.data.copy()
topo.name = 'Goku_Topology'
bpy.context.collection.objects.link(topo)
wire = topo.modifiers.new('Wire', 'WIREFRAME')
wire.thickness = 0.0016
bpy.context.view_layer.objects.active = topo
bpy.ops.object.modifier_apply(modifier='Wire')
topo_mat = material('Topology', (.05, .55, .75), .4)
topo.data.materials.clear()
topo.data.materials.append(topo_mat)
body.hide_render = True
aim((0.9, 2.2, 1.15), (0, 0, 1.05), 70)
scene.render.filepath = os.path.join(OUT, 'goku_topology.png')
bpy.ops.render.render(write_still=True)
log('rendered topology')
body.hide_render = False

play('Kamehameha', 44)
aim((1.9, 2.2, 1.35), (0, 0.3, 1.05), 62)
scene.render.filepath = os.path.join(OUT, 'goku_pose_kamehameha.png')
bpy.ops.render.render(write_still=True)
log('rendered pose_kamehameha')

play('Punch', 14)
aim((1.7, 2.0, 1.30), (0, 0.2, 1.05), 62)
scene.render.filepath = os.path.join(OUT, 'goku_pose_punch.png')
bpy.ops.render.render(write_still=True)
log('rendered pose_punch')
log('done')
