#!/usr/bin/env python3
"""Blender-side inspection for downloaded character candidates.

Usage:
  bash scripts/blender.sh -b --python scripts/candidate_inspection.py -- \
    <model.glb|gltf|fbx> <evidence-dir> [--samples 8] [--no-render]

The Node orchestrator supplies the downloaded file and reads the single RESULT: JSON line.
This script never imports into the game and never writes under public/.
"""

import bpy
import bmesh
import json
import math
import os
import re
import struct
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("RESULT:" + json.dumps({"ok": False, "error": "usage: <model> <evidence-dir>"}))
    raise SystemExit(0)

SOURCE, OUT_DIR = argv[0], argv[1]
SAMPLES = 8
NO_RENDER = False
for i, arg in enumerate(argv[2:], 2):
    if arg == "--samples" and i + 1 < len(argv):
        SAMPLES = max(1, int(argv[i + 1]))
    elif arg == "--no-render":
        NO_RENDER = True

os.makedirs(OUT_DIR, exist_ok=True)


def emit(payload):
    print("RESULT:" + json.dumps(payload, default=str))


def rounded(value, digits=4):
    return round(float(value), digits)


def read_import(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in (".glb", ".gltf", ".vrm"):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    elif ext == ".obj":
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise RuntimeError("unsupported model format: " + ext)
    bpy.context.view_layer.update()


def world_bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        matrix = obj.matrix_world
        for corner in obj.bound_box:
            point = matrix @ Vector(corner)
            for axis in range(3):
                lo[axis] = min(lo[axis], point[axis])
                hi[axis] = max(hi[axis], point[axis])
    if lo.x > hi.x:
        return Vector((0, 0, 0)), Vector((0, 0, 0))
    return lo, hi


def object_world_bounds(obj):
    matrix = obj.matrix_world
    points = [matrix @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points))),
        Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points))),
    )


def mesh_facing_direction(meshes, body_lo, body_hi):
    """Facing direction measured from geometry instead of bone axes.

    Bone heuristics only work when the skeleton shares the mesh's frame, which is exactly what a
    badly converted export breaks. The eyes are separate geometry on every humanoid that has them
    and they sit in front of the skull, so the offset from the head mass to the eye mesh points out
    through the face. This reads the picture's own frame, so it cannot be rotated by a rig.
    """
    height = body_hi.z - body_lo.z
    if height <= 0.01 or len(meshes) < 2:
        return None
    band = body_hi.z - height * 0.18
    head_parts = []
    for obj in meshes:
        lo, hi = object_world_bounds(obj)
        centre = (lo + hi) * 0.5
        if centre.z >= band:
            head_parts.append((obj, hi - lo, centre))
    if len(head_parts) < 2:
        return None
    reference = max(head_parts, key=lambda row: row[1].length)
    ref_volume = max(1e-9, reference[1].x * reference[1].y * reference[1].z)
    small = [
        row for row in head_parts
        if row is not reference and (row[1].x * row[1].y * row[1].z) < ref_volume * 0.05
    ]
    if not small:
        return None
    centre = Vector((0, 0, 0))
    for row in small:
        centre += row[2]
    centre /= len(small)
    flat = centre - reference[2]
    flat.z = 0.0
    if flat.length < max(0.005, height * 0.01):
        return None
    return flat.normalized()


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
        for token in tokens:
            if token in ("l", "left"):
                side = "Left"
                break
            if token in ("r", "right"):
                side = "Right"
                break
        if side is None and key and key[-1] in "lr" and key[-2:-1].isalpha():
            side = {"l": "Left", "r": "Right"}[key[-1]]
    if any(word in key for word in ("finger", "thumb", "index", "middle", "ring", "pinky")):
        return None
    if "neck" in key:
        return "Neck"
    if "head" in key:
        return "Head"
    if "hips" in key or "pelvis" in key:
        return "Hips"
    if "spine" in key:
        return "Spine"
    if any(word in key for word in ("chest", "torso", "abdomen", "ribcage")):
        return "Chest"
    if side is None:
        return None
    if any(word in key for word in ("hand", "wrist", "palm")):
        return side + "Hand"
    if any(word in key for word in ("forearm", "lowerarm", "elbow")):
        return side + "ForeArm"
    if any(word in key for word in ("clavicle", "shoulder")):
        return side + "Shoulder"
    if "upperarm" in key or "arm" in key:
        return side + "Arm"
    if any(word in key for word in ("upleg", "thigh", "upperleg")):
        return side + "UpLeg"
    if any(word in key for word in ("shin", "calf", "lowerleg", "knee", "leg")):
        return side + "Leg"
    if any(word in key for word in ("foot", "ankle", "toe")):
        return side + "Foot"
    return None


def canonical_roles(bone_names):
    roles = {}
    spine_seen = 0
    for name in bone_names:
        role = role_of(name)
        if not role:
            continue
        if role == "Spine":
            spine_seen += 1
            role = "Spine" if spine_seen == 1 else ("Chest" if "Chest" not in roles else None)
            if role is None:
                continue
        if role not in roles:
            roles[role] = name
    return roles


