"""Bake a reusable fighting animation set onto the supplied Goku FBX and Iron Man GLTF rigs.

Run from the repository root with Blender 3.6+:
  blender --background --python assets/blender/character_animation_bake.py -- \
    --goku public/models/characters/goku/Goku.fbx \
    --ironman "public/models/characters/iron-man-mark-v-rig/Iron Man Mark V Rig Materials.gltf" \
    --output public/models/characters/animated

This generates animated GLBs with named NLA clips. The poses are procedural keyframed
starter animations, not motion-capture. Inspect and refine them in Blender before shipping.
"""
import argparse
import math
import os
import re
import sys
import bpy

FPS = 30
CLIPS = [
    ("Idle", 48),
    ("Walk", 24),
    ("Run", 18),
    ("Jump", 24),
    ("Land", 14),
    ("Punch", 16),
    ("HeavyAttack", 24),
    ("HitReact", 16),
    ("Block", 18),
    ("Dodge", 14),
    ("Charge", 30),
    ("BeamAttack", 20),
    ("Flight", 24),
]

def cli_args():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--goku", required=True)
    parser.add_argument("--ironman", required=True)
    parser.add_argument("--output", default="public/models/characters/animated")
    return parser.parse_args(args)

def apply_goku_textures(armature, texture_dir):
    """Wire the package's WebP maps into Principled materials before GLB export."""
    def load_image(filename, color_space):
        filepath = os.path.join(texture_dir, filename)
        if not os.path.exists(filepath):
            return None
        image = bpy.data.images.load(filepath, check_existing=True)
        image.colorspace_settings.name = color_space
        return image
    maps = {
        "skin": ("skin_c.webp", "skin_n.webp", "skin_ORM.webp"),
        "face": ("face_ss_c.webp", "face_ss_n.webp", "face_ss_ORM.webp"),
        "hair": ("hair_c.webp", "hair_ss_n.webp", None),
        "cloth": ("cloth_c.webp", "cloth_n.webp", "cloth_ORM.webp"),
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            material = slot.material
            if material is None:
                continue
            label = (obj.name + " " + material.name).lower()
            key = "face" if "face" in label else "hair" if "hair" in label else "cloth" if any(word in label for word in ("cloth", "shirt", "pant", "boot", "glove")) else "skin"
            color_file, normal_file, orm_file = maps[key]
            material.use_nodes = True
            nodes = material.node_tree.nodes
            links = material.node_tree.links
            principled = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
            output = next((n for n in nodes if n.type == "OUTPUT_MATERIAL"), None)
            if principled is None or output is None:
                continue
            color = load_image(color_file, "sRGB")
            normal = load_image(normal_file, "Non-Color")
            orm = load_image(orm_file, "Non-Color") if orm_file else None
            if color:
                tex = nodes.new("ShaderNodeTexImage")
                tex.image = color
                tex.label = key.title() + " base color"
                links.new(tex.outputs["Color"], principled.inputs["Base Color"])
            if normal:
                tex = nodes.new("ShaderNodeTexImage")
                tex.image = normal
                tex.label = key.title() + " normal"
                normal_node = nodes.new("ShaderNodeNormalMap")
                links.new(tex.outputs["Color"], normal_node.inputs["Color"])
                links.new(normal_node.outputs["Normal"], principled.inputs["Normal"])
            if orm:
                tex = nodes.new("ShaderNodeTexImage")
                tex.image = orm
                tex.label = key.title() + " packed occlusion/roughness/metallic"
                separate = nodes.new("ShaderNodeSeparateRGB")
                links.new(tex.outputs["Color"], separate.inputs["Image"])
                links.new(separate.outputs["G"], principled.inputs["Roughness"])
                links.new(separate.outputs["B"], principled.inputs["Metallic"])

def import_character(filepath):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.actions, bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        # Do not remove linked datablocks still used by other objects.
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    ext = os.path.splitext(filepath)[1].lower()
    if ext == ".fbx":
        bpy.ops.import_scene.fbx(filepath=os.path.abspath(filepath), automatic_bone_orientation=False)
    elif ext in (".gltf", ".glb"):
        bpy.ops.import_scene.gltf(filepath=os.path.abspath(filepath))
    else:
        raise ValueError("Unsupported character format: " + ext)
    armatures = [obj for obj in bpy.context.scene.objects if obj.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("No armature found in " + filepath)
    armature = max(armatures, key=lambda obj: len(obj.data.bones))
    armature.animation_data_clear()
    armature.animation_data_create()
    if ext == ".fbx":
        apply_goku_textures(armature, os.path.dirname(os.path.abspath(filepath)))
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.context.scene.render.fps = FPS
    return armature

def side(name):
    value = re.sub(r"[^a-z0-9]+", " ", name.lower().replace("mixamorig:", ""))
    if re.search(r"\bleft\b", value) or re.search(r"\bl\b", value) or name.lower().endswith((".l", "_l", "-l")):
        return "L"
    if re.search(r"\bright\b", value) or re.search(r"\br\b", value) or name.lower().endswith((".r", "_r", "-r")):
        return "R"
    return ""

def family(name):
    n = name.lower().replace("mixamorig:", "").replace("_", "").replace(".", "")
    if any(k in n for k in ("pelvis", "hips", "root")):
        return "pelvis"
    if any(k in n for k in ("spine", "chest", "torso")):
        return "torso"
    if any(k in n for k in ("head", "neck")):
        return "head"
    if any(k in n for k in ("shoulder", "clavicle")):
        return "shoulder"
    if any(k in n for k in ("forearm", "lowerarm", "elbow")):
        return "forearm"
    if any(k in n for k in ("upperarm", "arm")):
        return "arm"
    if any(k in n for k in ("hand", "wrist", "palm")):
        return "hand"
    if any(k in n for k in ("thigh", "upperleg", "upleg")):
        return "thigh"
    if any(k in n for k in ("shin", "calf", "lowerleg", "knee")):
        return "shin"
    if "leg" in n:
        return "thigh"
    return "other"

def delta(clip, bone_name, phase, t):
    f = family(bone_name)
    s = side(bone_name)
    sign = -1.0 if s == "L" else 1.0
    wave = math.sin(phase * math.tau)
    pulse = math.sin(math.pi * phase)
    out = [0.0, 0.0, 0.0]
    if clip == "Idle":
        if f == "torso": out[0] = math.sin(t * math.tau) * .025
        if f == "head": out[2] = math.sin(t * math.tau) * .012
    elif clip in ("Walk", "Run"):
        rate = 1.0 if clip == "Walk" else 1.45
        amp = .34 if clip == "Walk" else .62
        if f == "thigh": out[0] = wave * amp * sign
        if f == "shin": out[0] = max(0.0, -wave * sign) * .5
        if f in ("arm", "forearm"): out[0] = -wave * amp * sign * .72
        if f == "torso": out[2] = math.sin(phase * math.tau * rate) * .035
    elif clip == "Jump":
        if f in ("arm", "shoulder"): out[0] = -.9 * pulse
        if f == "forearm": out[0] = -.42 * pulse
        if f == "thigh": out[0] = -.35 * pulse
        if f == "shin": out[0] = .38 * pulse
        if f == "torso": out[0] = -.12 * pulse
    elif clip == "Land":
        if f in ("thigh", "shin"): out[0] = .48 * (1.0 - phase)
        if f in ("arm", "shoulder"): out[0] = -.45 * (1.0 - phase)
        if f == "torso": out[0] = .18 * (1.0 - phase)
    elif clip in ("Punch", "HeavyAttack"):
        power = 1.0 if clip == "Punch" else 1.42
        if f == "arm": out[0] = -1.08 * pulse * power if s == "R" else -.2 * pulse
        if f == "forearm": out[0] = -.72 * pulse * power if s == "R" else -.12 * pulse
        if f == "shoulder": out[0] = -.32 * pulse * power
        if f == "hand": out[0] = -.14 * pulse
        if f == "torso":
            out[0] = .14 * pulse * power
            out[1] = -.3 * pulse * power
            out[2] = .1 * pulse * power
        if f == "thigh": out[0] = .12 * pulse * power * sign
    elif clip == "HitReact":
        if f in ("arm", "shoulder"): out[0] = .6 * pulse
        if f == "forearm": out[0] = -.28 * pulse
        if f == "torso": out[0] = .32 * pulse
        if f == "head": out[0] = .16 * pulse
    elif clip == "Block":
        if f == "arm": out[0] = -.78
        if f == "forearm": out[0] = -.72
        if f == "shoulder": out[0] = -.25
        if f == "torso": out[0] = -.06
    elif clip == "Dodge":
        if f == "torso": out[2] = .55 * pulse
        if f == "thigh": out[0] = .45 * pulse
        if f == "arm": out[0] = .38 * pulse
    elif clip == "Charge":
        if f in ("arm", "shoulder"): out[0] = -.52 * pulse
        if f == "forearm": out[0] = -.8 * pulse
        if f == "hand": out[0] = -.25 * pulse
        if f == "torso": out[0] = -.08 * pulse
    elif clip == "BeamAttack":
        if f in ("arm", "shoulder"): out[0] = -.92 if s == "R" else -.78
        if f == "forearm": out[0] = -.22
        if f == "hand": out[0] = -.08
        if f == "torso": out[0] = -.08
    elif clip == "Flight":
        if f == "arm": out[0] = -.72 if s == "R" else -.62
        if f == "shoulder": out[2] = .3 * sign
        if f == "thigh": out[0] = -.34 if s == "R" else -.24
        if f == "shin": out[0] = .26
    return tuple(out)

def bake_actions(armature):
    pose_bones = list(armature.pose.bones)
    base = {pb.name: pb.rotation_euler.copy() for pb in pose_bones}
    animation_data = armature.animation_data
    animation_data.action = None
    for track in list(animation_data.nla_tracks):
        animation_data.nla_tracks.remove(track)
    for clip, length in CLIPS:
        action = bpy.data.actions.new(name=clip)
        action.use_fake_user = True
        animation_data.action = action
        for pb in pose_bones:
            pb.rotation_mode = "XYZ"
        samples = sorted(set([1, 2, max(3, length // 3), max(4, length // 2), max(5, length - 2), length]))
        for frame in samples:
            phase = (frame - 1) / max(1, length - 1)
            t = phase
            for pb in pose_bones:
                pb.rotation_euler = base[pb.name]
                d = delta(clip, pb.name, phase, t)
                pb.rotation_euler.x += d[0]
                pb.rotation_euler.y += d[1]
                pb.rotation_euler.z += d[2]
                pb.keyframe_insert(data_path="rotation_euler", frame=frame, group=pb.name)
        # Blender's default keyframe interpolation is Bezier; avoid relying on legacy Action.fcurves APIs.
        animation_data.action = None
        track = animation_data.nla_tracks.new()
        track.name = clip
        strip = track.strips.new(clip, 1, action)
        strip.name = clip
        strip.action_frame_start = 1
        strip.action_frame_end = length
        strip.blend_type = "REPLACE"
        strip.extrapolation = "NOTHING"
    for pb in pose_bones:
        pb.rotation_euler = base[pb.name]
    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = max(length for _, length in CLIPS)

def export_character(source, output_path):
    armature = import_character(source)
    bake_actions(armature)
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = armature
    # Keep an editable Blender project with the rig and NLA clips alongside the web export.
    blend_path = os.path.splitext(os.path.abspath(output_path))[0] + ".blend"
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(output_path),
        export_format="GLB",
        export_animations=True,
        export_nla_strips=True,
        export_force_sampling=True,
        export_skins=True,
        export_materials="EXPORT",
        export_apply=True,
        export_yup=True,
    )
    print("Exported animated character:", output_path)

def main():
    args = cli_args()
    out = os.path.abspath(args.output)
    export_character(args.goku, os.path.join(out, "goku-animated.glb"))
    export_character(args.ironman, os.path.join(out, "iron-man-animated.glb"))

if __name__ == "__main__":
    main()
