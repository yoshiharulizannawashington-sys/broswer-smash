"""Render a character GLB across clips and camera angles in a single session.

Usage:
  blender -b --python scripts/blender_render_clips.py -- <model.glb> <outDir> [clip ...]
"""

import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SOURCE, OUT_DIR = argv[0], argv[1]
CLIPS = argv[2:] or ["idle", "walk", "run", "jab", "heavy_punch", "jump", "hit_light"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("RESULT:" + json.dumps({"ok": False, "error": "no mesh"}))
    raise SystemExit(0)

# Bounds from the character only, ignoring any stray helper geometry.
xs, ys, zs = [], [], []
for obj in meshes:
    matrix = obj.matrix_world
    for vertex in obj.data.vertices:
        co = matrix @ vertex.co
        xs.append(co.x)
        ys.append(co.y)
        zs.append(co.z)
centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
height = max(zs) - min(zs)
width = max(max(xs) - min(xs), max(ys) - min(ys))

scene = bpy.context.scene
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 16
scene.cycles.use_denoising = True
scene.render.resolution_x = 460
scene.render.resolution_y = 560
scene.render.film_transparent = False

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.10, 0.11, 0.14, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.3
scene.world = world

target = bpy.data.objects.new("target", None)
target.location = centre
scene.collection.objects.link(target)

light_data = bpy.data.lights.new("key", type="AREA")
light_data.energy = 800
light_data.size = max(3.0, height)
light = bpy.data.objects.new("key", light_data)
light.location = (centre[0] + height, centre[1] - height * 1.4, centre[2] + height)
scene.collection.objects.link(light)
aim = light.constraints.new("TRACK_TO")
aim.target = target
aim.track_axis = "TRACK_NEGATIVE_Z"
aim.up_axis = "UP_Y"

camera_data = bpy.data.cameras.new("cam")
camera_data.lens = 55
camera = bpy.data.objects.new("cam", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
camera.constraints.new("TRACK_TO").target = target
# GROUND_PLANE: a z=0 reference so foot contact can be judged visually instead of inferred.
bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
_floor = bpy.context.active_object
_floor.name = "groundref"
_mat = bpy.data.materials.new("groundref")
_mat.diffuse_color = (0.22, 0.24, 0.28, 1)
_mat.use_nodes = True
_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.22, 0.24, 0.28, 1)
_floor.data.materials.append(_mat)

distance = max(height, width) * 2.1
VIEWS = {
    "front": (centre[0], centre[1] - distance, centre[2] + height * 0.06),
    "side": (centre[0] + distance, centre[1], centre[2] + height * 0.06),
    "threequarter": (centre[0] + distance * 0.72, centre[1] - distance * 0.72, centre[2] + height * 0.1),
}

os.makedirs(OUT_DIR, exist_ok=True)
rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True

written = []
for clip in CLIPS:
    action = next((a for a in bpy.data.actions if a.name.lower().startswith(clip.lower())), None)
    if not action:
        continue
    start, end = action.frame_range
    frame = int(start + (end - start) * 0.55)
    rig.animation_data.action = action
    scene.frame_set(frame)
    for view, location in VIEWS.items():
        camera.location = location
        path = os.path.join(OUT_DIR, f"{clip}-{view}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        written.append(path)

print("RESULT:" + json.dumps({"ok": True, "rendered": written, "height": round(height, 3)}))
