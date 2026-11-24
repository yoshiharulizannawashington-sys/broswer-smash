# Regression test for the zero-depth loft defect, plus the geometry-quality gates the model needs.
#
#   bash scripts/blender.sh -b --python scripts/test-geometry-kernel.py
#   npm run test:geometry
#
# Why this file exists: the first version of build_anime_fighter.py built every lofted part by
# sweeping a ring in a *vertical* plane and then stacking those rings along the same axis, so the
# torso, gi, arms, legs and head all came out as paper cutouts with 0.000 m of depth. It looked
# plausible in the viewport because the parts were double-sided, and it only showed up as a
# stippled chest where the gi shell and the torso occupied the same plane. The defect is now
# impossible to reintroduce silently:
#
#   * `legacy_loft` below is the defective kernel, kept verbatim in behaviour. It MUST fail the
#     depth probe - if it ever passes, the probe has stopped detecting the bug it exists for.
#   * the same section data through the repaired `loft` MUST pass on several body parts.
#   * every part of the real body is then checked for depth, degenerate faces, non-manifold
#     edges, outward winding (positive signed volume) and UVs, with the intentional fabric
#     bands listed as documented exceptions.
#   * the gi and the torso under it are checked with nearest-surface queries, because two layers
#     living in nearly the same plane is what produced the original z-fighting.
#
# This runs inside Blender, because the thing under test imports bpy and authors real meshes.
import importlib.util
import math
import os
import sys

import bmesh
import bpy
from mathutils.bvhtree import BVHTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODULE = os.path.join(ROOT, 'assets', 'blender', 'build_anime_fighter.py')
TAU = math.pi * 2

spec = importlib.util.spec_from_file_location('kaze_build', MODULE)
kaze = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kaze)

CHECKS = 0
FAILURES = []


def check(label, condition, detail=''):
    global CHECKS
    CHECKS += 1
    if condition:
        print('  ok  %s' % label)
    else:
        print('  FAIL %s%s' % (label, (' :: ' + detail) if detail else ''))
        FAILURES.append(label)


# --------------------------------------------------------------------- the defective kernel
# Reproduced exactly as it was: the ring is swept in the X-Z plane at a constant Y, so the part has
# width and height but no depth at all, and consecutive sections differ only in Z.
def legacy_loft(name, sections, material, segments=20):
    verts, faces = [], []
    count = len(sections)
    for index, section in enumerate(sections):
        cx, cy, cz = section.get('x', 0.0), section.get('y', 0.0), section.get('z', 0.0)
        rx = section['rx']
        ry = section.get('ry', rx)
        for i in range(segments):
            angle = (i / segments) * TAU
            verts.append((cx + math.cos(angle) * rx, cy, cz + math.sin(angle) * ry))
    for ring in range(count - 1):
        for i in range(segments):
            a = ring * segments + i
            b = ring * segments + ((i + 1) % segments)
            c = (ring + 1) * segments + i
            d = (ring + 1) * segments + ((i + 1) % segments)
            faces.append((a, b, d, c))
    return _raw_object(name, verts, faces, material)


