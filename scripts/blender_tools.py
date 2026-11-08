"""Blender-side operations for the character import pipeline.

Run through scripts/blender.sh, always with a `--` separator:

    bash scripts/blender.sh -b --python scripts/blender_tools.py -- convert in.fbx out.glb
    bash scripts/blender.sh -b --python scripts/blender_tools.py -- autorig in.glb out.glb
    bash scripts/blender.sh -b --python scripts/blender_tools.py -- retarget target.glb source.glb out.glb "Idle=idle,Walk=walk"
    bash scripts/blender.sh -b --python scripts/blender_tools.py -- strip_skin in.glb out.glb
    bash scripts/blender.sh -b --python scripts/blender_tools.py -- to_fbx in.glb out.fbx
    bash scripts/blender.sh -b --python scripts/blender_tools.py -- report in.glb out.json

Every subcommand prints one JSON line prefixed with RESULT:, so the Node orchestrator never has to
parse Blender prose.
"""
import bpy
import json
import math
import os
import sys
from mathutils import Vector

# Canonical ingest targets. A thigh is LeftUpLeg (a bare LeftLeg classifies as a shin in the game's
# rig_map), and a forearm is LeftForeArm.
SIDES = {"left": "Left", "right": "Right"}


def log_result(payload):
    print("RESULT:" + json.dumps(payload))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_any(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf", ".vrm"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    elif ext == ".blend":
        bpy.ops.wm.open_mainfile(filepath=path)
    else:
        raise RuntimeError("unsupported format: " + ext)
    bpy.context.view_layer.update()


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def armatures():
    return [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]


def activate(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


# --------------------------------------------------------------------------- role classification
def role_of(name):
    raw = str(name or "").lower().replace("mixamorig:", "")
    spaced = raw.replace(".", " ").replace("_", " ").replace("-", " ").replace(":", " ")
    tokens = [t for t in spaced.split() if t]
    key = spaced.replace(" ", "")
    side = None
    if "left" in key:
        side = "Left"
    elif "right" in key:
        side = "Right"
    else:
        # Blender suffixes (.L), VRM separators (J_Bip_L_UpperArm) and sanitised tails (upperarmL).
        for token in tokens:
            if token in ("l", "left"):
                side = "Left"
                break
            if token in ("r", "right"):
                side = "Right"
                break
        if side is None and key and key[-1] in "lr" and key[-2:-1].isalpha():
            side = {"l": "Left", "r": "Right"}[key[-1]]
    if any(w in key for w in ("finger", "thumb", "index", "middle", "ring", "pinky")):
        return None
    if "neck" in key:
        return "Neck"
    if "head" in key:
        return "Head"
    if "hips" in key or "pelvis" in key:
        return "Hips"
    if "spine" in key:
        return "Spine"
    if any(w in key for w in ("chest", "torso", "abdomen", "ribcage")):
        return "Chest"
    if side is None:
        return None
    if any(w in key for w in ("hand", "wrist", "palm")):
        return side + "Hand"
    if any(w in key for w in ("forearm", "lowerarm", "elbow")):
        return side + "ForeArm"
    if any(w in key for w in ("clavicle", "shoulder")):
        return side + "Shoulder"
    if "upperarm" in key or "arm" in key:
        return side + "Arm"
    if any(w in key for w in ("upleg", "thigh", "upperleg")):
        return side + "UpLeg"
    if any(w in key for w in ("shin", "calf", "lowerleg", "knee", "leg")):
        return side + "Leg"
    if any(w in key for w in ("foot", "ankle", "toe")):
        return side + "Foot"
    return None


def role_map(names):
    """Canonical role -> source bone name, resolving duplicate spine chains by depth order."""
    found = {}
    spine_seen = 0
    for name in names:
        role = role_of(name)
        if not role:
            continue
        if role == "Spine":
            spine_seen += 1
            role = "Spine" if spine_seen == 1 else ("Chest" if "Chest" not in found else None)
            if role is None:
                continue
        if role in found:
            continue
        found[role] = name
    return found


# --------------------------------------------------------------------------- geometry helpers
def world_bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            point = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], point[i]) for i in range(3)))
            hi = Vector((max(hi[i], point[i]) for i in range(3)))
    return lo, hi


