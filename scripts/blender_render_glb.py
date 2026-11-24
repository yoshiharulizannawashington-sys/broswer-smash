"""Render front and side views of a GLB so geometry and rigging can be inspected visually."""

import json
import math
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SOURCE, OUT_DIR = argv[0], argv[1]
FRAME = int(argv[2]) if len(argv) > 2 else 0
ACTION = argv[3] if len(argv) > 3 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
meshes = [o for o in bpy.data.objects if o.type == "MESH"]
if not meshes:
    print("RESULT:" + '{"ok": false, "error": "no mesh"}')
    raise SystemExit(0)

report = []
xs, ys, zs = [], [], []
for obj in meshes:
    matrix = obj.matrix_world
    local_x, local_y, local_z = [], [], []
    for vertex in obj.data.vertices:
        co = matrix @ vertex.co
        xs.append(co.x)
        ys.append(co.y)
        zs.append(co.z)
        local_x.append(co.x)
        local_y.append(co.y)
        local_z.append(co.z)
    report.append({
        "name": obj.name,
        "z": [round(min(local_z), 3), round(max(local_z), 3)],
        "x": [round(min(local_x), 3), round(max(local_x), 3)],
    })

centre = ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2)
size = max(max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))

scene = bpy.context.scene
# Cycles on CPU: this VM has no working EGL, so EEVEE cannot create a GL context headless.
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 640
scene.render.resolution_y = 800
# Play one named clip so the render shows deformation, not just the rest pose.
if ACTION:
    rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
    if rig:
        action = next((a for a in bpy.data.actions if a.name.lower().startswith(ACTION.lower())), None)
        if action:
            rig.animation_data_create()
            rig.animation_data.action = action
            for track in rig.animation_data.nla_tracks:
                track.mute = True
            print("playing action:", action.name, "range", tuple(action.frame_range))
scene.frame_set(FRAME)

world = bpy.data.worlds.new("World")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.09, 0.1, 0.13, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.2
scene.world = world

target = bpy.data.objects.new("target", None)
target.location = centre
scene.collection.objects.link(target)

light_data = bpy.data.lights.new("key", type="AREA")
light_data.energy = 700
light_data.size = max(3.0, size)
light = bpy.data.objects.new("key", light_data)
light.location = (centre[0] + size * 1.2, centre[1] - size * 1.6, centre[2] + size * 1.2)
scene.collection.objects.link(light)
constraint = light.constraints.new("TRACK_TO")
constraint.target = target
constraint.track_axis = "TRACK_NEGATIVE_Z"
constraint.up_axis = "UP_Y"

camera_data = bpy.data.cameras.new("cam")
camera_data.lens = 55
camera = bpy.data.objects.new("cam", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera
aim = camera.constraints.new("TRACK_TO")
aim.target = target
aim.track_axis = "TRACK_NEGATIVE_Z"
aim.up_axis = "UP_Y"

os.makedirs(OUT_DIR, exist_ok=True)
distance = size * 2.0
views = {
    "front": (centre[0], centre[1] - distance, centre[2] + size * 0.05),
    "side": (centre[0] + distance, centre[1], centre[2] + size * 0.05),
}
for name, location in views.items():
    camera.location = location
    scene.render.filepath = os.path.join(OUT_DIR, f"{name}.png")
    bpy.ops.render.render(write_still=True)

print("RESULT:" + json.dumps({"ok": True, "dir": OUT_DIR, "height": round(max(zs) - min(zs), 3), "meshes": len(meshes), "objects": report}))