def uv_stats(obj, triangles):
    mesh = obj.data
    uv = mesh.uv_layers.active
    if not uv or not triangles:
        return {"layers": len(mesh.uv_layers), "coverage": 0.0, "zeroArea": 0, "outOfRange": 0}
    min_u = min_v = 1e9
    max_u = max_v = -1e9
    area = 0.0
    zero = 0
    out = 0
    data = uv.data
    for tri in triangles:
        points = []
        for loop_index in tri.loops:
            u, v = data[loop_index].uv
            points.append((u, v))
            min_u, max_u = min(min_u, u), max(max_u, u)
            min_v, max_v = min(min_v, v), max(max_v, v)
            if u < 0 or u > 1 or v < 0 or v > 1:
                out += 1
        if len(points) == 3:
            (u0, v0), (u1, v1), (u2, v2) = points
            tri_area = abs((u1 - u0) * (v2 - v0) - (u2 - u0) * (v1 - v0)) * 0.5
            area += tri_area
            if tri_area < 1e-10:
                zero += 1
    box_area = max(0.0, max_u - min_u) * max(0.0, max_v - min_v)
    coverage = area / box_area if box_area > 1e-12 else 0.0
    return {
        "layers": len(mesh.uv_layers),
        "coverage": rounded(min(1.0, max(0.0, coverage))),
        "zeroAreaTriangles": zero,
        "outOfRangeLoopUVs": out,
    }


def image_record(img):
    try:
        width, height = [int(v) for v in img.size]
    except Exception:
        width = height = 0
    return {
        "name": img.name,
        "width": width,
        "height": height,
        "format": img.file_format or "",
        "source": img.source,
        "packed": bool(img.packed_file),
        "filepath": bpy.path.abspath(img.filepath) if img.filepath else "",
        "colorspace": img.colorspace_settings.name if img.colorspace_settings else "",
    }


def find_image(socket, seen):
    if socket is None:
        return None
    for link in socket.links:
        node = link.from_node
        if node in seen:
            continue
        seen.add(node)
        if node.type == "TEX_IMAGE" and node.image:
            return node.image
        for input_socket in node.inputs:
            found = find_image(input_socket, seen)
            if found:
                return found
    return None


def material_info(material):
    info = {
        "name": material.name,
        "useNodes": bool(material.use_nodes),
        "principled": False,
        "baseColor": None,
        "normal": None,
        "roughness": None,
        "metallic": None,
        "emission": None,
        "alpha": None,
        "imageTextureNodes": 0,
    }
    if not material.use_nodes or not material.node_tree:
        return info
    nodes = material.node_tree.nodes
    info["imageTextureNodes"] = sum(1 for node in nodes if node.type == "TEX_IMAGE" and node.image)
    principled = next((node for node in nodes if node.type == "BSDF_PRINCIPLED"), None)
    if not principled:
        return info
    info["principled"] = True
    for key, socket_name in (
        ("baseColor", "Base Color"),
        ("normal", "Normal"),
        ("roughness", "Roughness"),
        ("metallic", "Metallic"),
        ("emission", "Emission Color"),
        ("alpha", "Alpha"),
    ):
        socket = principled.inputs.get(socket_name)
        image = find_image(socket, set()) if socket else None
        info[key] = image.name if image else None
    return info


def body_part_weights(mesh_objects, bone_roles):
    counts = {}
    weighted = 0
    unweighted = 0
    for obj in mesh_objects:
        groups = {group.index: role_of(group.name) for group in obj.vertex_groups}
        for vertex in obj.data.vertices:
            best = None
            best_weight = 0.0
            for membership in vertex.groups:
                if membership.weight > best_weight:
                    best_weight = membership.weight
                    best = groups.get(membership.group)
            if best_weight > 0.0001:
                weighted += 1
                if best:
                    counts[best] = counts.get(best, 0) + 1
            else:
                unweighted += 1
    for role in bone_roles:
        counts.setdefault(role, 0)
    return counts, weighted, unweighted


def action_name_score(name):
    lower = name.lower()
    patterns = {
        "idle": r"idle",
        "walk": r"walk",
        "run": r"run|sprint|jog",
        "jump": r"jump|fall|air",
        "attack": r"attack|punch|kick|slash|strike|shoot|spell|combo",
        "hit": r"hit|damage|react|hurt",
        "block": r"block|guard|shield",
        "victory": r"victory|win",
        "defeat": r"defeat|ko|death|lose",
        "weapon": r"weapon|sword|gun|rifle|staff",
    }
    return [state for state, pattern in patterns.items() if re.search(pattern, lower)]


def is_helper_bone(name):
    """End/leaf and control bones are not part of the deform skeleton.

    Rigify and FBX exports add a tail bone per chain (`DEF-Foot_end_058`). They exist only to give
    the last real bone a length, sit wherever the exporter left them, and are not driven by the
    skin. Letting them into the rig bounds turned a correctly placed 73-bone skeleton into a
    2.47 m wide, 1.66 m deep scatter, and letting them into the facing logic made the camera look
    from a side that has no geometry.
    """
    key = str(name or "").lower()
    return bool(re.search(r"(^|[^a-z])end([^a-z]|$)|end[._]?\d+$|^end", key))


