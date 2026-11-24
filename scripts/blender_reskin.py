"""Graft a donor character mesh onto an existing roster rig.

The roster fighters are single-file GLBs whose 19-bone rig already carries the gameplay clips the game
plays. Swapping appearance therefore needs no retargeting: keep the armature and every action, skin the
new body to that same armature, and the existing animation system keeps working.

Weights are transferred by *surface projection*: each donor vertex is projected onto the closest point
of the already-correctly-skinned roster body, and the weights of that surface point are interpolated
from the polygon it lands on. A naive nearest-bone distance solver tears the mesh at joints and binds
whole parts to the wrong bone, which is exactly what the first attempt did. Each body part is also
restricted to its own anatomical bone chain, so a shoulder vertex can never be driven by a leg bone.

Usage:
  blender -b --python scripts/blender_reskin.py -- <base.glb> <donor.glb> <out.glb>
"""

import json
import os
import re
import sys

import bpy
from mathutils import Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
BASE, DONOR, OUT = argv[0], argv[1], argv[2]

# Anatomical chains: a donor part may only be influenced by the bones that actually drive it.
REGION_BONES = (
    # Chest is deliberately absent: a shoulder vertex bound to the torso while its neighbour is bound
    # to the upper arm tears open the moment the arm swings, which is exactly the 40x edge stretch
    # this pipeline produced. The clavicle carries that transition instead.
    (r"armleft|arm_left|leftarm", ["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"]),
    (r"armright|arm_right|rightarm", ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]),
    (r"legleft|leg_left|leftleg", ["LeftUpLeg", "LeftLeg", "LeftFoot", "Hips"]),
    (r"legright|leg_right|rightleg", ["RightUpLeg", "RightLeg", "RightFoot", "Hips"]),
    (r"head|helmet", ["Head", "Neck"]),
    (r"cape|cloak", ["Spine", "Chest", "Hips"]),
    # No leg bones here: the legs are separate meshes, and letting the torso reach for them split the
    # crotch inseam between LeftUpLeg and RightUpLeg, which tore that edge 28-67x whenever a clip moved
    # the legs. The torso hangs from the hips and spine instead.
    (r"body|torso", ["Hips", "Spine", "Chest", "Neck", "LeftShoulder", "RightShoulder"]),
)
PROP_PATTERN = re.compile(
    r"sword|shield|axe|spear|bow|quiver|arrow|dagger|crossbow|staff|wand|spellbook|mug|smokebomb|icosphere",
    re.IGNORECASE,
)


def emit(payload):
    print("RESULT:" + json.dumps(payload))


def skinned_to(mesh_obj, armature):
    return any(mod.type == "ARMATURE" and mod.object == armature for mod in mesh_obj.modifiers)


def world_bounds(objects):
    xs, ys, zs = [], [], []
    for obj in objects:
        matrix = obj.matrix_world
        for vertex in obj.data.vertices:
            co = matrix @ vertex.co
            xs.append(co.x)
            ys.append(co.y)
            zs.append(co.z)
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def bone_points(rig, bone):
    b = rig.data.bones.get(bone)
    if not b:
        return None
    return rig.matrix_world @ b.head_local, rig.matrix_world @ b.tail_local