def _raw_object(name, verts, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    obj.data.materials.append(material)
    bpy.context.collection.objects.link(obj)
    return obj


# --------------------------------------------------------------------- the probe
def band_depths(obj, band=0.05, min_verts=8):
    """Depth (Y extent) of the geometry in each 5 cm height band, in metres."""
    out = []
    co = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    if not co:
        return out
    low = math.floor(min(c.z for c in co) / band) * band
    high = max(c.z for c in co)
    cursor = low
    while cursor <= high:
        slab = [c for c in co if cursor <= c.z < cursor + band]
        if len(slab) >= min_verts:
            out.append((round(cursor, 3), len(slab),
                        max(c.y for c in slab) - min(c.y for c in slab),
                        max(c.x for c in slab) - min(c.x for c in slab)))
        cursor += band
    return out


def flat_bands(obj):
    """Bands that are wide but have essentially no depth: the signature of the defect.

    The width floor is deliberately low (6 cm) so a forearm or a finger can be tested with the
    same probe as the torso; before the fix *every* part was 0.000 m deep, whatever its width.
    """
    return [(z, width, depth) for z, _, depth, width in band_depths(obj)
            if depth < 0.02 and width > 0.06]


def mesh_stats(obj):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    stats = {
        'degenerate': sum(1 for face in bm.faces if face.calc_area() < 1e-9),
        'boundary': sum(1 for edge in bm.edges if len(edge.link_faces) < 2),
        'nonmanifold': sum(1 for edge in bm.edges if len(edge.link_faces) > 2),
        'volume': bm.calc_volume(signed=True),
        'uv': bool(obj.data.uv_layers),
    }
    bm.free()
    return stats


kaze.reset_scene()
kaze.build_materials()
MATERIAL = kaze.PALETTE['skin']

# Three different parts, not just a torso: a narrow limb, a wide torso and a tall leg.
CASES = {
    'torso-like': [
        {'z': 0.90, 'rx': 0.138, 'ry': 0.094},
        {'z': 1.03, 'rx': 0.136, 'ry': 0.093},
        {'z': 1.16, 'rx': 0.146, 'ry': 0.099},
        {'z': 1.33, 'rx': 0.190, 'ry': 0.110},
    ],
    'limb-like': [
        {'x': 0.20, 'z': 1.22, 'rx': 0.055, 'ry': 0.055},
        {'x': 0.26, 'z': 1.10, 'rx': 0.048, 'ry': 0.048},
        {'x': 0.30, 'z': 0.94, 'rx': 0.040, 'ry': 0.040},
    ],
    'leg-like': [
        {'x': 0.10, 'z': 0.94, 'rx': 0.075, 'ry': 0.080},
        {'x': 0.09, 'z': 0.52, 'rx': 0.055, 'ry': 0.058},
        {'x': 0.09, 'z': 0.12, 'rx': 0.042, 'ry': 0.045},
    ],
}

print('\n[1] the defect is still detectable: the old vertical-plane kernel must fail')
for name, sections in CASES.items():
    legacy = legacy_loft('legacy-' + name, sections, MATERIAL)
    depths = band_depths(legacy)
    worst = max((depth for _, _, depth, _ in depths), default=0.0)
    check('legacy %s is flagged as flat' % name, len(flat_bands(legacy)) > 0,
          'worst band depth %.4f m' % worst)
    check('legacy %s really has no depth' % name, worst < 0.001, '%.4f m' % worst)

# Per case, the depth the part has to reach at its widest point. The bands at the very ends of a
# loft only ever contain the cap, so a minimum-over-bands threshold would measure the taper rather
# than the solidity; the flat-band probe above is the gate for "no sheet anywhere".
MIN_DEPTH = {'torso-like': 0.18, 'limb-like': 0.09, 'leg-like': 0.14}

print('\n[2] the repaired kernel gives the same sections real volume')
for name, sections in CASES.items():
    fixed = kaze.loft('fixed-' + name, sections, MATERIAL)
    depth = max((depth for _, _, depth, _ in band_depths(fixed)), default=0.0)
    check('repaired %s fills every height band' % name,
          len(band_depths(fixed)) > 0 and len(flat_bands(fixed)) == 0,
          'flat bands: %s' % flat_bands(fixed))
    check('repaired %s is a real volume (%.3f m deep)' % (name, depth),
          depth >= MIN_DEPTH[name], 'needs %.2f m' % MIN_DEPTH[name])
    stats = mesh_stats(fixed)
    check('repaired %s is a closed, outward-facing, UV-mapped volume' % name,
          stats['boundary'] == 0 and stats['nonmanifold'] == 0 and stats['degenerate'] == 0
          and stats['volume'] > 0 and stats['uv'],
          str(stats))

print('\n[3] the real body: every generated part')
# Bands (sash, wraps, sleeves) are closed tubes with rims, so nothing here is allowed an open
# boundary. This set used to hold the sash and wraps, which were "documented exceptions" for a seam
# that turned out to be a duplicated column in shell(): the fix was in the kernel, not in the docs.
OPEN_BANDS = set()
parts = kaze.build_body()
by_name = {part.name: part for part in parts}

check('the body is built from many parts', len(parts) >= 60, '%d parts' % len(parts))

for part in parts:
    stats = mesh_stats(part)
    check('%s: no degenerate faces' % part.name, stats['degenerate'] == 0, str(stats['degenerate']))
    check('%s: no non-manifold edges' % part.name, stats['nonmanifold'] == 0, str(stats['nonmanifold']))
    check('%s: outward winding' % part.name, stats['volume'] > 0, 'signed volume %.6f' % stats['volume'])
    check('%s: has UVs' % part.name, stats['uv'])
    if part.name in OPEN_BANDS:
        check('%s: open hem is the documented exception' % part.name, stats['boundary'] > 0,
              'expected an open band, found a closed one')
    else:
        check('%s: closed surface' % part.name, stats['boundary'] == 0, str(stats['boundary']))

# Depth of the parts that carry the silhouette, measured on the finished model rather than on
# the kernel's own test cases.
for name, minimum in (('torso', 0.20), ('gi-jacket', 0.20), ('head', 0.15),
                      ('arm-L', 0.09), ('leg-L', 0.15), ('boot-L', 0.15)):
    part = by_name.get(name)
    check('%s exists' % name, part is not None)
    if not part:
        continue
    depth = max((depth for _, _, depth, _ in band_depths(part, band=0.08)), default=0.0)
    check('%s is a volume, not a sheet (%.3f m deep)' % (name, depth),
          depth >= minimum, 'needs %.2f m' % minimum)
    check('%s has no flat bands' % name, len(flat_bands(part)) == 0, str(flat_bands(part)))

print('\n[4] the gi is offset from the body it covers, so it cannot z-fight')
torso = by_name['torso']
jacket = by_name['gi-jacket']
torso_bvh = BVHTree.FromObject(torso, bpy.context.evaluated_depsgraph_get())
near = 0
closest = 1.0
sampled = 0
for index, vertex in enumerate(jacket.data.vertices):
    if index % 3:
        continue
    world = jacket.matrix_world @ vertex.co
    local = torso.matrix_world.inverted() @ world
    hit, normal, face_index, distance = torso_bvh.find_nearest(local)
    if hit is None:
        continue
    sampled += 1
    closest = min(closest, distance)
    if distance < 0.002:
        near += 1
check('sampled the jacket against the torso', sampled > 100, '%d samples' % sampled)
check('no jacket vertex sits inside 2 mm of the torso', near == 0, '%d coincident of %d' % (near, sampled))
check('the jacket clears the torso by at least 3 mm', closest >= 0.003, 'closest %.4f m' % closest)
check('the jacket does not float off the body', closest < 0.06, 'closest %.4f m' % closest)

print('\n[5] the model is grounded and the right size')
body = kaze.join_parts(parts)
zs = [vertex.co.z for vertex in body.data.vertices]
height = max(zs) - min(zs)
check('body height is a fighter-sized 1.70-1.90 m', 1.70 <= height <= 1.90, '%.3f m' % height)
check('feet sit on the origin plane', abs(min(zs)) < 0.02, 'lowest vertex %.4f m' % min(zs))

print('\n[6] every vertex is bound to a bone the armature actually has')
# This is the regression for the silent-bind bug: vertex groups named 'LArm' against a bone named
# 'LeftArm' bind nothing, and Blender's glTF exporter then writes those vertices to a generated
# `neutral_bone`, so the limbs never move. A fresh body is built here because join_parts() consumes
# the objects section [3] measured.
bound_parts = kaze.build_body()
kaze.weight_parts(bound_parts)
armature = kaze.build_armature()
bone_names = {bone.name for bone in armature.data.bones}
unbound = 0
orphans = set()
influenced = {}
for part in bound_parts:
    for group in part.vertex_groups:
        if group.name not in bone_names:
            orphans.add(group.name)
    for vertex in part.data.vertices:
        if not vertex.groups:
            unbound += 1
            continue
        for assignment in vertex.groups:
            name = part.vertex_groups[assignment.group].name
            influenced[name] = influenced.get(name, 0) + 1
check('no vertex is left unweighted', unbound == 0, '%d unweighted' % unbound)
check('every vertex group names a real bone', not orphans, 'orphan groups: %s' % sorted(orphans))
for bone in ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
             'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot',
             'Hips', 'Spine', 'Chest', 'Neck', 'Head']:
    check('%s deforms geometry' % bone, influenced.get(bone, 0) > 20,
          '%d vertices' % influenced.get(bone, 0))

print('\n%d checks, %d failed' % (CHECKS, len(FAILURES)))
if FAILURES:
    print('GEOMETRY KERNEL TEST FAILED')
    for label in FAILURES:
        print('  - ' + label)
    sys.exit(1)
print('Geometry kernel test passed: the loft defect is detected, the repaired kernel is solid, '
      'and every body part is a closed, outward-facing volume.')