def read_gltf_inverse_binds(path):
    """Read a skin's inverse bind matrices straight from a glTF/GLB container.

    These are the file's own record of where each joint binds. Unlike imported node transforms they
    cannot be distorted by an importer, which makes them the authoritative check on whether a rig
    actually sits inside its mesh.
    """
    extension = os.path.splitext(path)[1].lower()
    if extension not in (".gltf", ".glb"):
        return None
    try:
        with open(path, "rb") as handle:
            data = handle.read()
        binary = None
        if data[:4] == b"glTF":
            offset = 12
            document = None
            while offset < len(data):
                length = struct.unpack_from("<I", data, offset)[0]
                kind = data[offset + 4:offset + 8]
                chunk = data[offset + 8:offset + 8 + length]
                if kind == b"JSON":
                    document = json.loads(chunk.decode("utf-8"))
                elif kind[:3] == b"BIN":
                    binary = chunk
                offset += 8 + length
            if document is None:
                return None
        else:
            document = json.loads(data.decode("utf-8"))
        skins = document.get("skins") or []
        if not skins:
            return None
        skin = max(skins, key=lambda item: len(item.get("joints") or []))
        if skin.get("inverseBindMatrices") is None:
            return None
        accessor = document["accessors"][skin["inverseBindMatrices"]]
        view = document["bufferViews"][accessor["bufferView"]]
        if binary is None:
            uri = document["buffers"][view["buffer"]]["uri"]
            with open(os.path.join(os.path.dirname(path), uri), "rb") as handle:
                binary = handle.read()
        start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        rows = []
        for slot in range(accessor["count"]):
            values = struct.unpack_from("<16f", binary, start + slot * 64)
            rows.append((document["nodes"][skin["joints"][slot]].get("name", ""), values))
        return rows
    except Exception:
        return None


def skin_bind_bounds(rows):
    """World bounds of the joints according to the inverse bind matrices, in Blender axes."""
    if not rows:
        return None
    canonical = []
    loose = []
    for name, values in rows:
        if is_helper_bone(name):
            continue
        if re.match(r"^(root|rootjoint|skeleton|armature|transform\d*|scene|reference)$", name.lower().replace("_", "")):
            continue
        # The accessor stores inverse bind matrices, so the bind position is the translation of the
        # inverse, not of the stored matrix. Column-major on disk; glTF is Y-up and the importer
        # converts to Blender's Z-up as (x, y, z) -> (x, -z, y).
        matrix = Matrix((
            (values[0], values[4], values[8], values[12]),
            (values[1], values[5], values[9], values[13]),
            (values[2], values[6], values[10], values[14]),
            (values[3], values[7], values[11], values[15]),
        ))
        try:
            position = matrix.inverted().translation
        except ValueError:
            continue
        point = Vector((position.x, -position.z, position.y))
        loose.append(point)
        # Fingers, eyes, hair and weapon sockets bind wherever the author put them; only the 19
        # canonical body joints describe where the character's skeleton sits.
        if role_of(name) is not None:
            canonical.append(point)
    points = canonical if len(canonical) >= 8 else loose
    if not points:
        return None
    lo = Vector((min(point.x for point in points), min(point.y for point in points), min(point.z for point in points)))
    hi = Vector((max(point.x for point in points), max(point.y for point in points), max(point.z for point in points)))
    return lo, hi


def rig_up_axis(armature):
    """World-space up axis, taken from the skeleton instead of assuming world Z.

    An imported glTF can leave its bones pointing along +Y inside Blender's armature space, because
    the armature node carries the Y-up conversion. Measuring foot bones against world Z then gives a
    forward vector rotated 90 degrees, which is how a portrait gets taken from the wrong side.
    """
    if not armature:
        return Vector((0, 0, 1))
    pelvis = next((bone for bone in armature.data.bones if role_of(bone.name) == "Hips"), None)
    head = next((bone for bone in armature.data.bones if role_of(bone.name) == "Head"), None)
    if pelvis is None or head is None:
        return Vector((0, 0, 1))
    delta = (armature.matrix_world @ head.head_local) - (armature.matrix_world @ pelvis.head_local)
    return delta.normalized() if delta.length > 1e-4 else Vector((0, 0, 1))


def flatten_onto(vector, up):
    return vector - up * vector.dot(up)


def facing_direction(armature):
    """Front-facing world direction, with the evidence that produced it.

    Bone axes are the only cue available before rendering, but different heuristics disagree: on the
    Goku fixture the foot bones run down the leg while the eye bones sit in the plane of the skull,
    so trusting either one alone can photograph the wrong side of the head. Every candidate is
    projected onto the rig's real up axis, discarded when too short to mean anything, and
    cross-checked against the others. Disagreement falls back to +Y and says so, which is honest
    about not knowing rather than confidently labelling a side.
    """
    fallback = (Vector((0, 1, 0)), "fallback +Y")
    if not armature:
        return fallback
    up = rig_up_axis(armature)
    # A skeleton whose up axis points somewhere other than the mesh's up axis is in a different
    # frame -- the Goku fixture has Y-up bones imported into a Z-up scene. Bone directions then
    # describe that other frame, so a "facing" read from them is not a direction in the picture. The
    # honest answer is to say the side was not inferred, rather than photograph the wrong one.
    if abs(up.z) < 0.7:
        return fallback[0], "not inferred (rig up axis [%.2f, %.2f, %.2f] disagrees with mesh up axis Z)" % (up.x, up.y, up.z)
    bones = [bone for bone in armature.data.bones if not is_helper_bone(bone.name)]
    head = next((bone for bone in bones if role_of(bone.name) == "Head"), None)
    pelvis = next((bone for bone in bones if role_of(bone.name) == "Hips"), None)
    span = 0.0
    if head is not None and pelvis is not None:
        span = ((armature.matrix_world @ head.head_local) - (armature.matrix_world @ pelvis.head_local)).length
    threshold = max(0.005, span * 0.05)

    signals = {}
    if head is not None:
        origin = armature.matrix_world @ head.head_local
        eyes = Vector((0, 0, 0))
        for bone in bones:
            if "eye" not in bone.name.lower():
                continue
            eyes += flatten_onto((armature.matrix_world @ bone.head_local) - origin, up)
        if eyes.length >= threshold:
            signals["eyes"] = eyes.normalized()

    feet = Vector((0, 0, 0))
    for bone in bones:
        if role_of(bone.name) not in ("LeftFoot", "RightFoot"):
            continue
        delta = (armature.matrix_world @ bone.tail_local) - (armature.matrix_world @ bone.head_local)
        feet += flatten_onto(delta, up)
    if feet.length >= threshold:
        signals["feet"] = feet.normalized()

    if not signals:
        return fallback
    names = list(signals)
    if len(names) == 1:
        return signals[names[0]], names[0] + " bones"
    reference = signals[names[0]]
    for other in names[1:]:
        if reference.dot(signals[other]) < 0.5:
            return fallback[0], "contested (%s disagree, not guessing)" % ", ".join(names)
    return reference, names[0] + " bones, corroborated by " + ", ".join(names[1:])