def triangle_stats(objects):
    total = 0
    degenerate = 0
    for obj in objects:
        mesh = obj.data
        mesh.calc_loop_triangles()
        for tri in mesh.loop_triangles:
            total += 1
            if tri.area < 1e-9:
                degenerate += 1
    return total, degenerate


# --------------------------------------------------------------------------- subcommands
def cmd_convert(in_path, out_path):
    reset()
    import_any(in_path)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    images = [img.name for img in bpy.data.images if img.name != "Render Result"]
    bpy.ops.export_scene.gltf(
        filepath=out_path, export_format="GLB", export_apply=False,
        export_animations=True, export_animation_mode="ACTIONS", export_yup=True,
        export_skins=True, export_morph=False,
    )
    log_result({"ok": True, "out": out_path, "meshes": len(meshes()), "armatures": len(armatures()),
                "images": images, "actions": [a.name for a in bpy.data.actions]})


def cmd_strip_skin(in_path, out_path):
    """Remove skeleton and skinning, leaving a genuine unrigged humanoid mesh."""
    reset()
    import_any(in_path)
    for arm in armatures():
        bpy.data.objects.remove(arm, do_unlink=True)
    for obj in meshes():
        for modifier in list(obj.modifiers):
            if modifier.type == "ARMATURE":
                obj.modifiers.remove(modifier)
        obj.vertex_groups.clear()
        # Detaching loses the parent's transform (the source armature carried a unit scale), so
        # keep the world matrix or the mesh collapses to millimetres.
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=False,
                              export_animations=False, export_skins=False, export_yup=True)
    log_result({"ok": True, "out": out_path, "meshes": len(meshes()), "armatures": len(armatures()),
                "vertexGroups": sum(len(o.vertex_groups) for o in meshes())})


def cmd_to_fbx(in_path, out_path):
    reset()
    import_any(in_path)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.fbx(filepath=out_path, use_selection=False, add_leaf_bones=False,
                             bake_anim=True, path_mode="COPY")
    log_result({"ok": True, "out": out_path, "bytes": os.path.getsize(out_path),
                "armatures": len(armatures()), "actions": [a.name for a in bpy.data.actions]})


AUTO_RIG = [
    # name, head fraction of height, tail fraction, side offset fraction, parent
    ("Hips", 0.53, 0.62, 0.0, None),
    ("Spine", 0.62, 0.72, 0.0, "Hips"),
    ("Chest", 0.72, 0.80, 0.0, "Spine"),
    ("Neck", 0.80, 0.86, 0.0, "Chest"),
    ("Head", 0.86, 0.99, 0.0, "Neck"),
]
LIMBS = [
    ("Shoulder", "Chest", 0.80, 0.035, 0.075),
    ("Arm", "Shoulder", 0.79, 0.075, 0.20),
    ("ForeArm", "Arm", 0.78, 0.20, 0.32),
    ("Hand", "ForeArm", 0.78, 0.32, 0.39),
    ("UpLeg", "Hips", 0.52, 0.05, 0.05),
    ("Leg", "UpLeg", 0.28, 0.05, 0.05),
    ("Foot", "Leg", 0.04, 0.05, 0.05),
]