def chain_weights(point, chain, rig):
    """Blend the two nearest bones of an anatomical chain, so elbows and knees stay smooth.

    Used for limbs: the donor's rest pose (arms out) rarely matches the roster body's (arms down), so a
    surface projection sends arm vertices onto the chest. A vertex bound to its own chain cannot be
    stolen by a neighbouring part, and blending the two nearest bones gives a continuous joint instead
    of a rigid crease.
    """
    distances = []
    for bone in chain:
        ends = bone_points(rig, bone)
        if not ends:
            continue
        head, tail = ends
        axis = tail - head
        if axis.length_squared < 1e-9:
            distances.append(((point - head).length, bone))
            continue
        t = max(0.0, min(1.0, (point - head).dot(axis) / axis.length_squared))
        distances.append(((point - (head + axis * t)).length, bone))
    if not distances:
        return {}
    if not distances:
        return {}
    # Arc-length binding. Each vertex is projected onto the chain's polyline and placed by its position
    # ALONG that polyline, then weighted to the bone whose interval contains it, fading into the
    # neighbouring bone across a window at each joint. Picking bones by nearest distance is not
    # monotonic when the donor's limbs are proportioned differently from the rig's: neighbouring
    # vertices flip between clavicle and forearm across one 2.7 cm edge and the arm tears open.
    points = []
    for bone in chain:
        ends = bone_points(rig, bone)
        if not ends:
            continue
        head, tail = ends
        if not points or (points[-1] - head).length > 1e-4:
            points.append(head)
        points.append(tail)
    if len(points) < 2:
        return {chain[0]: 1.0}
    cumulative = [0.0]
    for index in range(1, len(points)):
        cumulative.append(cumulative[-1] + (points[index] - points[index - 1]).length)
    best_distance = None
    best_arc = 0.0
    for index in range(len(points) - 1):
        a, b = points[index], points[index + 1]
        axis = b - a
        length_sq = axis.length_squared
        t = 0.0 if length_sq < 1e-9 else max(0.0, min(1.0, (point - a).dot(axis) / length_sq))
        distance = (point - (a + axis * t)).length
        if best_distance is None or distance < best_distance:
            best_distance = distance
            best_arc = cumulative[index] + t * (cumulative[index + 1] - cumulative[index])
    segments = len(points) - 1
    bones = chain[:segments] if len(chain) > segments else chain
    if not bones:
        return {}
    segment = len(bones) - 1
    for index in range(len(bones)):
        if best_arc <= cumulative[index + 1] or index == len(bones) - 1:
            segment = index
            break
    span = cumulative[segment + 1] - cumulative[segment]
    fraction = 0.0 if span < 1e-9 else (best_arc - cumulative[segment]) / span
    window = 0.35
    weights = {bones[segment]: 1.0}
    if fraction < window and segment > 0:
        blend = (window - fraction) / (2 * window)
        weights[bones[segment]] = 1.0 - blend
        weights[bones[segment - 1]] = blend
    elif fraction > 1 - window and segment + 1 < len(bones):
        blend = (fraction - (1 - window)) / (2 * window)
        weights[bones[segment]] = 1.0 - blend
        weights[bones[segment + 1]] = blend
    total = sum(weights.values()) or 1.0
    return {name: weight / total for name, weight in weights.items()}