def render_setup(scene, lo, hi, meshes, actions, armature, forward):
    centre = (lo + hi) * 0.5
    height = max(0.001, hi.z - lo.z)
    width = max(0.001, hi.x - lo.x)
    depth = max(0.001, hi.y - lo.y)
    size = max(height, width, depth)
    right = forward.cross(Vector((0, 0, 1))).normalized()
    if right.length < 0.5:
        right = forward.cross(Vector((1, 0, 0))).normalized()

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 4
    scene.render.resolution_x = 512
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"

    world = bpy.data.worlds.new("InspectionWorld")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs[0].default_value = (0.035, 0.045, 0.065, 1)
    background.inputs[1].default_value = 0.65
    scene.world = world

    bpy.ops.mesh.primitive_plane_add(size=max(2.0, size * 8.0), location=(centre.x, centre.y, lo.z - 0.002))
    floor = bpy.context.active_object
    floor.name = "inspection_floor"
    floor_mat = bpy.data.materials.new("inspection_floor_mat")
    floor_mat.diffuse_color = (0.13, 0.15, 0.19, 1)
    floor_mat.use_nodes = True
    floor_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.13, 0.15, 0.19, 1)
    floor_mat.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.92
    floor.data.materials.append(floor_mat)

    target = bpy.data.objects.new("inspection_target", None)
    target.location = centre
    scene.collection.objects.link(target)

    camera_data = bpy.data.cameras.new("inspection_camera")
    camera_data.lens = 55
    camera_data.clip_start = max(0.0001, size * 0.001)
    camera_data.clip_end = max(1000.0, size * 100.0)
    camera = bpy.data.objects.new("inspection_camera", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    aim = camera.constraints.new("TRACK_TO")
    aim.target = target
    aim.track_axis = "TRACK_NEGATIVE_Z"
    aim.up_axis = "UP_Y"

    def add_light(name, location, energy, light_size):
        data = bpy.data.lights.new(name, type="AREA")
        data.energy = energy
        data.size = light_size
        obj = bpy.data.objects.new(name, data)
        obj.location = location
        scene.collection.objects.link(obj)
        track = obj.constraints.new("TRACK_TO")
        track.target = target
        track.track_axis = "TRACK_NEGATIVE_Z"
        track.up_axis = "UP_Y"
        return obj

    light_scale = max(0.0001, (size / 1.9) ** 2)
    light_size = max(0.05, size * 1.2)
    add_light("inspection_key", (centre.x + size * 1.3, centre.y - size * 1.7, centre.z + size * 1.5), 650 * light_scale, light_size)
    add_light("inspection_fill", (centre.x - size * 1.2, centre.y - size * 0.8, centre.z + size * 0.8), 180 * light_scale, light_size)

    distance = max(height, width, depth) * 1.9
    views = {
        "front": (centre + forward * distance).to_tuple(),
        "side": (centre + right * distance).to_tuple(),
        "threequarter": (centre + forward * distance * 0.7 + right * distance * 0.7).to_tuple(),
    }
    views = {name: (location[0], location[1], centre.z + height * (0.04 if name != "threequarter" else 0.08)) for name, location in views.items()}
    return {
        "scene": scene,
        "camera": camera,
        "camera_data": camera_data,
        "target": target,
        "floor": floor,
        "centre": centre,
        "height": height,
        "size": size,
        "forward": forward,
        "right": right,
        "views": views,
        "actions": actions,
        "armature": armature,
        "meshes": meshes,
    }


def render_to(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def make_wire_material():
    material = bpy.data.materials.new("inspection_wireframe")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    wire = nodes.new("ShaderNodeWireframe")
    wire.use_pixel_size = True
    wire.inputs["Size"].default_value = 1.0
    emission.inputs["Color"].default_value = (0.65, 0.85, 1.0, 1)
    emission.inputs["Strength"].default_value = 1.5
    material.node_tree.links.new(wire.outputs["Fac"], emission.inputs["Strength"])
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def make_bone_material():
    material = bpy.data.materials.new("inspection_bones")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1.0, 0.45, 0.08, 1)
    emission.inputs["Strength"].default_value = 2.0
    material.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def create_bone_proxies(armature, height):
    proxies = []
    radius = max(0.0005, min(0.01, height * 0.006))
    material = make_bone_material()
    for bone in armature.data.bones:
        head = armature.matrix_world @ bone.head_local
        tail = armature.matrix_world @ bone.tail_local
        midpoint = (head + tail) * 0.5
        direction = tail - head
        length = direction.length
        if length > 1e-5:
            bpy.ops.mesh.primitive_cylinder_add(
                vertices=6,
                radius=radius,
                depth=length,
                end_fill_type="NOTHING",
                location=midpoint,
            )
            cylinder = bpy.context.active_object
            cylinder.name = "rig_bone_" + bone.name
            cylinder.rotation_mode = "QUATERNION"
            cylinder.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
            cylinder.data.materials.append(material)
            proxies.append(cylinder)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=8, ring_count=6, radius=radius * 1.7, location=head)
        joint = bpy.context.active_object
        joint.name = "rig_joint_" + bone.name
        joint.data.materials.append(material)
        proxies.append(joint)
    return proxies


