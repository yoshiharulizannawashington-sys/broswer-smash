"""Blender scene generator for Browser Smash's Final Valley arena.

Run with Blender 3.6+:
  blender --background --python assets/blender/final_valley_scene.py
This creates an editable final_valley.blend and exports final_valley.glb.
The game currently has a procedural Three.js fallback scene.
"""
import bpy, math, random, os
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
random.seed(948271)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
    for datablock in list(datablocks):
        if datablock.users == 0:
            datablocks.remove(datablock)

def material(name, color, roughness=.88, metallic=.04, emission=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    if emission:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
    return m

stone = material('Weathered slate', (.28,.36,.37))
shadow = material('Deep cliff shadow', (.12,.18,.2))
moss = material('Moss and forest', (.15,.31,.19))
pine = material('Pine green', (.08,.23,.14))
water = material('River turquoise', (.025,.31,.48), .18, .25, .18)
foam = material('Waterfall foam', (.42,.82,.91), .2, .05, .2)
statue = material('Ancient statue stone', (.43,.47,.45))
rune = material('Carved cyan runes', (.03,.56,.68), .25, .3, 1.2)

def finish(obj, name, mat, loc, scale=None):
    obj.name = name
    obj.location = loc
    if scale:
        obj.scale = scale
    obj.data.materials.append(mat)
    if obj.type == 'MESH':
        for p in obj.data.polygons:
            p.use_smooth = False
        bevel = obj.modifiers.new('Tiny bevels', 'BEVEL')
        bevel.width = .08
        bevel.segments = 1
    return obj

def ico(name, loc, scale, mat, sub=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=1, location=loc)
    return finish(bpy.context.object, name, mat, loc, scale)

def box(name, loc, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    return finish(bpy.context.object, name, mat, loc, scale)

def cone(name, loc, radius, depth, mat, verts=6):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=radius, radius2=.05, depth=depth, location=loc)
    return finish(bpy.context.object, name, mat, loc)

def cyl(name, loc, radius, depth, mat, verts=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc)
    return finish(bpy.context.object, name, mat, loc)

# Broad playable clearing and river channel.
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=57, depth=.5, location=(0,-.36,-30))
finish(bpy.context.object, 'Arena clearing', stone, (0,-.36,-30))
box('Central river', (0,.02,-48), (12,.06,145), water)

# Layered cliff walls, waterfall curtains and pools frame the arena.
for side in (-1,1):
    for i in range(6):
        x = side * (28 + random.uniform(-5,8))
        z = -94 + i*16 + random.uniform(-3,3)
        h = random.uniform(16,31)
        ico('Jagged cliff', (x,h*.42,z), (random.uniform(7,13),h,random.uniform(8,15)), stone if i%2 else shadow, 2)
        ico('Moss cap', (x-side*2,h*.86,z+1), (random.uniform(4,8),1.5,random.uniform(4,8)), moss, 1)
    box('Waterfall sheet', (side*17,9,-82), (11,18,.16), foam)
    cyl('Waterfall basin', (side*17,.02,-70), 8, .08, water, 32)

# Two original giant shinobi guardian statues, built from editable primitives.
def guardian(x, mirror):
    z = -51
    box('Statue plinth', (x,1,z), (8,2,7), shadow)
    cyl('Layered pedestal', (x,3,z), 3.8, 2.2, stone, 8)
    cyl('Carved robe torso', (x,7,z), 2.3, 6.5, statue, 8)
    ico('Mask head', (x,12,z), (2.2,2.7,1.9), statue, 2)
    box('Brow ridge', (x,13.1,z+1.65), (3.4,.55,.35), shadow)
    box('Face plate', (x,12,z+1.72), (2.1,1,.28), stone)
    box('Shoulder mantle', (x,10,z), (5.8,2.1,2.4), statue)
    arm = cyl('Left arm', (x-3*mirror,8.2,z), .75, 5.4, statue, 7)
    arm.rotation_euler[2] = -.3*mirror
    arm = cyl('Right arm', (x+3*mirror,8.2,z), .75, 5.4, statue, 7)
    arm.rotation_euler[2] = .3*mirror
    box('Left leg', (x-1.2,2.8,z), (1.3,4.6,1.6), shadow)
    box('Right leg', (x+1.2,2.8,z), (1.3,4.6,1.6), shadow)
    box('Raised stone blade', (x+6.2*mirror,17.2,z), (.55,8,.7), shadow)
    box('Blade rune', (x+6.5*mirror,17,z+.38), (.12,5.5,.08), rune)
    for side in (-1,1):
        box('Eye rune', (x+side*.52,12.4,z+1.92), (.16,.14,.05), rune)

guardian(-38,1)
guardian(38,-1)

# Forested outer ridges and a stepping-stone trail across the river.
for side in (-1,1):
    for i in range(22):
        x = side * random.uniform(44,78)
        z = random.uniform(-108,38)
        h = random.uniform(3,7)
        cyl('Pine trunk', (x,h/2,z), .32, h, shadow, 5)
        for layer in range(3):
            cone('Pine canopy', (x,h*.55+layer*1.7,z), random.uniform(1.6,2.7), 3.5, pine if i%3 else moss, 6)
for i in range(13):
    x = math.sin(i*.78)*4.4
    z = 12-i*5.2
    ico('River stepping stone', (x,.14,z), (random.uniform(1.2,2),.24,random.uniform(1.2,2)), stone, 1)
for i in range(16):
    x = -105+i*14
    h = random.uniform(25,45)
    cone('Distant ridgeline', (x,h*.45,-124), random.uniform(8,14), h, shadow, 6)

# A lighting rig and camera make the .blend immediately inspectable.
world = bpy.data.worlds.new('Final Valley dusk') if not bpy.data.worlds else bpy.data.worlds[0]
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.025,.045,.08,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .45
bpy.ops.object.light_add(type='AREA', location=(-25,55,10))
key = bpy.context.object
key.name = 'Warm valley key'
key.data.energy = 5000
key.data.shape = 'DISK'
key.data.size = 45
key.rotation_euler = (math.radians(25),0,math.radians(-25))
bpy.ops.object.light_add(type='AREA', location=(30,25,-70))
rim = bpy.context.object
rim.name = 'Cool waterfall rim'
rim.data.energy = 3000
rim.data.color = (.25,.65,1)
rim.data.size = 30
rim.rotation_euler = (math.radians(35),0,math.radians(155))
bpy.ops.object.camera_add(location=(105,95,115))
cam = bpy.context.object
cam.name = 'Final Valley overview'
direction = Vector((0,8,-38)) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
cam.data.lens = 42
bpy.context.scene.camera = cam
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR,'final_valley.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = None
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT_DIR,'final_valley.glb'), export_format='GLB', export_apply=True, export_yup=True)
print('Saved Final Valley .blend and .glb to', OUT_DIR)