def build_armature(height, width):
    arm_data = bpy.data.armatures.new("ImportedRig")
    arm_obj = bpy.data.objects.new("ImportedRig", arm_data)
    bpy.context.scene.collection.objects.link(arm_obj)
    activate(arm_obj)
    bpy.ops.object.mode_set(mode="EDIT")
    created = {}
    for name, head_f, tail_f, offset, parent in AUTO_RIG:
        bone = arm_data.edit_bones.new(name)
        bone.head = Vector((0, 0, head_f * height))
        bone.tail = Vector((0, 0, tail_f * height))
        if parent:
            bone.parent = created[parent]
            bone.use_connect = False
        created[name] = bone
    for name, parent, z_f, _unused, reach in LIMBS:
        for side, sign in (("Left", 1), ("Right", -1)):
            role = side + name
            # LIMBS names parents bare ("Shoulder"), but rows are created per side ("LeftShoulder").
            # Resolving without the side prefix silently dropped every arm bone onto the chest and made
            # the chain fall back to a horizontal T-pose, so resolve the side first.
            parent_bone = created.get(side + parent) or created.get(parent)
            if parent_bone is None:
                parent_bone = created["Hips"] if name in ("UpLeg", "Leg", "Foot") else created["Chest"]
            bone = arm_data.edit_bones.new(role)
            if name in ("Shoulder", "Arm", "ForeArm", "Hand"):
                # A-pose arm chain: each segment starts at its parent's tail and angles down towards
                # the hip instead of straight out along X.
                chain = ("Shoulder", "Arm", "ForeArm", "Hand")
                index = chain.index(name)
                reach_length = max(0.02, abs(reach - 0.03) * width)
                drop = math.radians((10, 55, 72, 80)[index])
                if index == 0:
                    head = Vector((sign * 0.03 * width, 0, z_f * height))
                else:
                    head = parent_bone.tail.copy()
                    head.x = abs(head.x) * sign
                bone.head = head
                bone.tail = head + Vector((sign * math.cos(drop) * reach_length, 0,
                                           -math.sin(drop) * reach_length))
            elif name in ("UpLeg", "Leg"):
                top = 0.52 if name == "UpLeg" else 0.28
                bottom = 0.28 if name == "UpLeg" else 0.04
                bone.head = Vector((sign * 0.09 * width, 0, top * height))
                bone.tail = Vector((sign * 0.09 * width, 0, bottom * height))
            else:  # Foot points forward along -Y.
                bone.head = Vector((sign * 0.09 * width, 0, 0.04 * height))
                bone.tail = Vector((sign * 0.09 * width, -0.12 * height, 0.01 * height))
            bone.parent = parent_bone
            bone.use_connect = False
            created[role] = bone
    bpy.ops.object.mode_set(mode="OBJECT")
    return arm_obj


def segment_distance(point, head, tail):
    ab = tail - head
    length_sq = ab.dot(ab)
    if length_sq <= 1e-12:
        return (point - head).length
    t = max(0.0, min(1.0, (point - head).dot(ab) / length_sq))
    return (point - (head + ab * t)).length


