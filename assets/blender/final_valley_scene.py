"""Blender scene generator for Browser Smash's Final Valley arena.

Run with Blender 3.6+:
  blender --background --python assets/blender/final_valley_scene.py
This creates an editable final_valley.blend and exports final_valley.glb.
The game currently has a procedural Three.js fallback scene.
"""
import bpy, math, random, os
from array import array
from mathutils import Vector

OUT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.abspath(os.path.join(OUT_DIR, '..', '..'))
PUBLIC_ASSET_DIR = os.path.join(ROOT_DIR, 'public', 'assets')
os.makedirs(PUBLIC_ASSET_DIR, exist_ok=True)
random.seed(948271)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
    for datablock in list(datablocks):
        if datablock.users == 0:
            datablocks.remove(datablock)

def make_texture(name, size, kind, base):
    """Generate and pack a high-resolution seamless albedo texture."""
    image = bpy.data.images.new(name, width=size, height=size, alpha=True, float_buffer=False)
    image.colorspace_settings.name = 'sRGB'
    pixels = array('f')
    br, bg, bb = base
    for y in range(size):
        for x in range(size):
            fine = math.sin(x*.17 + math.sin(y*.043)*3.0)*.025
            fine += math.sin(y*.29 - x*.071)*.018 + math.cos(x*.037 + y*.091)*.018
            fine += (random.random()-.5)*.065
            if kind == 'rock':
                strata = math.sin(y*.046 + math.sin(x*.013)*2.1 + math.sin(x*.031)*.35)*.045
                fissure = -.13 if (x + int(9*math.sin(y*.025))) % 173 < 2 else 0
                fleck = .045 if random.random() > .996 else 0
                value = fine + strata + fissure + fleck
            elif kind == 'moss':
                value = fine + math.sin(x*.021 + math.sin(y*.027)*2.5)*.055
                value += math.sin(x*.071)*math.cos(y*.053)*.045
            elif kind == 'water':
                value = fine*.25 + math.sin(y*.065 + math.sin(x*.025)*1.8)*.045
                value += math.cos(y*.23 + x*.013)*.018
            else:
                value = fine*.2 + math.sin(x*.19 + math.sin(y*.018)*3.2)*.05
            pixels.extend((max(0.0,min(1.0,br+value)),
                           max(0.0,min(1.0,bg+value)),
                           max(0.0,min(1.0,bb+value)), 1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image

def make_normal_texture(name, size=512):
    image = bpy.data.images.new(name, width=size, height=size, alpha=True, float_buffer=False)
    image.colorspace_settings.name = 'Non-Color'
    pixels = array('f')
    for y in range(size):
        for x in range(size):
            nx = math.sin(x*.13+math.cos(y*.031)*1.7)*.12 + math.sin(y*.22-x*.08)*.06
            ny = math.cos(y*.15+x*.051)*.12 + math.cos(x*.075-y*.11)*.06
            pixels.extend((.5+nx,.5+ny,.97,1.0))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image

def material(name, color, roughness=.88, metallic=.04, emission=0.0,
             texture=None, alpha=1.0, normal=None):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, alpha)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bs = nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, alpha)
    bs.inputs['Roughness'].default_value = roughness
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Alpha'].default_value = alpha
    if emission:
        emission_input = bs.inputs.get('Emission Color') or bs.inputs.get('Emission')
        if emission_input:
            emission_input.default_value = (*color, 1)
        strength = bs.inputs.get('Emission Strength')
        if strength:
            strength.default_value = emission
    if texture:
        tex = nodes.new('ShaderNodeTexImage')
        tex.name = name + ' packed high-definition texture'
        tex.image = texture
        tex.interpolation = 'Linear'
        links.new(tex.outputs['Color'], bs.inputs['Base Color'])
    if normal:
        normal_tex = nodes.new('ShaderNodeTexImage')
        normal_tex.name = name + ' micro-normal'
        normal_tex.image = normal
        normal_node = nodes.new('ShaderNodeNormalMap')
        normal_node.inputs['Strength'].default_value = .22
        links.new(normal_tex.outputs['Color'], normal_node.inputs['Color'])
        links.new(normal_node.outputs['Normal'], bs.inputs['Normal'])
    return m

