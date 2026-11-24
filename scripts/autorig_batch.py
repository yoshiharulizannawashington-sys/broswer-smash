"""Batch auto-rigging for supplied unrigged Browser Bros bodies.

Run with Blender 4.2.23 through the project wrapper:

    bash scripts/blender.sh -b --python scripts/autorig_batch.py -- <key> [--out <dir>]

The script is deliberately per-model rather than one generic skeleton: each body is normalised
(upright, facing -Y, feet on Z=0, scaled to 1.8 m), its hips/crotch, shoulder line, limb centres and
toe direction are measured from the mesh, and the arm chain is fitted to that model's T/A pose.
Weights are gated capsules blended by inverse-cube distance, then validated:

  * every vertex has >=1 weight and sums to 1
  * every deform bone drives geometry
  * each joint head is close to the surface
  * left/right joints are symmetric within tolerance
  * a pose test moves real vertices on every limb

Output is written to artifacts/rig-batch/rigged/<key>/<key>.glb and a JSON report next to it.
"""
import bpy
import bmesh
import json
import math
import os
import sys

import numpy as np
from mathutils import Vector, Matrix, Quaternion, kdtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ROOT = os.path.join(ROOT, "artifacts", "rig-batch", "rigged")

# Facing/arm measurements derived from the supplied meshes. Fractions are of body height, in the
# normalised Blender frame (Z up, -Y forward, +X to the body's left).
MODELS = {
    "wonder_woman": {
        "file": "artifacts/asset-fetch/wonder_woman/wonder_woman.glb",
        "rotate_z": -90,            # authored facing +X; bring it to -Y
        "shoulder_z": 0.79,
        "hand": (0.42, 0.79),       # T-pose: arms horizontal
        "arm_style": "t",
        "target_height": 1.80,
    },
    "spider_man": {
        "file": "artifacts/asset-fetch/spider_man/spider_man.glb",
        "shoulder_z": 0.80,
        "hand": (0.34, 0.545),      # A-pose, hands at hip height
        "arm_style": "a",
        "target_height": 1.80,
        "hip_z": 0.47,
    },
    "light_yagami": {
        "file": "artifacts/asset-fetch/light_yagami/light_yagami.glb",
        "shoulder_z": 0.80,
        "hand": (0.42, 0.60),       # wide, slightly down
        "arm_style": "a",
        "target_height": 1.82,
    },
    "madara": {
        "file": "artifacts/asset-fetch/madara/madara.glb",
        "shoulder_z": 0.80,
        "hand": (0.36, 0.50),
        "arm_style": "a",
        "target_height": 1.82,
        "hip_z": 0.49,
    },
    "madara_alt": {
        "file": "artifacts/asset-fetch/madara_alt/madara_alt.glb",
        "shoulder_z": 0.80,
        "hand": (0.245, 0.46),
        "arm_style": "a",
        "target_height": 1.74,
        "hip_z": 0.48,
    },
    "sasuke": {
        "file": "artifacts/asset-fetch/sasuke/sasuke.glb",
        "shoulder_z": 0.80,
        "hand": (0.37, 0.46),
        "arm_style": "a",
        "target_height": 1.80,
        "hip_z": 0.49,
    },
    "thor": {
        "file": "artifacts/asset-fetch/thor/thor.glb",
        "shoulder_z": 0.80,
        "hand": (0.30, 0.50),
        "arm_style": "a",
        "target_height": 1.88,
        "hip_z": 0.48,
    },
    "aang": {
        "file": "artifacts/asset-fetch/aang/aang.glb",
        "shoulder_z": 0.72,
        "hand": (0.53, 0.71),       # T-pose, large shoulder pads
        "arm_style": "t",
        "target_height": 1.72,
        "hip_z": 0.40,
    },
    "naruto_sage": {
        "file": "artifacts/naruto-sage/naruto_sage_source.glb",
        "shoulder_z": 0.75,         # measured T-pose arm line, 1.35 m / 1.80 m
        "hand": (0.45, 0.75),       # straight T-pose, each hand 0.81 m from centre
        "arm_style": "t",
        "target_height": 1.80,
        "hip_z": 0.47,
    },
    "mario_happi": {
        "file": "artifacts/asset-fetch/269c8e889d6440c284034898440919c0/model.glb",
        "shoulder_z": 0.61,         # measured from the supplied 14.81-unit T-pose
        "hand": (0.52, 0.61),       # gloves at the shoulder line, straight out
        "arm_style": "t",
        "target_height": 1.754,     # keep the existing Mario slot height
        "hip_z": 0.44,
    },
}