def allowed_bones_for(name, bone_names):
    for pattern, chain in REGION_BONES:
        if re.search(pattern, name, re.IGNORECASE):
            return [bone for bone in chain if bone in bone_names]
    return list(bone_names)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=BASE)
    rigs = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not rigs:
        emit({"ok": False, "error": "base has no armature"})
        return
    rig = rigs[0]
    base_meshes = [o for o in bpy.data.objects if o.type == "MESH" and skinned_to(o, rig)]
    if not base_meshes:
        emit({"ok": False, "error": "base has no skinned mesh"})
        return
    for obj in [o for o in bpy.data.objects if o.type == "MESH" and o not in base_meshes]:
        bpy.data.objects.remove(obj, do_unlink=True)
    bone_names = [b.name for b in rig.data.bones]
    base_names = {o.name for o in bpy.data.objects}

    bpy.ops.import_scene.gltf(filepath=DONOR)
    donor_objects = [o for o in bpy.data.objects if o.name not in base_names]
    donor_rigs = [o for o in donor_objects if o.type == "ARMATURE"]
    donor_rig = donor_rigs[0] if donor_rigs else None
    donor_meshes = [o for o in donor_objects if o.type == "MESH" and not PROP_PATTERN.search(o.name)]
    dropped = [o.name for o in donor_objects if o.type == "MESH" and o not in donor_meshes]
    if not donor_meshes:
        emit({"ok": False, "error": "donor has no usable mesh"})
        return

    (bx0, bx1), (by0, by1), (bz0, bz1) = world_bounds(base_meshes)
    (dx0, dx1), (dy0, dy1), (dz0, dz1) = world_bounds(donor_meshes)
    base_height = bz1 - bz0
    donor_height = dz1 - dz0
    scale = base_height / donor_height if donor_height > 1e-6 else 1.0
    offset_x = (bx0 + bx1) / 2 - ((dx0 + dx1) / 2) * scale
    offset_y = (by0 + by1) / 2 - ((dy0 + dy1) / 2) * scale
    offset_z = bz0 - dz0 * scale

    bpy.ops.object.select_all(action="DESELECT")
    for mesh_obj in base_meshes:
        mesh_obj.select_set(True)
    bpy.context.view_layer.objects.active = base_meshes[0]
    bpy.ops.object.join()
    source = bpy.context.view_layer.objects.active
    source.name = "reskin_weight_source"

    source_matrix = source.matrix_world.copy()
    source_mesh = source.data
    group_names = {g.index: g.name for g in source.vertex_groups}
    source_weights = []
    for vertex in source_mesh.vertices:
        entry = {}
        for group in vertex.groups:
            name = group_names.get(group.group)
            if name and group.weight > 1e-4:
                entry[name] = group.weight
        source_weights.append(entry)
    world_vertices = [source_matrix @ v.co for v in source_mesh.vertices]
    polygons = [tuple(p.vertices) for p in source_mesh.polygons]
    bvh = BVHTree.FromPolygons(world_vertices, polygons, all_triangles=False)

    transferred = []
    for donor_obj in donor_meshes:
        allowed = allowed_bones_for(donor_obj.name, bone_names)
        bpy.ops.object.select_all(action="DESELECT")
        donor_obj.select_set(True)
        bpy.context.view_layer.objects.active = donor_obj
        donor_obj.scale = (scale, scale, scale)
        donor_obj.location = (offset_x, offset_y, offset_z)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

        # Bind the mesh in the armature's own space. Left in world space, the mesh is converted once by
        # its own matrix and again by the armature's glTF Y-up rotation, which stretches every edge at
        # the joints instead of following the skeleton.
        to_rig_space = rig.matrix_world.inverted() @ donor_obj.matrix_world
        donor_obj.data.transform(to_rig_space)
        donor_obj.matrix_world = rig.matrix_world.copy()
        donor_obj.parent = rig
        donor_obj.matrix_parent_inverse = Matrix.Identity(4)

        matrix = donor_obj.matrix_world
        buckets = {bone: [] for bone in bone_names}
        unbound = 0
        limb = bool(re.search(r"arm|leg", donor_obj.name, re.IGNORECASE))
        for vertex in donor_obj.data.vertices:
            point = matrix @ vertex.co
            hit = None if limb else bvh.find_nearest(point)
            weights = {}
            if hit and hit[0] is not None and hit[2] is not None:
                poly = polygons[hit[2]]
                distances = [(world_vertices[index] - point).length for index in poly]
                floor = max(min(distances), 1e-4)
                for index, distance in zip(poly, distances):
                    share = 1.0 / max(distance, floor) ** 2
                    for bone, weight in source_weights[index].items():
                        if bone in allowed:
                            weights[bone] = weights.get(bone, 0.0) + weight * share
            if limb and not weights:
                weights = chain_weights(point, allowed, rig)
            if not weights:
                # Nothing on the projected patch was allowed for this part: fall back to the nearest
                # allowed bone segment so no vertex is ever left unweighted.
                unbound += 1
                best = None
                for bone in allowed:
                    b = rig.data.bones.get(bone)
                    if not b:
                        continue
                    head = rig.matrix_world @ b.head_local
                    tail = rig.matrix_world @ b.tail_local
                    axis = tail - head
                    t = 0.0 if axis.length_squared < 1e-9 else max(0.0, min(1.0, (point - head).dot(axis) / axis.length_squared))
                    distance = (point - (head + axis * t)).length
                    if best is None or distance < best[0]:
                        best = (distance, bone)
                if best:
                    weights = {best[1]: 1.0}
            ordered = sorted(weights.items(), key=lambda item: item[1], reverse=True)[:4]
            total = sum(weight for _, weight in ordered) or 1.0
            for bone, weight in ordered:
                buckets[bone].append((vertex.index, weight / total))

        for bone, entries in buckets.items():
            if not entries:
                continue
            group = donor_obj.vertex_groups.get(bone) or donor_obj.vertex_groups.new(name=bone)
            for index, share in entries:
                group.add([index], share, "REPLACE")
        # Localised smoothing only after the assignments are anatomically correct: it removes the
        # remaining stair-steps at the joints without moving any vertex onto an unrelated bone.
        bpy.context.view_layer.objects.active = donor_obj
        try:
            bpy.ops.object.vertex_group_smooth(group_select_mode="ALL", factor=0.5, repeat=3, expand=0.0)
            bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
        except RuntimeError:
            pass
        transferred.append({
            "mesh": donor_obj.name,
            "bones": len([b for b in buckets if buckets[b]]),
            "fallback": unbound,
        })

        modifier = donor_obj.modifiers.new(name="Armature", type="ARMATURE")
        modifier.object = rig

    bpy.data.objects.remove(source, do_unlink=True)
    for donor_obj in donor_objects:
        if donor_obj.type == "ARMATURE":
            bpy.data.objects.remove(donor_obj, do_unlink=True)
    keep = {entry["mesh"] for entry in transferred}
    stray = []
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        if obj.name in keep:
            continue
        stray.append(obj.name)
        bpy.data.objects.remove(obj, do_unlink=True)

    os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_yup=True,
    )

    emit({
        "ok": True,
        "out": OUT,
        "scale": round(scale, 4),
        "bones": len(bone_names),
        "transferred": transferred,
        "droppedProps": dropped,
        "strayRemoved": stray,
        "baseHeight": round(base_height, 4),
        "donorHeight": round(donor_height, 4),
    })


main()