# Packed maps travel inside the .blend and the exported GLB. 1K albedo, 512px micro-normal.
rock_texture = make_texture('FV_WeatheredRock_1K', 1024, 'rock', (.43,.47,.44))
dark_rock_texture = make_texture('FV_ShadowRock_1K', 1024, 'rock', (.21,.26,.25))
moss_texture = make_texture('FV_MossAndLichen_1K', 1024, 'moss', (.22,.32,.20))
pine_texture = make_texture('FV_PineNeedles_1K', 1024, 'moss', (.10,.20,.12))
water_texture = make_texture('FV_ShallowWater_1K', 1024, 'water', (.22,.36,.37))
waterfall_texture = make_texture('FV_WaterfallVeil_512', 512, 'waterfall', (.64,.70,.67))
rock_normal = make_normal_texture('FV_RockMicroNormal_512', 512)

stone = material('Weathered slate · textured', (.43,.47,.44), .93, .02, texture=rock_texture, normal=rock_normal)
shadow = material('Deep cliff shadow · textured', (.21,.26,.25), .97, .01, texture=dark_rock_texture, normal=rock_normal)
moss = material('Moss and lichen · textured', (.22,.32,.20), .96, .0, texture=moss_texture)
pine = material('Pine green · textured', (.10,.20,.12), .95, .0, texture=pine_texture)
water = material('Shallow clear river', (.22,.36,.37), .24, .03, .025, texture=water_texture, alpha=.78)
foam = material('Waterfall veil and spray', (.64,.70,.67), .38, .0, .03, texture=waterfall_texture, alpha=.64)
statue = material('Ancient statue stone', (.45,.49,.45), .9, .015, texture=rock_texture, normal=rock_normal)
rune = material('Old mineral inlay', (.22,.43,.44), .48, .1, .18)
hair_stone = material('Carved hair shadow', (.20,.25,.25), .96, .01, texture=dark_rock_texture, normal=rock_normal)

def finish(obj, name, mat, loc, scale=None):
    obj.name = name
    obj.location = game_to_blender(loc)
    if scale:
        # Scale is authored in game X/Y-up/Z axes; Blender's vertical axis is Z.
        obj.scale = (scale[0], scale[2], scale[1])
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
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=57, depth=.5, location=game_to_blender((0,-.28,-30)))
finish(bpy.context.object, 'Continuous valley floor · flush to game plane', stone, (0,-.28,-30))
box('Central shallow river surface', (0,.022,-48), (8.5,.045,136), water)
# Pebbles sit slightly below the shallow water surface.
for i in range(140):
    x=(random.random()-.5)*7.6
    z=-112+random.random()*128
    ico('Visible riverbed pebble', (x,-.012,z), (random.uniform(.18,.8),.045,random.uniform(.22,.95)), [stone,shadow,moss][i%3], 1)

# Layered cliff walls, waterfall curtains and pools frame the arena.
for side in (-1,1):
    for i in range(6):
        x = side * random.uniform(43,50)
        z = -132 + i*21 + random.uniform(-4,4)
        h = random.uniform(25,42)
        ico('Tall enclosing canyon wall', (x,h*.52,z), (random.uniform(7,13),h,random.uniform(12,19)), stone if i%2 else shadow, 2)
        ico('Moss cap and mineral seam', (x-side*1.8,h*1.14,z+1), (random.uniform(5,9),1.7,random.uniform(7,12)), moss, 1)
    box('Side waterfall sheet', (side*21,11,-97), (10,22,.16), foam)
    cyl('Side waterfall basin', (side*21,.02,-85), 7, .08, water, 32)


# Continuous cliff faces make the play space feel enclosed by the canyon.
box('West canyon wall', (-52,31,-52), (8,62,174), shadow)
box('East canyon wall', (52,31,-52), (8,62,174), shadow)
box('Rear canyon wall', (0,32,-132), (108,64,9), stone)
for side in (-1,1):
    for i in range(25):
        z=-132+i*6.8
        y=8+random.random()*39
        x=side*(47+random.random()*5)
        ledge=box('Layered fractured cliff ledge', (x,y,z), (2.4,random.uniform(.35,1.3),random.uniform(4,9)), stone if i%3 else moss)
        ledge.rotation_euler[1]=(random.random()-.5)*.16