BONES = [
    "Hips", "Spine", "Chest", "Neck", "Head",
    "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
    "RightShoulder", "RightArm", "RightForeArm", "RightHand",
    "LeftUpLeg", "LeftLeg", "LeftFoot",
    "RightUpLeg", "RightLeg", "RightFoot",
]


def log(payload):
    print("RESULT:" + json.dumps(payload))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf", ".vrm"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    else:
        raise RuntimeError("unsupported format: " + ext)
    bpy.context.view_layer.update()


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def flatten():
    """Detach every mesh from empty/armature parents and bake its world transform."""
    for obj in meshes():
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    for obj in list(bpy.context.scene.objects):
        if obj.type != "MESH":
            bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()
    objs = meshes()
    if not objs:
        raise RuntimeError("no meshes in source")
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def clean_meshes():
    removed = 0
    for obj in meshes():
        bm = bmesh.new()
        try:
            bm.from_mesh(obj.data)
            bad = [f for f in bm.faces if f.calc_area() < 1e-10]
            if bad:
                bmesh.ops.delete(bm, geom=bad, context="FACES")
                bm.to_mesh(obj.data)
                removed += len(bad)
        finally:
            bm.free()
    return removed


def world_points(step=1):
    pts = []
    for obj in meshes():
        m = obj.matrix_world
        n = len(obj.data.vertices)
        for i in range(0, n, step):
            p = m @ obj.data.vertices[i].co
            pts.append((p.x, p.y, p.z))
    return np.array(pts, dtype=np.float64)