def skin(obj, arm_obj):
    """Distance-based weights: deterministic and independent of bpy.ops automatic-weight failure."""
    bones = []
    for bone in arm_obj.data.bones:
        head = arm_obj.matrix_world @ bone.head_local
        tail = arm_obj.matrix_world @ bone.tail_local
        bones.append((bone.name, head, tail))
    groups = {}
    for name in [b[0] for b in bones]:
        groups[name] = obj.vertex_groups.get(name) or obj.vertex_groups.new(name=name)
    covered = {name: 0 for name in groups}
    extent = max((max(head.z, tail.z) for _name, head, tail in bones), default=1.0)

    def admits(name, point):
        """Can this bone own a vertex there? A limb may only take vertices on its own side and outside
        the torso column. Without this an A-pose arm hangs beside the ribs, wins the nearest-two test
        for chest/spine vertices, and the torso ends up with no weights at all (the ingest gate saw
        exactly that: 'canonical bones still unbound: spine')."""
        side = 1 if name.startswith("Left") else -1 if name.startswith("Right") else 0
        if side and point.x * side < 0.02 * extent:
            return False
        if name.endswith(("Shoulder", "Arm", "ForeArm", "Hand")):
            return abs(point.x) > 0.09 * extent or point.z > 0.74 * extent
        if name.endswith(("UpLeg", "Leg", "Foot")):
            return point.z < 0.56 * extent
        return True

    for vertex in obj.data.vertices:
        point = obj.matrix_world @ vertex.co
        scored = [(segment_distance(point, head, tail), name) for name, head, tail in bones
                  if admits(name, point)]
        if len(scored) < 2:
            scored = [(segment_distance(point, head, tail), name) for name, head, tail in bones]
        scored.sort()
        chosen = scored[:4]
        # Soft inverse-cube blending over the nearest four admitted bones, normalised per vertex.
        # Nearest-two ownership starved the short spine bone entirely on a low-poly torso and left a
        # hard seam at the shoulder; blending gives the torso a smooth hips/spine/chest gradient while
        # the arm bones fade in only outside the torso column.
        weights = [(name, 1.0 / ((distance + 0.015) ** 3)) for distance, name in chosen]
        total = sum(weight for _name, weight in weights) or 1.0
        for name, weight in weights:
            groups[name].add([vertex.index], weight / total, "REPLACE")
            covered[name] += 1
    # Safety net: any deform bone that still owns nothing takes its nearest vertex, so a short bone
    # inside a coarse mesh cannot end up weightless and trip the ingest gate.
    for name, head, tail in bones:
        if covered.get(name, 0):
            continue
        nearest, best = None, 1e9
        for vertex in obj.data.vertices:
            distance = segment_distance(obj.matrix_world @ vertex.co, head, tail)
            if distance < best:
                nearest, best = vertex, distance
        if nearest is not None:
            groups[name].add([nearest.index], 0.2, "REPLACE")
            covered[name] = 1
    modifier = obj.modifiers.new("Armature", "ARMATURE")
    modifier.object = arm_obj
    obj.parent = arm_obj
    obj.matrix_parent_inverse = arm_obj.matrix_world.inverted()
    return covered


def cmd_autorig(in_path, out_path):
    reset()
    import_any(in_path)
    targets = meshes()
    if not targets:
        log_result({"ok": False, "error": "no mesh in source"})
        return
    if armatures():
        log_result({"ok": False, "error": "source already has a skeleton; auto-rig is for unrigged meshes"})
        return
    lo, hi = world_bounds(targets)
    height = max(hi.z - lo.z, 1e-6)
    width = max(hi.x - lo.x, 1e-6)
    if height < width * 0.6:
        log_result({"ok": False, "error": "bounds look non-humanoid (height %.2f, width %.2f)" % (height, width)})
        return
    arm_obj = build_armature(height, width)
    covered = {}
    for obj in targets:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
        covered.update(skin(obj, arm_obj))
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="SELECT")
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=False,
                              export_animations=False, export_skins=True, export_yup=True)
    total, degenerate = triangle_stats(targets)
    log_result({
        "ok": True, "out": out_path, "bones": len(arm_obj.data.bones),
        "boneNames": [b.name for b in arm_obj.data.bones],
        "height": round(height, 3), "width": round(width, 3),
        "unweightedBones": [n for n, c in covered.items() if c == 0],
        "verticesWeighted": sum(covered.values()), "triangles": total, "degenerate": degenerate,
    })


def bone_depth(bone):
    depth = 0
    while bone.parent:
        bone = bone.parent
        depth += 1
    return depth


