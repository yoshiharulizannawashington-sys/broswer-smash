"""Bake the game's compiled Naruto clips into a clip-only GLB on his Rigify skeleton.

    bash scripts/run-browser-test.sh scripts/export-naruto-authored-tracks.mjs
    bash scripts/blender.sh -b --python assets/blender/naruto_authored_bake.py -- \
        --source public/models/characters/naruto_uzumaki/naruto_uzumaki.glb \
        --clips artifacts/naruto-authored/tracks.json \
        --out public/models/characters/naruto_uzumaki/naruto_authored.glb

The clips are the runtime-compiled authoring, so this does not re-invent the motion in Python: it
converts each three.js quaternion track back to a Blender pose-bone basis (rest^-1 * q), keyframes it
at the same times, and exports the armature only. The body, textures and rest pose stay in the
source file, which is never written.
"""
import argparse
import json
import os
import re
import sys

import bpy
from mathutils import Quaternion

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
import rig_authoring as ra  # noqa: E402

FPS = 30


def sanitize(name):
    """Mirror three.js PropertyBinding.sanitizeNodeName for GLTFLoader-renamed bones."""
    return re.sub(r"[\[\]\.:/]", "", re.sub(r"\s", "_", str(name)))


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default="public/models/characters/naruto_uzumaki/naruto_uzumaki.glb")
    parser.add_argument("--clips", default="artifacts/naruto-authored/tracks.json")
    parser.add_argument("--out", default="public/models/characters/naruto_uzumaki/naruto_authored.glb")
    return parser.parse_args(argv)


def rest_local_rotation(bone):
    rest = bone.matrix_local.to_quaternion()
    if bone.parent:
        rest = bone.parent.matrix_local.to_quaternion().inverted() @ rest
    return rest


def build_action(armature, clip, lookup):
    action = bpy.data.actions.new(clip["name"])
    action.use_fake_user = True
    armature.animation_data.action = action
    for pose_bone in armature.pose.bones:
        pose_bone.rotation_mode = "QUATERNION"
        pose_bone.rotation_quaternion = (1, 0, 0, 0)

    max_frame = 1
    missing = set()
    used_bones = set()
    for track in clip["tracks"]:
        node, _, prop = track["name"].rpartition(".")
        if prop != "quaternion":
            continue
        bone = lookup.get(node) or lookup.get(sanitize(node))
        if bone is None:
            missing.add(node)
            continue
        pose_bone = armature.pose.bones[bone.name]
        basis = rest_local_rotation(bone).inverted()
        values = track["values"]
        used_bones.add(bone.name)
        for index, time in enumerate(track["times"]):
            quaternion = Quaternion(values[index * 4:index * 4 + 4]).normalized()
            pose_bone.rotation_quaternion = basis @ quaternion
            frame = 1 + int(round(float(time) * FPS))
            pose_bone.keyframe_insert("rotation_quaternion", frame=frame, group=bone.name)
            max_frame = max(max_frame, frame)

    for fcurve in action.fcurves:
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = "LINEAR"
    action.frame_start = 1
    action.frame_end = max_frame
    return action, missing, used_bones


def main():
    args = parse_args()
    with open(args.clips, "r", encoding="utf-8") as handle:
        data = json.load(handle)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    armature = ra.import_model(args.source)
    lookup = {bone.name: bone for bone in armature.data.bones}
    lookup.update({sanitize(bone.name): bone for bone in armature.data.bones})
    print("RIG bones=" + str(len(armature.data.bones)))

    actions = []
    all_missing = set()
    for entry in data["strikes"] + data["forms"]:
        clip = entry["clip"]
        action, missing, bones = build_action(armature, clip, lookup)
        actions.append(action)
        all_missing |= missing
        print("CLIP %s frames=%d..%d bones=%d missing=%d"
              % (action.name, action.frame_start, action.frame_end, len(bones), len(missing)))

    for track in list(armature.animation_data.nla_tracks):
        armature.animation_data.nla_tracks.remove(track)
    ra.to_nla(armature, actions)
    ra.drop_geometry()
    # Not rig_authoring.export: its defaults bake all 567 bones into every clip (1701 channels,
    # 8.3 MB). Only 7-11 joints are actually keyed, so export those and leave the rest at rest.
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.export_scene.gltf(
        filepath=args.out,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_bake_animation=False,
        export_anim_single_armature=True,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_armature=False,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="NONE",
    )
    print("WROTE " + args.out + " actions=" + str(len(actions)))
    if all_missing:
        print("MISSING_BONES " + ", ".join(sorted(all_missing)))


if __name__ == "__main__":
    main()