def bounds():
    pts = world_points(max(1, sum(len(o.data.vertices) for o in meshes()) // 120000))
    return pts.min(axis=0), pts.max(axis=0)


def transform_meshes(matrix):
    for obj in meshes():
        obj.matrix_world = matrix @ obj.matrix_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = meshes()[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.context.view_layer.update()


def normalise(cfg):
    lo, hi = bounds()
    size = hi - lo
    # A body is taller than it is wide. If the horizontal X span is much narrower than Y, the
    # source is turned 90 degrees about the vertical axis (Wonder Woman is authored facing +X).
    if cfg.get("rotate_z") is not None:
        transform_meshes(Matrix.Rotation(math.radians(cfg["rotate_z"]), 4, "Z"))
    elif size[0] < size[1] * 0.8:
        transform_meshes(Matrix.Rotation(math.radians(-90), 4, "Z"))

    lo, hi = bounds()
    height = max(hi[2] - lo[2], 1e-6)
    target = float(cfg.get("target_height", 1.8))
    factor = target / height
    centre_x = (lo[0] + hi[0]) * 0.5
    centre_y = (lo[1] + hi[1]) * 0.5
    mat = Matrix.Translation((0, 0, 0)) @ Matrix.Scale(factor, 4)
    mat = Matrix.Translation((-centre_x * factor, -centre_y * factor, -lo[2] * factor)) @ mat
    transform_meshes(mat)
    clean_meshes()

    # Toe direction: lowest 2% of the body is the toe/sole; 4-9% is the ankle/heel band. The
    # forward direction is the side the lowest band extends to relative to the ankle band.
    pts = world_points(3)
    z = pts[:, 2]
    lo2, hi2 = z.min(), z.max()
    h = hi2 - lo2
    sole = pts[z < lo2 + 0.025 * h]
    ankle = pts[(z > lo2 + 0.045 * h) & (z < lo2 + 0.09 * h)]
    toe_y = float(np.median(sole[:, 1])) if len(sole) else 0.0
    ankle_y = float(np.median(ankle[:, 1])) if len(ankle) else 0.0
    forward = -1 if toe_y <= ankle_y else 1
    # Most supplied bodies already face -Y. If the measured sole points +Y, turn the body round so
    # the game's +Z-forward mount does not present its back.
    if forward > 0 and not cfg.get("keep_facing", False):
        transform_meshes(Matrix.Rotation(math.pi, 4, "Z"))
        forward = -1
    return {"height": h, "forward": forward, "scale": factor}


def band_points(pts, z0, z1):
    z = pts[:, 2]
    return pts[(z >= z0) & (z < z1)]


def clusters_1d(values, gap):
    if len(values) == 0:
        return []
    ordered = np.sort(values)
    out = []
    start = ordered[0]
    prev = ordered[0]
    for value in ordered[1:]:
        if value - prev > gap:
            out.append((start, prev))
            start = value
        prev = value
    out.append((start, prev))
    return out


def central_cluster(values, gap):
    if len(values) == 0:
        return None
    best = None
    for lo, hi in clusters_1d(values, gap):
        if lo <= 0 <= hi or (lo > 0 and lo < gap) or (hi < 0 and hi > -gap):
            if best is None or (hi - lo) > (best[1] - best[0]):
                best = (lo, hi)
    if best is None:
        # No cluster straddles the centre; take the one nearest it.
        best = min(clusters_1d(values, gap), key=lambda c: min(abs(c[0]), abs(c[1])))
    return best


def measure_landmarks(pts, height, cfg):
    # Leg centres are measured from the ankles, not the hip line: a long coat or skirt occupies the
    # hip band and used to put one hip 0.55 m off the other on Thor. The two ankle columns are
    # averaged and mirrored so the leg chain is symmetric even on a staggered stance.
    ankle_band = band_points(pts, 0.045 * height, 0.10 * height)
    left = ankle_band[ankle_band[:, 0] > 0]
    right = ankle_band[ankle_band[:, 0] < 0]
    ankle_abs = 0.075 * height
    if len(left) > 15 and len(right) > 15:
        ankle_abs = (abs(float(np.median(left[:, 0]))) + abs(float(np.median(right[:, 0])))) * 0.5
    ankle_abs = max(0.045 * height, min(0.16 * height, ankle_abs))
    ankle_y = float(np.median(ankle_band[:, 1])) if len(ankle_band) else 0.0
    hip_abs = max(0.05 * height, min(0.115 * height, ankle_abs * 0.84))
    hip_z = cfg.get("hip_z", 0.48) * height

    # Torso width from the central x-cluster. A wide gap separates the torso from both arms; the
    # old 2 cm threshold merged a coat and an arm into a 0.76 m "torso".
    torso_band = band_points(pts, 0.60 * height, 0.67 * height)
    torso_cluster = central_cluster(torso_band[:, 0], 0.05 * height) if len(torso_band) else None
    torso_half = (torso_cluster[1] - torso_cluster[0]) * 0.5 if torso_cluster else 0.11 * height
    if not (0.055 * height <= torso_half <= 0.19 * height):
        torso_half = 0.11 * height

    shoulder_z = cfg.get("shoulder_z", 0.80) * height
    shoulder_x = max(0.06 * height, min(0.135 * height, torso_half * 0.90))
    hand_x, hand_z = cfg.get("hand", (0.34, 0.52))
    hand_x = abs(hand_x) * height
    hand_z *= height

    # Shoulder depth from the mesh at the shoulder line.
    band = band_points(pts, shoulder_z - 0.02 * height, shoulder_z + 0.02 * height)
    shoulder_y = float(np.median(band[:, 1])) if len(band) else 0.0
    # Hand depth: use vertices near the expected hand point.
    hand_band = band_points(pts, hand_z - 0.04 * height, hand_z + 0.04 * height)
    if len(hand_band):
        near = hand_band[np.abs(np.abs(hand_band[:, 0]) - hand_x) < 0.10 * height]
        hand_y = float(np.median(near[:, 1])) if len(near) else float(np.median(hand_band[:, 1]))
    else:
        hand_y = shoulder_y

    hip_y = float(np.median(band_points(pts, hip_z - 0.03 * height, hip_z + 0.02 * height)[:, 1]))
    neck_z = min(0.90 * height, shoulder_z + 0.07 * height)
    head_base = min(0.89 * height, neck_z + 0.01 * height)

    return {
        "height": height, "hip_z": hip_z, "hip_x": (hip_abs, -hip_abs),
        "ankle_x": (ankle_abs, -ankle_abs), "ankle_y": ankle_y, "torso_half": torso_half,
        "shoulder_z": shoulder_z, "shoulder_x": shoulder_x, "shoulder_y": shoulder_y,
        "hand": (hand_x, hand_z, hand_y), "hip_y": hip_y,
        "neck_z": neck_z, "head_base": head_base,
    }


def build_armature(m, cfg):
    arm_data = bpy.data.armatures.new("ImportedRig")
    arm = bpy.data.objects.new("ImportedRig", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    activate(arm)
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm_data.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head = Vector(head)
        b.tail = Vector(tail)
        if parent:
            b.parent = eb[parent]
            b.use_connect = False
        return b

    h = m["height"]
    hip_z = m["hip_z"]
    hip_y = m["hip_y"]
    # Torso chain.
    bone("Hips", (0, hip_y, hip_z), (0, hip_y, hip_z + 0.06 * h))
    bone("Spine", (0, hip_y, hip_z + 0.06 * h), (0, 0, 0.68 * h), "Hips")
    bone("Chest", (0, 0, 0.68 * h), (0, m["shoulder_y"], m["shoulder_z"] - 0.01 * h), "Spine")
    bone("Neck", (0, m["shoulder_y"], m["shoulder_z"] - 0.01 * h),
         (0, 0, m["neck_z"]), "Chest")
    bone("Head", (0, 0, m["neck_z"]), (0, 0, 0.995 * h), "Neck")

    for side, sign, hip_x, ankle_x in (
        ("Left", 1, m["hip_x"][0], m["ankle_x"][0]),
        ("Right", -1, m["hip_x"][1], m["ankle_x"][1]),
    ):
        sx = sign * m["shoulder_x"]
        hx = sign * m["hand"][0]
        hz = m["hand"][1]
        hy = m["hand"][2]
        bone(side + "Shoulder", (0, m["shoulder_y"], m["shoulder_z"] - 0.02 * h),
             (sx, m["shoulder_y"], m["shoulder_z"]), "Chest")
        # Straight arm chain: the supplied bodies are T/A poses with straight elbows. The elbow
        # and wrist are placed along the measured shoulder-hand line so bones sit inside the limb.
        elbow = (sx + (hx - sx) * 0.47, m["shoulder_y"] + (hy - m["shoulder_y"]) * 0.47,
                 m["shoulder_z"] + (hz - m["shoulder_z"]) * 0.47)
        wrist = (sx + (hx - sx) * 0.81, m["shoulder_y"] + (hy - m["shoulder_y"]) * 0.81,
                 m["shoulder_z"] + (hz - m["shoulder_z"]) * 0.81)
        bone(side + "Arm", (sx, m["shoulder_y"], m["shoulder_z"]), elbow, side + "Shoulder")
        bone(side + "ForeArm", elbow, wrist, side + "Arm")
        bone(side + "Hand", wrist, (hx, hy, hz), side + "ForeArm")

        hip = (hip_x, hip_y, hip_z)
        ankle = (ankle_x, m["ankle_y"], 0.065 * h)
        knee = (hip_x + (ankle_x - hip_x) * 0.52, hip_y + 0.012 * h,
                hip_z + (ankle[2] - hip_z) * 0.52)
        toe = (ankle_x, ankle[1] - 0.13 * h, 0.02 * h)
        bone(side + "UpLeg", hip, knee, "Hips")
        bone(side + "Leg", knee, ankle, side + "UpLeg")
        bone(side + "Foot", ankle, toe, side + "Leg")

    bpy.ops.object.mode_set(mode="OBJECT")
    return arm


def segment_distance(points, head, tail):
    """Vectorised point-to-segment distance."""
    ab = np.array(tail) - np.array(head)
    ap = points - np.array(head)
    denom = float(ab.dot(ab))
    if denom <= 1e-12:
        return np.linalg.norm(ap, axis=1)
    t = np.clip((ap @ ab) / denom, 0.0, 1.0)
    closest = np.array(head)[None, :] + t[:, None] * ab[None, :]
    return np.linalg.norm(points - closest, axis=1)


def bone_segments(arm):
    segs = {}
    for b in arm.data.bones:
        segs[b.name] = (np.array(b.head_local), np.array(b.tail_local))
    return segs


def skin_meshes(arm, m):
    height = m["height"]
    h = height
    segs = bone_segments(arm)
    total_vertices = sum(len(o.data.vertices) for o in meshes())
    accessory_ids = {}
    mesh_boxes = {}
    for obj in meshes():
        pts = np.array([(obj.matrix_world @ v.co)[:] for v in obj.data.vertices])
        mesh_boxes[obj.name] = (pts.min(axis=0), pts.max(axis=0))
    # A prop is a mesh whose box does not overlap any other mesh: Thor's hammer, a staff, a sword
    # held clear of the body. A single-mesh body (Aang) is never a prop, and a large isolated part
    # is a limb/garment rather than a held object.
    for obj in meshes():
        if len(meshes()) < 2 or len(obj.data.vertices) > 0.25 * total_vertices:
            continue
        lo, hi = mesh_boxes[obj.name]
        isolated = True
        for other in meshes():
            if other.name == obj.name:
                continue
            olo, ohi = mesh_boxes[other.name]
            overlap = np.all((lo <= ohi + 0.01 * h) & (hi >= olo - 0.01 * h))
            if overlap:
                isolated = False
                break
        if isolated:
            accessory_ids[obj.name] = None

    for obj in meshes():
        n = len(obj.data.vertices)
        pts = np.array([(obj.matrix_world @ v.co)[:] for v in obj.data.vertices], dtype=np.float64)
        names = list(segs.keys())
        dist = np.empty((n, len(names)), dtype=np.float32)
        for j, name in enumerate(names):
            dist[:, j] = segment_distance(pts, segs[name][0], segs[name][1])
        allowed = np.ones_like(dist, dtype=bool)

        x = pts[:, 0]
        z = pts[:, 2]
        for j, name in enumerate(names):
            side = 1 if name.startswith("Left") else -1 if name.startswith("Right") else 0
            if side:
                allowed[:, j] &= (x * side) > -0.015 * h
            if name.endswith(("Shoulder", "Arm", "ForeArm", "Hand")):
                allowed[:, j] &= z > 0.42 * h
                allowed[:, j] &= ~((np.abs(x) < m["shoulder_x"] * 0.52)
                                   & (z < m["shoulder_z"] + 0.035 * h))
                # Keep the limb capsule from stealing chest/coat vertices.
                allowed[:, j] &= dist[:, j] < 0.19 * h
            if name.endswith(("UpLeg", "Leg", "Foot")):
                allowed[:, j] &= z < m["hip_z"] + 0.12 * h
                allowed[:, j] &= dist[:, j] < 0.18 * h
            if name in ("Neck", "Head"):
                allowed[:, j] &= z > 0.62 * h

        # Vertices outside every capsule still need a torso anchor.
        orphan = ~allowed.any(axis=1)
        if orphan.any():
            for j, name in enumerate(names):
                if name in ("Hips", "Spine", "Chest"):
                    allowed[orphan, j] = True

        masked = np.where(allowed, dist, np.inf)
        # Four nearest bones, inverse-cube blend. A small epsilon keeps a vertex exactly on a
        # joint from concentrating all of its weight on one bone.
        k = 4
        idx = np.argpartition(masked, k - 1, axis=1)[:, :k]
        rows = np.arange(n)[:, None]
        chosen = masked[rows, idx]
        weights = 1.0 / np.power(chosen + 0.012 * h, 3)
        # Drop inf/nan from a vertex with fewer than four allowed bones.
        weights[~np.isfinite(weights)] = 0.0
        sums = weights.sum(axis=1, keepdims=True)
        sums[sums == 0] = 1.0
        weights = weights / sums

        # Accessories follow the nearest hand as a rigid piece; distance blending would smear a
        # hammer across the shoulder and chest. If no hand is close, the nearest single bone owns it.
        if obj.name in accessory_ids:
            centre = pts.mean(axis=0)
            hand_names = [name for name in names if name.endswith("Hand")]
            hand_bone = min(hand_names, key=lambda name: np.linalg.norm(
                centre - (segs[name][0] + segs[name][1]) * 0.5))
            hand_dist = np.linalg.norm(centre - (segs[hand_bone][0] + segs[hand_bone][1]) * 0.5)
            target = hand_bone if hand_dist < 0.40 * h else names[int(np.argmin(dist.mean(axis=0)))]
            accessory_ids[obj.name] = target
            j = names.index(target)
            # The write loop addresses four columns; point all four at the target bone and keep
            # only the first weighted. The old full-matrix column index overflowed at bone 8.
            idx[:] = j
            weights[:] = 0.0
            weights[:, 0] = 1.0

        # Write the weights through the bmesh deform layer (much faster than VertexGroup.add per
        # vertex on the 500k-vertex bodies).
        obj.vertex_groups.clear()
        groups = {name: obj.vertex_groups.new(name=name) for name in names}
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        deform = bm.verts.layers.deform.verify()
        bm.verts.ensure_lookup_table()
        group_index = {name: groups[name].index for name in names}
        for vi, vert in enumerate(bm.verts):
            dv = vert[deform]
            row = weights[vi]
            for c in range(k):
                if row[c] <= 0:
                    continue
                dv[group_index[names[idx[vi, c]]]] = float(row[c])
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()

        mod = obj.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        obj.parent = arm
        obj.matrix_parent_inverse = arm.matrix_world.inverted()

    # Smooth across topology, normalise, cap influences at four and drop negligible weights.
    for obj in meshes():
        activate(obj)
        try:
            bpy.ops.object.mode_set(mode="EDIT")
            bpy.ops.mesh.select_all(action="SELECT")
            bpy.ops.object.mode_set(mode="WEIGHT_PAINT")
            bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.45, repeat=3, expand=0.0)
            bpy.ops.object.mode_set(mode="OBJECT")
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
            bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
            bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.0005, keep_single=True)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        except Exception as exc:
            print("SMOOTH_WARN:", obj.name, exc)
            try:
                bpy.ops.object.mode_set(mode="OBJECT")
            except Exception:
                pass
    # Keep props rigid after the smoothing pass.
    for obj in meshes():
        target = accessory_ids.get(obj.name)
        if not target:
            continue
        groups = {vg.name: vg for vg in obj.vertex_groups}
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        deform = bm.verts.layers.deform.verify()
        for vert in bm.verts:
            dv = vert[deform]
            dv.clear()
            dv[groups[target].index] = 1.0
        bm.to_mesh(obj.data)
        bm.free()
        obj.data.update()


def validate(arm, m, cfg, source):
    h = m["height"]
    report = {"source": source, "height": round(h, 4), "bones": len(arm.data.bones)}
    # KD tree of sampled surface points for joint placement.
    pts = world_points(4)
    kd = kdtree.KDTree(len(pts))
    for i, p in enumerate(pts):
        kd.insert(Vector(p), i)
    kd.balance()
    joints = {}
    for b in arm.data.bones:
        head = arm.matrix_world @ b.head_local
        tail = arm.matrix_world @ b.tail_local
        _co, _i, dist = kd.find(head)
        joints[b.name] = {
            "head": [round(v, 4) for v in head], "tail": [round(v, 4) for v in tail],
            "surface": round(float(dist), 4),
        }
    report["joints"] = joints

    # Symmetry and proportions.
    pairs = [("LeftArm", "RightArm"), ("LeftForeArm", "RightForeArm"), ("LeftHand", "RightHand"),
             ("LeftUpLeg", "RightUpLeg"), ("LeftLeg", "RightLeg"), ("LeftFoot", "RightFoot")]
    symmetry = {}
    for a, b in pairs:
        pa = np.array(joints[a]["head"])
        pb = np.array(joints[b]["head"])
        symmetry[a] = round(float(np.linalg.norm(pa - pb * np.array([-1, 1, 1]))), 4)
    report["symmetry"] = symmetry
    report["proportions"] = {
        "arm": round(float(np.linalg.norm(np.array(joints["LeftHand"]["head"]) - np.array(joints["LeftShoulder"]["head"]))) / h, 4),
        "leg": round(float(np.linalg.norm(np.array(joints["LeftFoot"]["head"]) - np.array(joints["LeftUpLeg"]["head"]))) / h, 4),
    }

    # Weights and coverage.
    total = 0
    unweighted = 0
    bad_sum = 0
    max_influences = 0
    coverage = {b.name: 0 for b in arm.data.bones}
    for obj in meshes():
        index_to_name = {vg.index: vg.name for vg in obj.vertex_groups}
        for v in obj.data.vertices:
            total += 1
            ws = [(index_to_name[g.group], g.weight) for g in v.groups if g.weight > 0.0005]
            if not ws:
                unweighted += 1
                continue
            s = sum(w for _n, w in ws)
            if abs(s - 1.0) > 0.02:
                bad_sum += 1
            max_influences = max(max_influences, len(ws))
            for name, _w in ws:
                coverage[name] = coverage.get(name, 0) + 1
    report["weights"] = {
        "vertices": total, "unweighted": unweighted, "badSum": bad_sum,
        "maxInfluences": max_influences,
        "coverage": coverage,
        "weightlessBones": [n for n, c in coverage.items() if c == 0],
    }

    # Pose test: rotate one bone at a time and measure skinned vertex displacement on a sample.
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    sample = []
    for obj in meshes():
        step = max(1, len(obj.data.vertices) // 3000)
        sample.append((obj, list(range(0, len(obj.data.vertices), step))))
    sampled = sum(len(indices) for _obj, indices in sample)
    deform = {}
    for bone_name, axis, angle in (
        ("LeftArm", "X", 45), ("RightArm", "X", -45), ("LeftForeArm", "X", 55),
        ("LeftUpLeg", "X", 30), ("RightUpLeg", "X", -30), ("LeftLeg", "X", -45),
        ("Spine", "Y", 20),
    ):
        pb = arm.pose.bones.get(bone_name)
        if not pb:
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = Vector((0, 0, 0))
        pb.rotation_euler[{"X": 0, "Y": 1, "Z": 2}[axis]] = math.radians(angle)
        bpy.context.view_layer.update()
        deps = bpy.context.evaluated_depsgraph_get()
        moved = 0
        maximum = 0.0
        for obj, indices in sample:
            ev = obj.evaluated_get(deps)
            mesh = ev.to_mesh()
            try:
                for i in indices:
                    rest = obj.matrix_world @ obj.data.vertices[i].co
                    co = ev.matrix_world @ mesh.vertices[i].co
                    d = (co - rest).length
                    maximum = max(maximum, d)
                    if d > 0.01:
                        moved += 1
            finally:
                ev.to_mesh_clear()
        deform[bone_name] = {"max": round(maximum, 4), "moved": moved, "samples": sampled}
        pb.rotation_euler = Vector((0, 0, 0))
        bpy.context.view_layer.update()
    report["deformation"] = deform
    return report


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if not argv:
        raise SystemExit("usage: autorig_batch.py <key> [--out dir]")
    key = argv[0]
    if key not in MODELS:
        raise SystemExit("unknown model key: " + key)
    cfg = MODELS[key]
    out_dir = os.path.join(OUT_ROOT, key)
    if "--out" in argv:
        out_dir = argv[argv.index("--out") + 1]
    os.makedirs(out_dir, exist_ok=True)
    out_glb = os.path.join(out_dir, key + ".glb")
    report_path = os.path.join(out_dir, "rig-report.json")

    reset()
    import_any(os.path.join(ROOT, cfg["file"]))
    flatten()
    norm = normalise(cfg)
    pts = world_points(2)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    m = measure_landmarks(pts, float(hi[2] - lo[2]), cfg)
    arm = build_armature(m, cfg)
    skin_meshes(arm, m)

    # Export first so validation measures the shipped bytes' bind pose rather than a modified scene.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out_glb, export_format="GLB", export_apply=False,
        export_animations=False, export_skins=True, export_yup=True,
        use_selection=False,
    )
    report = validate(arm, m, cfg, cfg["file"])
    report.update({"key": key, "normalisation": norm, "landmarks": m, "output": out_glb})
    with open(report_path, "w") as fh:
        json.dump(report, fh, indent=1)
    log({
        "ok": True, "key": key, "out": out_glb, "report": report_path,
        "height": report["height"], "bones": report["bones"],
        "weights": report["weights"], "symmetry": report["symmetry"],
        "proportions": report["proportions"], "deformation": report["deformation"],
    })


if __name__ == "__main__":
    main()