def main():
    if not os.path.isfile(SOURCE):
        emit({"ok": False, "error": "source file does not exist: " + SOURCE})
        return

    bpy.ops.wm.read_factory_settings(use_empty=True)
    try:
        read_import(SOURCE)
    except Exception as error:
        emit({"ok": False, "error": type(error).__name__ + ": " + str(error)[:500]})
        return

    scene = bpy.context.scene
    all_meshes = [obj for obj in scene.objects if obj.type == "MESH"]
    if not all_meshes:
        emit({"ok": False, "error": "no mesh objects were imported", "source": SOURCE})
        return
    # Sketchfab's GLB exports in this set carry a material-less unit icosphere helper. It is not
    # part of the fighter; counting it inflated every candidate's triangle total by exactly 80 and
    # made the camera frame a 2 m sphere instead of the character. Report and exclude it explicitly.
    helper_entries = []
    character_meshes = []
    for candidate in all_meshes:
        mesh = candidate.data
        is_helper = (
            candidate.name.lower().startswith("icosphere")
            and len(mesh.vertices) == 42
            and len(mesh.polygons) == 80
            and not any(slot.material for slot in candidate.material_slots)
        )
        if is_helper:
            helper_entries.append((candidate, "material-less unit icosphere helper (42 vertices, 80 triangles)"))
            candidate.hide_render = True
        else:
            character_meshes.append(candidate)
    meshes = character_meshes
    if not meshes:
        emit({"ok": False, "error": "only helper geometry was imported; no character mesh", "source": SOURCE})
        return
    armatures = [obj for obj in scene.objects if obj.type == "ARMATURE"]
    armature = max(armatures, key=lambda obj: len(obj.data.bones), default=None)
    facing_vector, facing_source = facing_direction(armature) if armature else (Vector((0, 1, 0)), "fallback +Y")
    lo, hi = world_bounds(meshes)
    geometry_facing = mesh_facing_direction(meshes, lo, hi)
    if geometry_facing is not None:
        facing_vector, facing_source = geometry_facing, "eye geometry (front of the head)"
    helper_details = []
    for helper, reason in helper_entries:
        helper.data.calc_loop_triangles()
        helper_lo, helper_hi = world_bounds([helper])
        helper_details.append({
            "name": helper.name,
            "vertices": len(helper.data.vertices),
            "triangles": len(helper.data.loop_triangles),
            "reason": reason,
            "bounds": {
                "min": [rounded(helper_lo.x), rounded(helper_lo.y), rounded(helper_lo.z)],
                "max": [rounded(helper_hi.x), rounded(helper_hi.y), rounded(helper_hi.z)],
            },
        })
    height = max(0.0, hi.z - lo.z)
    width = max(0.0, hi.x - lo.x)
    depth = max(0.0, hi.y - lo.y)

    mesh_details = []
    total_vertices = 0
    total_triangles = 0
    total_submeshes = 0
    degenerate = 0
    duplicate_positions = 0
    non_manifold = 0
    boundary = 0
    loose = 0
    uv_coverages = []
    material_names = set()
    all_images = []
    material_details = []
    texture_nodes = 0
    wire_objects = []
    object_signatures = {}

    for obj in meshes:
        mesh = obj.data
        mesh.calc_loop_triangles()
        triangles = list(mesh.loop_triangles)
        tri_count = len(triangles)
        vert_count = len(mesh.vertices)
        total_vertices += vert_count
        total_triangles += tri_count
        deg = sum(1 for tri in triangles if tri.area < 1e-10)
        degenerate += deg
        positions = set()
        for vertex in mesh.vertices:
            positions.add((round(vertex.co.x, 6), round(vertex.co.y, 6), round(vertex.co.z, 6)))
        duplicate_positions += max(0, vert_count - len(positions))
        bm = bmesh.new()
        bm.from_mesh(mesh)
        mesh_non_manifold = sum(1 for edge in bm.edges if not edge.is_manifold)
        mesh_boundary = sum(1 for edge in bm.edges if edge.is_boundary)
        mesh_loose = sum(1 for vert in bm.verts if not vert.link_edges)
        bm.free()
        non_manifold += mesh_non_manifold
        boundary += mesh_boundary
        loose += mesh_loose
        submeshes = len({poly.material_index for poly in mesh.polygons}) if mesh.polygons else 0
        total_submeshes += submeshes
        uv = uv_stats(obj, triangles)
        if uv["layers"]:
            uv_coverages.append(uv["coverage"])
        materials_for_obj = []
        for slot in obj.material_slots:
            if slot.material:
                material_names.add(slot.material.name)
                materials_for_obj.append(slot.material.name)
        signature = (obj.name, vert_count, tri_count, tuple(round(v, 3) for v in obj.dimensions))
        if signature in object_signatures:
            object_signatures[signature].append(obj.name)
        else:
            object_signatures[signature] = [obj.name]
        mesh_details.append({
            "name": obj.name,
            "vertices": vert_count,
            "triangles": tri_count,
            "submeshes": submeshes,
            "materials": materials_for_obj,
            "uv": uv,
            "degenerateTriangles": deg,
            "duplicatePositionVertices": max(0, vert_count - len(positions)),
            "nonManifoldEdges": mesh_non_manifold,
            "boundaryEdges": mesh_boundary,
            "looseVertices": mesh_loose,
        })
        for material in [slot.material for slot in obj.material_slots if slot.material]:
            if all(existing["name"] != material.name for existing in material_details):
                info = material_info(material)
                material_details.append(info)
                texture_nodes += info["imageTextureNodes"]
                if material.use_nodes and material.node_tree:
                    for node in material.node_tree.nodes:
                        if node.type == "TEX_IMAGE" and node.image:
                            if all(existing.name != node.image.name for existing in all_images):
                                all_images.append(node.image)

    duplicate_meshes = [names for names in object_signatures.values() if len(names) > 1]
    bone_names = [bone.name for bone in armature.data.bones] if armature else []
    roles = canonical_roles(bone_names)
    # A mesh without an armature modifier is not a half-weighted skin: it is either a rigid prop
    # parented to a bone (the Goku hair, 24k vertices) or an unrigged static mesh. Counting its
    # vertices as "unweighted" invented a weighting defect in a rig that has none, so the two
    # conditions are measured and reported separately.
    skinned_mesh_list = [
        obj for obj in meshes
        if any(modifier.type == "ARMATURE" and modifier.object == armature for modifier in obj.modifiers)
    ]
    rigid_mesh_list = [obj for obj in meshes if obj not in skinned_mesh_list]
    body_parts, weighted_vertices, unweighted_vertices = body_part_weights(skinned_mesh_list, set(roles.keys()))
    skinned_meshes = len(skinned_mesh_list)
    rigid_details = [
        {
            "name": obj.name,
            "vertices": len(obj.data.vertices),
            "parent": obj.parent.name if obj.parent else None,
            "parentType": obj.parent_type,
            "parentBone": obj.parent_bone,
        }
        for obj in rigid_mesh_list
    ]
    rigid_vertices = sum(item["vertices"] for item in rigid_details)
    required_roles = [
        "Hips", "Spine", "Chest", "Neck", "Head",
        "LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand",
        "RightShoulder", "RightArm", "RightForeArm", "RightHand",
        "LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
    ]
    missing_roles = [role for role in required_roles if role not in roles]
    max_depth = 0
    if armature:
        for bone in armature.data.bones:
            bone_depth = 0
            cursor = bone
            while cursor.parent:
                cursor = cursor.parent
                bone_depth += 1
            max_depth = max(max_depth, bone_depth)

    bone_bounds = None
    rig_alignment = None
    if armature and armature.data.bones:
        bone_points = []
        deform_bones = [bone for bone in armature.data.bones if not is_helper_bone(bone.name)]
        for bone in (deform_bones or list(armature.data.bones)):
            bone_points.append(armature.matrix_world @ bone.head_local)
            bone_points.append(armature.matrix_world @ bone.tail_local)
        bone_lo = Vector((
            min(point.x for point in bone_points),
            min(point.y for point in bone_points),
            min(point.z for point in bone_points),
        ))
        bone_hi = Vector((
            max(point.x for point in bone_points),
            max(point.y for point in bone_points),
            max(point.z for point in bone_points),
        ))
        bone_height = bone_hi.z - bone_lo.z
        mesh_center = (lo + hi) * 0.5
        bone_center = (bone_lo + bone_hi) * 0.5
        center_distance = (bone_center - mesh_center).length
        aligned = bool(
            bone_height > 0.01
            and bone_height >= height * 0.25
            and bone_height <= height * 3.0
            and center_distance <= max(height, width, depth) * 0.75
        )
        if aligned:
            alignment_reason = "armature bounds overlap the character bounds"
        elif bone_height <= 0.01:
            alignment_reason = "armature has essentially no world-space height"
        elif bone_height < height * 0.25:
            alignment_reason = "armature is much smaller than the character"
        elif bone_height > height * 3.0:
            alignment_reason = "armature is much larger than the character"
        else:
            alignment_reason = "armature is offset from the character by %.2f m" % center_distance
        bone_bounds = {
            "min": [rounded(bone_lo.x), rounded(bone_lo.y), rounded(bone_lo.z)],
            "max": [rounded(bone_hi.x), rounded(bone_hi.y), rounded(bone_hi.z)],
            "height": rounded(bone_height),
            "centerDistance": rounded(center_distance),
        }
        rig_alignment = {
            "aligned": aligned,
            "boneHeight": rounded(bone_height),
            "meshHeight": rounded(height),
            "centerDistance": rounded(center_distance),
            "reason": alignment_reason,
        }

    # The imported rest skeleton and the skin's own bind data can disagree: Blender applies an
    # armature node's scale in glTF one-sidedly, leaving the bones tens of metres from the body while
    # the skin still binds correctly. Reporting only the imported bones condemned a sound rig, so
    # the bind matrices -- which the runtime actually skins with -- decide the verdict.
    bind_evidence = None
    bind_box = skin_bind_bounds(read_gltf_inverse_binds(SOURCE))
    if bind_box is not None:
        bind_lo, bind_hi = bind_box
        bind_centre = (bind_lo + bind_hi) * 0.5
        mesh_centre = (lo + hi) * 0.5
        size = max(height, width, depth, 1e-6)
        bind_distance = (bind_centre - mesh_centre).length
        bind_height = bind_hi.z - bind_lo.z
        bind_evidence = {
            "available": True,
            "source": "inverse bind matrices",
            "bounds": {
                "min": [rounded(bind_lo.x), rounded(bind_lo.y), rounded(bind_lo.z)],
                "max": [rounded(bind_hi.x), rounded(bind_hi.y), rounded(bind_hi.z)],
            },
            "height": rounded(bind_height),
            "centreDistance": rounded(bind_distance),
            "aligned": bool(bind_distance <= size * 0.5 and bind_height >= height * 0.25 and bind_height <= height * 3.0),
        }
        if rig_alignment is not None and not rig_alignment["aligned"] and bind_evidence["aligned"]:
            rig_alignment["importedRestSkeleton"] = rig_alignment["reason"]
            rig_alignment["aligned"] = True
            rig_alignment["reason"] = (
                "the skin binds inside the character (inverse bind matrices, centre distance %.2f m); "
                "the imported rest skeleton is displaced because Blender applies an armature node's "
                "scale one-sidedly, which is an importer artifact and not a skinning defect" % bind_distance
            )

    actions = []
    state_coverage = set()
    for action in sorted(bpy.data.actions, key=lambda item: item.name):
        start, end = [float(value) for value in action.frame_range]
        fps = float(scene.render.fps) or 24.0
        states = action_name_score(action.name)
        state_coverage.update(states)
        actions.append({
            "name": action.name,
            "frameStart": rounded(start, 1),
            "frameEnd": rounded(end, 1),
            "durationSeconds": rounded(max(0.0, (end - start) / fps), 3),
            "fcurves": len(action.fcurves),
            "groups": len(action.groups),
            "states": states,
        })

    images = [image_record(image) for image in all_images if image.size[0] > 0]
    max_resolution = [max((image["width"] for image in images), default=0), max((image["height"] for image in images), default=0)]
    connected_maps = {
        "baseColor": sum(1 for material in material_details if material["baseColor"]),
        "normal": sum(1 for material in material_details if material["normal"]),
        "roughness": sum(1 for material in material_details if material["roughness"]),
        "metallic": sum(1 for material in material_details if material["metallic"]),
        "emission": sum(1 for material in material_details if material["emission"]),
    }
    textured_materials = sum(1 for material in material_details if material["baseColor"])

    warnings = []
    if total_triangles < 25000:
        warnings.append("below the project's 25,000-triangle HD target (%d triangles)" % total_triangles)
    if not armature:
        warnings.append("no armature; this is a static mesh")
    if not images:
        warnings.append("no usable image textures")
    if not uv_coverages:
        warnings.append("no UV layer")
    if degenerate:
        warnings.append("%d zero-area triangles" % degenerate)
    if duplicate_meshes:
        warnings.append("%d duplicate mesh signature(s)" % len(duplicate_meshes))
    if non_manifold:
        warnings.append("%d non-manifold edges" % non_manifold)
    if unweighted_vertices:
        warnings.append("%d unweighted vertices" % unweighted_vertices)
    if height and not (0.8 <= height <= 3.0):
        warnings.append("height %.2f m is outside the expected humanoid range" % height)
    if not actions:
        warnings.append("no animation clips; every gameplay state would need authoring")
    if missing_roles:
        warnings.append("%d canonical fighting roles missing" % len(missing_roles))
    if helper_details:
        warnings.append("excluded helper geometry: " + ", ".join(item["name"] + " (" + str(item["triangles"]) + " triangles)" for item in helper_details))
    if rig_alignment and not rig_alignment["aligned"]:
        warnings.append("rig alignment: " + rig_alignment["reason"])

    evidence = {}
    if not NO_RENDER:
        try:
            setup = render_setup(scene, lo, hi, meshes, actions, armature, facing_vector)
            camera = setup["camera"]
            views = setup["views"]
            # Rest pose.
            if armature:
                armature.animation_data_create()
                armature.animation_data.action = None
                for track in armature.animation_data.nla_tracks:
                    track.mute = True
            scene.frame_set(0)
            bpy.context.view_layer.update()
            camera.data.lens = 55
            camera.location = views["front"]
            evidence["front"] = render_to(scene, os.path.join(OUT_DIR, "01-front.png"))
            camera.location = views["side"]
            evidence["side"] = render_to(scene, os.path.join(OUT_DIR, "02-side.png"))

            # Textured close-up.
            target = setup["target"]
            target.location = (setup["centre"].x, setup["centre"].y, lo.z + height * 0.82)
            camera.data.lens = 70
            close_forward = setup["forward"]
            close_right = setup["right"]
            camera.location = (setup["centre"] + close_forward * height * 0.75 + close_right * height * 0.45).to_tuple()
            camera.location.z = lo.z + height * 0.86
            evidence["closeup"] = render_to(scene, os.path.join(OUT_DIR, "03-textured-closeup.png"))

            # Wireframe.
            target.location = setup["centre"]
            camera.data.lens = 55
            camera.location = views["threequarter"]
            wire_material = make_wire_material()
            originals = {}
            for obj in meshes:
                originals[obj.name] = list(obj.data.materials)
                obj.data.materials.clear()
                obj.data.materials.append(wire_material)
            evidence["wireframe"] = render_to(scene, os.path.join(OUT_DIR, "04-wireframe.png"))
            for obj in meshes:
                obj.data.materials.clear()
                for material in originals.get(obj.name, []):
                    obj.data.materials.append(material)

            # Schematic rig view. Armatures do not render in Cycles, so bone proxies are used. When
            # the importer has displaced the rest skeleton (the bind-pose check says where the skin
            # really binds), a proxy render would draw bones where they are not: skip it and keep the
            # bind evidence instead of publishing a misleading picture.
            if armature and not (rig_alignment and rig_alignment.get("importedRestSkeleton")):
                for obj in meshes:
                    obj.hide_render = True
                proxies = create_bone_proxies(armature, height)
                bpy.context.view_layer.update()
                evidence["rig"] = render_to(scene, os.path.join(OUT_DIR, "05-rig.png"))
                for proxy in proxies:
                    bpy.data.objects.remove(proxy, do_unlink=True)
                for obj in meshes:
                    obj.hide_render = False

            # Animation preview at 40% through the first suitable clip.
            action = None
            if armature:
                preferred = ["idle", "walk", "run", "attack", "punch", "kick", "hit", "jump"]
                for hint in preferred:
                    action = next((item for item in bpy.data.actions if hint in item.name.lower()), None)
                    if action:
                        break
                if not action and bpy.data.actions:
                    action = bpy.data.actions[0]
            if action and armature:
                armature.animation_data.action = action
                for track in armature.animation_data.nla_tracks:
                    track.mute = True
                start, end = action.frame_range
                scene.frame_set(int(start + (end - start) * 0.4))
                camera.data.lens = 55
                camera.location = views["threequarter"]
                evidence["animation"] = render_to(scene, os.path.join(OUT_DIR, "06-animation-preview.png"))
                armature.animation_data.action = None
        except Exception as error:
            warnings.append("rendering failed: " + type(error).__name__ + ": " + str(error)[:300])

    emit({
        "ok": True,
        "source": SOURCE,
        "format": os.path.splitext(SOURCE)[1].lower(),
        "bytes": os.path.getsize(SOURCE),
        "bounds": {
            "min": [rounded(lo.x), rounded(lo.y), rounded(lo.z)],
            "max": [rounded(hi.x), rounded(hi.y), rounded(hi.z)],
            "height": rounded(height),
            "width": rounded(width),
            "depth": rounded(depth),
            "upright": bool(height >= max(width, depth) * 0.55),
            "feetBelowOrigin": rounded(-lo.z),
        },
        "orientation": {
            "forward": [rounded(value) for value in facing_vector],
            "source": facing_source,
            "upAxis": [rounded(value) for value in rig_up_axis(armature)] if armature else [0, 0, 1],
        },
        "geometry": {
            "meshes": len(meshes),
            "allMeshes": len(all_meshes),
            "helpers": helper_details,
            "vertices": total_vertices,
            "allVertices": total_vertices + sum(item["vertices"] for item in helper_details),
            "triangles": total_triangles,
            "allTriangles": total_triangles + sum(item["triangles"] for item in helper_details),
            "submeshes": total_submeshes,
            "materials": len(material_names),
            "degenerateTriangles": degenerate,
            "duplicatePositionVertices": duplicate_positions,
            "nonManifoldEdges": non_manifold,
            "boundaryEdges": boundary,
            "looseVertices": loose,
            "duplicateMeshes": duplicate_meshes,
            "meshDetails": mesh_details,
        },
        "materials": {
            "count": len(material_details),
            "names": sorted(material_names),
            "texturedMaterials": textured_materials,
            "imageTextureNodes": texture_nodes,
            "connectedMaps": connected_maps,
            "details": material_details,
        },
        "textures": {
            "count": len(images),
            "maxResolution": max_resolution,
            "images": images,
        },
        "rig": {
            "armatures": len(armatures),
            "bones": len(bone_names),
            "roots": [bone.name for bone in armature.data.bones if not bone.parent] if armature else [],
            "boneBounds": bone_bounds,
            "alignment": rig_alignment,
            "aligned": bool(rig_alignment and rig_alignment["aligned"]),
            "skinBind": bind_evidence,
            "maxDepth": max_depth,
            "connectedBones": sum(1 for bone in armature.data.bones if bone.use_connect) if armature else 0,
            "skinnedMeshes": skinned_meshes,
            "canonicalRoles": roles,
            "missingCanonicalRoles": missing_roles,
            "retargetCoverage": rounded(len(roles) / len(required_roles), 3),
            "weaponHands": [role for role in ("LeftHand", "RightHand") if role in roles],
            "weightedVertices": weighted_vertices,
            "unweightedVertices": unweighted_vertices,
            "weightedRatio": rounded(weighted_vertices / max(1, weighted_vertices + unweighted_vertices), 3),
            "bodyPartVertices": body_parts,
            "rigidAttachedMeshes": rigid_details,
            "rigidAttachedVertices": rigid_vertices,
        },
        "animations": {
            "count": len(actions),
            "clips": actions,
            "statesCovered": sorted(state_coverage),
            "missingStates": sorted(set(["idle", "walk", "run", "jump", "attack", "hit", "block", "victory", "defeat"]) - state_coverage),
        },
        "uvCoverage": rounded(sum(uv_coverages) / len(uv_coverages), 3) if uv_coverages else 0,
        "warnings": warnings,
        "evidence": {"directory": OUT_DIR, "images": evidence},
    })


try:
    main()
except SystemExit:
    raise
except Exception as error:
    emit({"ok": False, "error": type(error).__name__ + ": " + str(error)[:500]})