# Two original giant shinobi guardian statues, built from editable primitives.
def guardian(x, mirror):
    z = -76
    box('Statue plinth', (x,1,z), (8,2,7), shadow)
    cyl('Layered pedestal', (x,3,z), 3.8, 2.2, stone, 8)
    cyl('Carved robe torso', (x,7,z), 2.3, 6.5, statue, 8)
    ico('Mask head', (x,12,z), (2.2,2.7,1.9), statue, 2)
    box('Brow ridge', (x,13.1,z+1.65), (3.4,.55,.35), shadow)
    box('Face plate', (x,12,z+1.72), (2.1,1,.28), stone)
    box('Shoulder mantle', (x,10,z), (5.8,2.1,2.4), statue)
    arm = cyl('Left arm', (x-3*mirror,8.2,z), .75, 5.4, statue, 7)
    arm.rotation_euler[1] = math.pi/2 + .3*mirror
    arm = cyl('Right arm', (x+3*mirror,8.2,z), .75, 5.4, statue, 7)
    arm.rotation_euler[1] = math.pi/2 - .3*mirror
    box('Left leg', (x-1.2,2.8,z), (1.3,4.6,1.6), shadow)
    box('Right leg', (x+1.2,2.8,z), (1.3,4.6,1.6), shadow)
    box('Raised hand-seal silhouette', (x+5.6*mirror,16.8,z), (.85,1.0,.7), statue)
    box('Stone finger detail', (x+5.6*mirror,18.0,z+.2), (.18,2.1,.18), statue)
    for side in (-1,1):
        box('Eye rune', (x+side*.52,12.4,z+1.92), (.16,.14,.05), rune)

guardian(-36,1)
guardian(36,-1)

# Different silhouettes make the two founders readable at a distance.
hair_stone = material('Carved hair shadow', (.20,.25,.25), .96, .01)
for i in range(-2,3):
    cone('Hashirama swept-back hair', (36+i*.52,13.5,-77.05-abs(i)*.12), .62, 5.4, hair_stone, 6)
for i in range(11):
    angle=(i/10)*math.pi*1.45-math.pi*.72
    px=math.sin(angle)*2.0
    py=14.0+math.cos(angle)*1.0
    cone('Madara spiked hair', (-36+px,py,-76.35), .58, 3.9, hair_stone, 5)
ico('Madara war fan silhouette', (-40.4,10.8,-77.55), (1.7,1.9,.22), shadow, 1)

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

box('High central waterfall', (0,14,-100), (20,28,.12), foam)
ico('Rear waterfall cliff', (0,15,-110), (25,18,8), shadow, 2)
cyl('Central waterfall pool', (0,.03,-84), 10, .08, water, 48)

# A lighting rig and camera make the .blend immediately inspectable.
world = bpy.data.worlds.new('Final Valley dusk') if not bpy.data.worlds else bpy.data.worlds[0]
bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.025,.045,.08,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .45
bpy.ops.object.light_add(type='AREA', location=game_to_blender((-25,55,10)))
key = bpy.context.object
key.name = 'Warm valley key'
key.data.energy = 5000
key.data.shape = 'DISK'
key.data.size = 45
key.rotation_euler = (math.radians(25),0,math.radians(-25))
bpy.ops.object.light_add(type='AREA', location=game_to_blender((30,25,-70)))
rim = bpy.context.object
rim.name = 'Cool waterfall rim'
rim.data.energy = 3000
rim.data.color = (.25,.65,1)
rim.data.size = 30
rim.rotation_euler = (math.radians(35),0,math.radians(155))
bpy.ops.object.camera_add(location=game_to_blender((105,95,115)))
cam = bpy.context.object
cam.name = 'Final Valley overview'
direction = Vector(game_to_blender((0,8,-38))) - cam.location
cam.rotation_euler = direction.to_track_quat('-Z','Y').to_euler()
cam.data.lens = 42
bpy.context.scene.camera = cam
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 48
scene.view_settings.view_transform = 'AgX'
try:
    scene.view_settings.look = 'AgX - Medium High Contrast'
except Exception:
    pass
scene.render.resolution_x = 1280
scene.render.resolution_y = 720
scene.render.resolution_percentage = 100

# Objects are placed in Blender Z-up coordinates through game_to_blender().
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR,'final_valley.blend'))
bpy.ops.object.select_all(action='SELECT')
bpy.context.view_layer.objects.active = None
bpy.ops.export_scene.gltf(filepath=os.path.join(PUBLIC_ASSET_DIR,'final_valley.glb'), export_format='GLB', export_apply=True, export_yup=True)
print('Saved editable .blend to', OUT_DIR, 'and game-ready GLB to', PUBLIC_ASSET_DIR)