def cmd_retarget_direct(target_path, source_path, out_path):
    """Deterministic retarget: copy each source bone's world rotation onto the target and key it.

    The constraint-plus-bake path produced clips that reported as playing while rotating almost
    nothing. Here every keyframe is a value computed in this loop, and the peak rotation per bone is
    reported so a still clip cannot pass as an animated one.
    """
    reset()
    import_any(target_path)
    tarm = armatures()
    if not tarm:
        log_result({"ok": False, "error": "target has no armature"})
        return
    target = tarm[0]
    if target.animation_data:
        target.animation_data_clear()
    import_any(source_path)
    others = [a for a in armatures() if a != target]
    if not others:
        log_result({"ok": False, "error": "source rig not found"})
        return
    source = others[0]
    sroles = role_map([b.name for b in source.data.bones])
    troles = role_map([b.name for b in target.data.bones])
    pairs = [(troles[role], sroles[role]) for role in troles if role in sroles]
    pairs.sort(key=lambda pair: bone_depth(target.pose.bones[pair[0]].bone))
    scene = bpy.context.scene
    target.animation_data_create()
    for pose_bone in target.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
    baked = {}
    for state, hints in CLIP_HINTS.items():
        action_name = find_action(hints, [a.name for a in bpy.data.actions])
        if not action_name:
            continue
        action = next(a for a in bpy.data.actions if a.name == action_name)
        source.animation_data_create()
        source.animation_data.action = action
        start, end = [int(round(v)) for v in action.frame_range]
        if end <= start:
            continue
        produced = bpy.data.actions.new(state)
        produced.use_fake_user = True
        target.animation_data.action = produced
        peaks = {}
        base = {}
        # Clip-relative transfer. Copying the donor's absolute pose assumes the donor's bind pose and
        # ours describe the same stance; when they do not (a T-pose bind with A-pose clips, or the
        # reverse) every limb inherits a ~90-100 degree constant offset and the body ends up tucked
        # into the air with the feet off the floor. Measure each bone's delta at the clip's first
        # frame and bake only the motion *away* from that frame, so frame 0 agrees with the prepared
        # rest pose exactly and the clip still animates.
        scene.frame_set(start)
        delta0 = {}
        for target_name, source_name in pairs:
            source_pose = source.pose.bones[source_name]
            delta0[target_name] = (source_pose.matrix.to_quaternion()
                                   @ source_pose.bone.matrix_local.to_quaternion().inverted())
        for frame in range(start, end + 1):
            scene.frame_set(frame)
            for target_name, source_name in pairs:
                source_pose = source.pose.bones[source_name]
                target_pose = target.pose.bones[target_name]
                absolute = (source_pose.matrix.to_quaternion()
                            @ source_pose.bone.matrix_local.to_quaternion().inverted())
                delta = absolute @ delta0[target_name].inverted()
                matrix = (delta @ target_pose.bone.matrix_local.to_quaternion()).to_matrix().to_4x4()
                matrix.translation = target_pose.matrix.translation
                target_pose.matrix = matrix
                bpy.context.view_layer.update()
                target_pose.keyframe_insert("rotation_quaternion", frame=frame)
                if frame == start:
                    base[target_name] = target_pose.rotation_quaternion.copy()
                current = target_pose.rotation_quaternion
                degrees = math.degrees(base[target_name].rotation_difference(current).angle)
                peaks[target_name] = max(peaks.get(target_name, 0.0), degrees)
        baked[state] = {
            "frames": [start, end],
            "bonesMoved": sum(1 for value in peaks.values() if value > 1),
            "maxDegrees": round(max(peaks.values()) if peaks else 0, 1)
        }
        target.animation_data.action = None
    for action in bpy.data.actions:
        if action.name in baked:
            track = target.animation_data.nla_tracks.new()
            track.name = action.name
            track.strips.new(action.name, int(action.frame_range[0]), action)
            track.mute = False
    # The glTF exporter writes the armature's CURRENT pose as the node transforms, so baking leaves
    # the file resting on the last frame of the last clip (arms out). Clear the pose and unlink the
    # action first: the rig's authored A-pose then becomes the exported rest pose, and the clips stay
    # as NLA tracks on top of it.
    target.animation_data.action = None
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    # Export ONLY the target rig and the meshes bound to it. The donor rig is a rotation source, but
    # select_all() was shipping it too: the file carried two skeletons (72 bones instead of ~21) and a
    # runtime that picks the first armature renders the donor's T-pose while the baked clips drive the
    # other rig, which is exactly the permanent-arms-out look this was meant to fix.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    for child in target.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = target
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_yup=True, use_selection=True)
    log_result({"ok": True, "out": out_path, "pairs": len(pairs), "baked": baked})


def cmd_motion(in_path):
    """Measure how far each clip actually rotates the bones. A clip that reports as playing but
    rotates nothing is exactly the failure this catches."""
    reset()
    import_any(in_path)
    arms = armatures()
    if not arms:
        log_result({"ok": False, "error": "no armature"})
        return
    arm = arms[0]
    arm.animation_data_create()
    scene = bpy.context.scene
    report = {}
    for action in list(bpy.data.actions):
        arm.animation_data.action = action
        start, end = [int(round(v)) for v in action.frame_range]
        if end <= start:
            continue
        first, peak = {}, {}
        stride = max(1, (end - start) // 12)
        for frame in range(start, end + 1, stride):
            scene.frame_set(frame)
            for bone in arm.pose.bones:
                quat = bone.matrix.to_quaternion()
                if bone.name not in first:
                    first[bone.name] = quat
                    peak[bone.name] = 0.0
                peak[bone.name] = max(peak[bone.name], math.degrees(first[bone.name].rotation_difference(quat).angle))
        moved = {name: round(value, 1) for name, value in peak.items() if value > 1}
        report[action.name] = {"bonesMoved": len(moved), "maxDegrees": max(moved.values()) if moved else 0,
                               "samples": {k: moved[k] for k in list(moved)[:5]}}
    log_result({"ok": True, "actions": report})


CLIP_HINTS = {
    "Idle": ["idle"],
    "Walk": ["walk"],
    "Run": ["sprint", "run"],
    "Jump": ["jump_start", "jump"],
    "Punch": ["punch_jab", "punch", "attack"],
    "Kick": ["kick", "punch_cross"],
    "Kamehameha": ["spell", "cast", "shoot"],
}


def find_action(name_hints, available):
    for hint in name_hints:
        for action in available:
            if hint in action.lower():
                return action
    return None


def cmd_retarget(target_path, source_path, out_path, spec):
    """Bake world-space rotations from source bones onto the target rig, one action per state."""
    reset()
    import_any(target_path)
    target_arms = armatures()
    if not target_arms:
        log_result({"ok": False, "error": "target has no armature"})
        return
    target = target_arms[0]
    # Keep the target rig in a known state so constraints only ever see its rest pose.
    target.animation_data_clear()
    import_any(source_path)
    source = [a for a in armatures() if a != target]
    if not source:
        log_result({"ok": False, "error": "source rig not found"})
        return
    source = source[0]
    source_bones = role_map([b.name for b in source.data.bones])
    target_bones = role_map([b.name for b in target.data.bones])
    pairs = [(target_role, target_bones[target_role], source_bones[target_role])
             for target_role in target_bones if target_role in source_bones]
    bpy.context.view_layer.update()

    # Copy Rotation in world space is orientation-agnostic (bone lengths are left alone).
    for role, target_name, source_name in pairs:
        pose_bone = target.pose.bones[target_name]
        constraint = pose_bone.constraints.new("COPY_ROTATION")
        constraint.target = source
        constraint.subtarget = source_name
        constraint.target_space = "WORLD"
        constraint.owner_space = "WORLD"
        constraint.name = "ImportRetarget"

    scene = bpy.context.scene
    baked = {}
    source_actions = [a.name for a in bpy.data.actions]
    activate(target)
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    for state, hints in CLIP_HINTS.items():
        action_name = find_action(hints, source_actions)
        if not action_name:
            continue
        action = bpy.data.actions[action_name]
        source.animation_data_create()
        source.animation_data.action = action
        start, end = [int(round(v)) for v in action.frame_range]
        if end <= start:
            continue
        scene.frame_start, scene.frame_end = start, end
        target.animation_data_create()
        target.animation_data.action = None
        try:
            bpy.ops.nla.bake(frame_start=start, frame_end=end, only_selected=True, visual_keying=True,
                             clear_constraints=False, use_current_action=True, bake_types={"POSE"})
        except RuntimeError as error:
            baked[state] = {"error": str(error)[:160]}
            continue
        produced = target.animation_data.action
        produced.name = state
        produced.use_fake_user = True
        baked[state] = {"clips": [produced.name], "frames": [start, end],
                        "bonesKeyed": len([g for g in produced.groups])}
        target.animation_data.action = None
    bpy.ops.object.mode_set(mode="OBJECT")

    # Constraints have done their job; leaving them on the rig would double-transform it in Blender.
    for role, target_name, _source_name in pairs:
        for constraint in list(target.pose.bones[target_name].constraints):
            if constraint.name == "ImportRetarget":
                target.pose.bones[target_name].constraints.remove(constraint)

    # Export every baked action: NLA tracks are what the glTF exporter turns into clips.
    for action in bpy.data.actions:
        if action.name not in baked:
            continue
        track = target.animation_data.nla_tracks.new()
        track.name = action.name
        strip = track.strips.new(action.name, int(action.frame_range[0]), action)
        # Unmuted: the glTF exporter skips muted NLA tracks, which silently exports clips with no
        # motion at all — a body that loads but never deforms.
        track.mute = False
        strip.name = action.name
    target.animation_data.action = None
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.pose.transforms_clear()
    bpy.ops.object.mode_set(mode="OBJECT")
    # Export ONLY the target rig and the meshes bound to it. The donor rig is a rotation source, but
    # select_all() was shipping it too: the file carried two skeletons (72 bones instead of ~21) and a
    # runtime that picks the first armature renders the donor's T-pose while the baked clips drive the
    # other rig, which is exactly the permanent-arms-out look this was meant to fix.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    for child in target.children_recursive:
        child.select_set(True)
    bpy.context.view_layer.objects.active = target
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=False,
                              export_animations=True, export_animation_mode="NLA_TRACKS",
                              export_yup=True, use_selection=True)
    log_result({"ok": True, "out": out_path, "pairs": len(pairs), "baked": baked,
                "unpairedTargetBones": [r for r in target_bones if r not in source_bones]})


def cmd_report(in_path, out_path=None):
    reset()
    import_any(in_path)
    target_meshes = meshes()
    total, degenerate = triangle_stats(target_meshes)
    lo, hi = world_bounds(target_meshes) if target_meshes else (Vector(), Vector())
    payload = {
        "ok": True,
        "meshes": len(target_meshes),
        "materials": sorted({m.name for o in target_meshes for m in o.data.materials if m}),
        "images": [img.name for img in bpy.data.images if img.name != "Render Result"],
        "armatures": len(armatures()),
        "bones": [b.name for a in armatures() for b in a.data.bones],
        "actions": [a.name for a in bpy.data.actions],
        "triangles": total,
        "degenerate": degenerate,
        "height": round(hi.z - lo.z, 3),
        "width": round(hi.x - lo.x, 3),
        "depth": round(hi.y - lo.y, 3),
        "roles": role_map([b.name for a in armatures() for b in a.data.bones]),
    }
    if out_path:
        with open(out_path, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=1)
    log_result(payload)


def main():
    argv = sys.argv
    argv = argv[argv.index("--") + 1:] if "--" in argv else []
    if not argv:
        log_result({"ok": False, "error": "no subcommand"})
        return
    command, rest = argv[0], argv[1:]
    try:
        if command == "convert":
            cmd_convert(rest[0], rest[1])
        elif command == "strip_skin":
            cmd_strip_skin(rest[0], rest[1])
        elif command == "to_fbx":
            cmd_to_fbx(rest[0], rest[1])
        elif command == "autorig":
            cmd_autorig(rest[0], rest[1])
        elif command == "retarget":
            cmd_retarget(rest[0], rest[1], rest[2], rest[3] if len(rest) > 3 else "")
        elif command == "report":
            cmd_report(rest[0], rest[1] if len(rest) > 1 else None)
        elif command == "motion":
            cmd_motion(rest[0])
        elif command == "retarget2":
            cmd_retarget_direct(rest[0], rest[1], rest[2])
        else:
            log_result({"ok": False, "error": "unknown subcommand " + command})
    except Exception as error:  # noqa: BLE001 - reported to Node instead of dying silently
        log_result({"ok": False, "error": type(error).__name__ + ": " + str(error)[:300]})


main()
