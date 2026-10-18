#!/usr/bin/env python3
"""Build editable Blender source files and game-ready GLBs for Browser Smash's five flagship arenas."""
import bpy
import math
import os
import random
from pathlib import Path
from mathutils import Matrix

random.seed(731204)
ROOT = Path(__file__).resolve().parents[2]
BLEND_DIR = ROOT / "assets" / "blender" / "arenas"
GLB_DIR = ROOT / "public" / "assets" / "arenas"
BLEND_DIR.mkdir(parents=True, exist_ok=True)
GLB_DIR.mkdir(parents=True, exist_ok=True)

def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)
    for block in list(bpy.data.materials):
        if block.users == 0:
            bpy.data.materials.remove(block)

def mat(name, color, metallic=0.05, roughness=0.58, emission=0):
    if isinstance(color, int):
        color = (((color >> 16) & 255)/255, ((color >> 8) & 255)/255, (color & 255)/255)
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get("Principled BSDF")
    bs.inputs["Base Color"].default_value = (*color, 1)
    bs.inputs["Metallic"].default_value = metallic
    bs.inputs["Roughness"].default_value = roughness
    if emission:
        inp = bs.inputs.get("Emission Color") or bs.inputs.get("Emission")
        if inp:
            ec = color if not isinstance(emission, tuple) else emission
            inp.default_value = (*ec, 1)
        strength = bs.inputs.get("Emission Strength")
        if strength:
            strength.default_value = 1.25
    return m

def coord(pos):
    # Blender is Z-up; author in Three.js world coordinates and convert before GLB export.
    x, y, z = pos
    return (x, -z, y)

def parent_obj(obj, root, pos, rot=0):
    obj.parent = root
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = coord(pos)
    obj.rotation_euler = (0, 0, rot)
    return obj

def box(root, name, pos, size, material, rot=0, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    w, h, d = size
    o.dimensions = (w, d, h)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new("Soft manufactured edges", "BEVEL")
        mod.width = min(bevel, min(size) * .22)
        mod.segments = 2
        try:
            bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception:
            pass
    for face in o.data.polygons:
        face.use_smooth = False
    return parent_obj(o, root, pos, rot)

def sphere(root, name, pos, scale, material, segments=20, rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, radius=1, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    sx, sy, sz = scale
    o.scale = (sx, sz, sy)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(material)
    for face in o.data.polygons:
        face.use_smooth = True
    return parent_obj(o, root, pos)

def cylinder(root, name, pos, radius, height, material, vertices=20, rot=0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    for face in o.data.polygons:
        face.use_smooth = len(o.data.polygons) < 300
    return parent_obj(o, root, pos, rot)

def cone(root, name, pos, radius, height, material, vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=.02, depth=height, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    for face in o.data.polygons:
        face.use_smooth = True
    return parent_obj(o, root, pos)

def torus(root, name, pos, radius, minor, material, rot=0, major_segments=32):
    bpy.ops.mesh.primitive_torus_add(major_segments=major_segments, minor_segments=8, major_radius=radius, minor_radius=minor, location=(0, 0, 0))
    o = bpy.context.object
    o.name = name
    o.data.materials.append(material)
    for face in o.data.polygons:
        face.use_smooth = True
    return parent_obj(o, root, pos, rot)

def root_for(key, label):
    root = bpy.data.objects.new("arena_" + key, None)
    bpy.context.scene.collection.objects.link(root)
    root.empty_display_type = "PLAIN_AXES"
    root.empty_display_size = 2
    root["worldKey"] = key
    root["displayName"] = label
    root["assetVersion"] = "cinematic-arena-kit-v1"
    return root

def build_asgard(root):
    gold = mat("Asgard · royal gold", 0xd7a93f, .82, .23, 0x5f4810)
    pale = mat("Asgard · polished electrum", 0xf4dc84, .86, .19, 0xffd87d)
    marble = mat("Asgard · city marble", 0xb4b5b7, .32, .46)
    stone = mat("Asgard · warm stone", 0x59646e, .26, .62)
    roof = mat("Asgard · bronze roofs", 0x6e4d3a, .62, .35)
    glass = mat("Asgard · bifrost crystal", 0x45d9ff, .32, .2, 0x26bfff)
    glow = mat("Asgard · window light", 0xffdc83, .25, .2, 0xffc85a)
    # Foreground settlement / walkable plaza.
    box(root, "Asgardian town square", (0, -.12, -1), (126, .3, 90), stone)
    box(root, "Golden Bifrost avenue", (0, .05, -40), (12, .18, 96), glass)
    for side in (-1, 1):
        for i in range(7):
            x = side * (19 + (i % 3) * 8)
            z = 27 - i * 10.5
            h = 6 + (i % 4) * 2.1
            w = 7.2 + (i % 3) * 1.6
            box(root, "Asgardian civilian hall", (x, h/2, z), (w, h, w*.92), marble, bevel=.2)
            box(root, "Bronze roof band", (x, h+.15, z), (w+1.3, .34, w+1.3), gold, bevel=.08)
            cone(root, "Norse roof cap", (x, h+2.6, z), w*.68, 4.8, roof, 8)
            box(root, "Lit street entrance", (x, 1.3, z+w*.47), (1.45, 2.6, .15), gold, bevel=.08)
            for win in (-1, 1):
                box(root, "Tall golden window", (x+win*w*.24, h*.62, z+w*.49), (.68, 1.4, .1), glow, bevel=.025)
    for i in range(11):
        z = 29 - i*9.5
        for side in (-1,1):
            x=side*8
            cylinder(root, "Bifrost balustrade pillar", (x, 3.6, z), .7, 7.2, pale, 12)
            cylinder(root, "Pillar capital", (x, 7.5, z), 1.1, .7, gold, 12)
            sphere(root, "Pillar lantern", (x, 8.1, z), (.29,.35,.29), glow, 12, 8)
    cylinder(root, "Civilian plaza fountain", (-14,.22,4), 4.4, .55, marble, 36)
    cylinder(root, "Fountain gilt rim", (-14,.55,4), 3.4, .22, pale, 36)
    sphere(root, "Fountain bifrost globe", (-14,1.42,4), (1.3,1.4,1.3), glass, 24, 16)
    # Enormous distant gold palace with tiered terraces and clustered needle towers.
    box(root, "Royal palace lower citadel", (0,6.5,-150), (168,13,58), gold, bevel=.8)
    box(root, "Royal palace terrace", (0,14.1,-148), (152,3.1,53), pale, bevel=.45)
    box(root, "Royal palace second ward", (0,23,-147), (133,15,47), gold, bevel=.55)
    box(root, "Royal palace upper ward", (0,34,-147), (105,10,39), pale, bevel=.4)
    box(root, "Royal keep", (0,54,-147), (54,36,32), gold, bevel=.6)
    cylinder(root, "Keep drum", (0,74,-147), 17, 10, pale, 40)
    sphere(root, "Keep gold dome", (0,83,-147), (17,12,17), gold, 32, 20)
    cone(root, "Central royal needle", (0,108,-147), 4.2, 40, pale, 8)
    for side in (-1,1):
        for i in range(6):
            x=side*(28+i*17.5)
            z=-151+(i%2)*5
            h=42+(i%3)*16
            w=12 if i==0 else 9.2
            box(root, "Palace tower shaft", (x,h/2+16,z), (w,h,w), gold, bevel=.35)
            box(root, "Tower capital", (x,h+17,z), (w+3,2.2,w+3), pale, bevel=.2)
            cylinder(root, "Gilded tower crown", (x,h+20,z), w*.57, 4, pale, 20)
            sphere(root, "Tower onion dome", (x,h+24,z), (w*.53,w*.52,w*.53), gold, 20, 12)
            cone(root, "Tower lance spire", (x,h+35,z), w*.27, 20+(i%2)*7, pale, 8)
            for band in range(4):
                torus(root, "Tower gold belt", (x,18+band*h/4.6,z), w*.62, .14, pale, major_segments=24)
            for row in range(4):
                yy=21+row*(h/5.2)
                box(root, "Tower luminous window", (x,yy,z+w*.505), (w*.18,2.8,.12), glass, bevel=.025)
                box(root, "Tower luminous window", (x,yy,z-w*.505), (w*.18,2.8,.12), glass, bevel=.025)
    for i in range(11):
        x=-45+i*9
        cylinder(root, "Palace colonnade shaft", (x,7.4,-116), .48, 13.8, pale, 12)
        cylinder(root, "Palace colonnade base", (x,.65,-116), .9, 1.1, gold, 12)
        cylinder(root, "Palace colonnade capital", (x,14.3,-116), .95, .8, pale, 12)
    for x in (-60,-40,-20,0,20,40,60):
        box(root, "Royal bridge deck", (x*.45,2.2,-93), (18,.35,5.5), gold, bevel=.15)
    root["landmark"]="monumental golden palace and inhabited Asgardian plaza"

def build_helicarrier(root):
    hull = mat("Helicarrier · blue-grey titanium", 0x3c5066, .82, .29)
    deck = mat("Helicarrier · flight deck", 0x293744, .48, .44)
    edge = mat("Helicarrier · brushed rails", 0x8198ad, .78, .24)
    runway = mat("Helicarrier · deck markings", 0xdce4e9, .36, .36)
    teal = mat("Helicarrier · navigation lights", 0x53dfff, .25, .2, 0x32bfff)
    window = mat("Tower · cold glass", 0x6fa6c8, .68, .16, 0x173149)
    warm = mat("Tower · interior lighting", 0xffbd6a, .2, .25, 0xff9138)
    city = mat("New York · tower glass", 0x283d55, .63, .27)
    cityLight = mat("New York · office windows", 0xffd9a0, .15, .3, 0xffb35b)
    cityBlue = mat("New York · blue glass", 0x47728e, .72, .24)
    # Broad, continuous carrier flight deck above the clouds.
    box(root, "Helicarrier main deck", (0,0,-24), (150,.6,108), deck, bevel=.7)
    box(root, "Runway center line", (0,.34,-24), (2.2,.025,91), runway)
    for side in (-1,1):
        box(root, "Runway shoulder", (side*15,.34,-24), (.16,.025,94), teal)
        for i in range(17):
            box(root, "Runway dash", (side*4,.36,-68+i*5.5), (1.2,.025,2.2), runway)
        box(root, "Deck safety rail", (side*73,.95,-24), (.6,1.2,106), edge, bevel=.12)
    # Helicopter pad and high-tech elevator pavilion.
    cylinder(root, "Primary landing pad", (-24,.43,-24), 11.5, .12, hull, 64)
    torus(root, "Landing pad perimeter", (-24,.52,-24), 9.7, .15, runway, major_segments=64)
    box(root, "Helipad H center", (-24,.55,-24), (.75,.035,5.0), runway)
    box(root, "Helipad H crossbar", (-24,.55,-24), (4.2,.035,.65), runway)
    for i in range(24):
        a=2*math.pi*i/24
        sphere(root, "Helipad perimeter beacon", (-24+math.cos(a)*11.8,.56,-24+math.sin(a)*11.8), (.16,.13,.16), teal, 10, 6)
    # Open, glass-fronted lounge/elevator pavilion; open side keeps traversal easy.
    box(root, "Stark penthouse lower floor", (36,.45,-24), (43,.4,37), hull, bevel=.25)
    box(root, "Lounge carpet", (36,.68,-27), (20,.04,14), mat("Penthouse · midnight carpet",0x26394b,.04,.92))
    for side in (-1,1):
        box(root, "Penthouse glass side wall", (36+side*21,7.2,-24), (.28,13,36), window)
        for row in range(5):
            box(root, "Window mullion", (36+side*21,2.5+row*2.45,-24), (.42,.065,36), edge)
    box(root, "Penthouse rear glass", (36,7.2,-42.2), (42,13,.25), window)
    box(root, "Penthouse ceiling lintel", (36,14,-42.2), (43,.5,.5), edge)
    # Famous visible glass elevator shaft, floor-to-roof with split doors and illuminated guide rails.
    for x in (18,22):
        for z in (-27,-23):
            box(root, "Elevator structural upright", (x,5.2,z), (.18,10.4,.18), edge)
    for y in (.35,10.4):
        box(root, "Elevator cross brace", (20,y,-25), (4.2,.2,.2), edge)
    for x in (19.25,20.75):
        box(root, "Elevator split door", (x,4.9,-22.92), (1.4,9.2,.1), window)
        box(root, "Elevator light rail", (x,4.9,-22.82), (.06,9.25,.07), teal)
    box(root, "Elevator canopy", (20,10.9,-25), (5.0,.28,5), hull)
    # Underbody has an unmistakable long flattened carrier hull and turbine pods below the deck.
    box(root, "Helicarrier underside keel", (0,-5.2,-24), (113,9.4,54), hull, bevel=2.4)
    box(root, "Keel luminous strip", (0,-1.1,-24), (87,.18,7), teal)
    for side in (-1,1):
        box(root, "Carrier wing", (side*59,-4,-24), (29,4.3,24), edge, bevel=2.0)
        for zoff in (-28,28):
            x=side*62
            cylinder(root, "Turbine cowling", (x,-8.3,-24+zoff), 4.0, 5.0, hull, 32)
            torus(root, "Turbine rim light", (x,-5.5,-24+zoff), 3.0, .25, teal, major_segments=32)
    for i in range(29):
        x=-65+i*4.65
        box(root, "Underbody service panel", (x,-4.6,-24), (2.5,2.0,.12), edge)
        box(root, "Deck edge running light", (x,.38,-77), (.17,.13,.14), teal)
    # New York far below: layered skyline, varied silhouettes, rooftop crowns and hundreds of window bands.
    for i in range(46):
        x=-166+i*7.35
        z=-127-(i%7)*10.5
        h=15+((i*19)%49)
        w=3.3+(i%4)*1.2
        d=3.4+(i%3)*1.1
        facade=cityBlue if i%3==0 else city
        box(root, "Manhattan skyscraper", (x,h/2-22,z), (w,h,d), facade, bevel=.12)
        for row in range(1,max(2,int(h/3.4))):
            yy=-22+row*3.1
            if yy>h/2-18: break
            for side in (-1,1):
                box(root, "Office window band", (x+side*w*.29,yy,z+d*.51), (.16,.68,.055), cityLight if (i+row)%4 else teal)
        if i%4==0:
            cone(root, "Skyscraper spire", (x,h-21+4,z), .65, 8, edge, 6)
    # Tower cluster rises well beyond the roof line to make height obvious.
    for i,(x,z,h,w) in enumerate([(-22,-103,63,8),(0,-118,82,10),(19,-110,51,7),(39,-135,43,6)]):
        box(root, "Manhattan landmark tower", (x,h/2-20,z), (w,h,w), window, bevel=.25)
        for row in range(6):
            box(root, "Landmark glass band", (x,h*.1+row*h*.13-20,z+w*.51), (w*.7,.12,.06), warm if row%3==0 else teal)
        cone(root, "Landmark spire", (x,h-20+6,z), .8, 12, edge, 8)
    root["landmark"]="airborne Helicarrier deck, working-scale elevator, open lounge, and Manhattan skyline"

def build_deathstar(root):
    hull=mat("Death Star · gunmetal wall panels",0x48515e,.83,.31)
    dark=mat("Death Star · shadow insets",0x1c2430,.62,.4)
    floor=mat("Death Star · brushed deck",0x343d49,.74,.33)
    trim=mat("Death Star · steel edge rails",0x8a9aaa,.8,.25)
    light=mat("Death Star · cool panel light",0x9eddf7,.18,.2,0x5abde9)
    red=mat("Death Star · Imperial status light",0xf13d47,.2,.22,0xb91827)
    star=mat("Death Star · viewport",0x030814,.05,.12)
    # Room 1: Imperial briefing chamber, conference table.
    box(root,"Imperial briefing floor",(-38,-.15,-31),(35,.3,34),floor)
    box(root,"Briefing room ceiling",(-38,10,-31),(35,.28,34),dark)
    for side in (-1,1):
        x=-38+side*17.2
        # Side walls keep the north/south doorway gap clear.
        for z in (-43.9,-19.1):
            box(root,"Briefing room side wall",(x,5,z),(0.36,10,9.5),hull)
        for i in range(8):
            z=-43+i*3.4
            box(root,"Briefing wall recess",(x-side*.22,5,z),(.09,4.2,1.8),dark)
            box(root,"Briefing blue status strip",(x-side*.28,6.1,z),(.05,.08,1.3),light)
    for side in (-1,1):
        z=-31+side*16.7
        box(root,"Briefing end wall",(-38,5,z),(35,10,.38),hull)
        for i in range(9):
            x=-54+i*4
            box(root,"Briefing end-wall light",(x,6,z-side*.23),(1.8,3.7,.06),light)
    cylinder(root,"Holographic briefing table pedestal",(-38,.46,-31),3.4,.8,hull,40)
    cylinder(root,"Briefing table holo ring",(-38,.92,-31),7.4,.2,trim,48)
    cylinder(root,"Briefing table glass",(-38,1.04,-31),6.9,.12,dark,48)
    sphere(root,"Hologram tactical globe",(-38,1.75,-31),(1.0,1.2,1.0),light,24,16)
    for i in range(9):
        a=i*math.pi*2/9
        x=-38+math.cos(a)*9.4;z=-31+math.sin(a)*9.4
        cylinder(root,"Imperial briefing chair base",(x,.25,z),.52,.35,hull,12)
        box(root,"Imperial briefing chair",(x,.8,z),(1.15,1.2,1.1),dark,bevel=.12)
        box(root,"Imperial briefing chair back",(x,1.5,z-.4),(1.1,1.2,.22),hull,bevel=.08)
    # Room 2: Emperor's throne room, ominous viewport to space.
    box(root,"Emperor throne floor",(39,-.15,-32),(37,.3,38),floor)
    box(root,"Throne chamber ceiling",(39,10,-32),(37,.28,38),dark)
    for side in (-1,1):
        x=39+side*18.2
        for z in (-42,-22):
            box(root,"Throne room side wall",(x,5,z),(0.35,10,17),hull)
        for z in range(-45,-16,4):
            box(root,"Throne blue wall slit",(x-side*.21,5,z),(.06,5,1.4),light)
    box(root,"Throne viewport",(39,8.5,-51),(28,17,.2),star)
    for i in range(112):
        x=39+(random.random()-.5)*26
        y=1+random.random()*15
        sphere(root,"Viewport star",(x,y,-50.82),(.045,.045,.045),light,8,6)
    torus(root,"Imperial viewport frame",(39,8.5,-50.6),8.8,.23,trim,major_segments=64)
    # Raised black throne and split dais.
    box(root,"Throne dais lower step",(39,.25,-40),(17,.5,9),hull,bevel=.18)
    box(root,"Throne dais upper step",(39,.65,-42),(10,.35,5.5),trim,bevel=.1)
    box(root,"Emperor throne seat",(39,1.15,-43.1),(5.5,1.0,3.0),dark,bevel=.18)
    box(root,"Emperor throne back",(39,4.4,-44.2),(5.4,6.5,.65),hull,bevel=.18)
    for side in (-1,1):
        x=39+side*3.35
        box(root,"Throne armrest",(x,1.8,-43.0),(1.0,2.0,3.3),trim,bevel=.12)
        box(root,"Throne red-lit arm cap",(x,2.85,-43.0),(.8,.12,2.7),red)
    # Corridor joins both rooms, with clear openings in the end walls.
    box(root,"Death Star corridor deck",(0,-.02,-31),(40,.22,7.0),floor)
    for side in (-1,1):
        z=-31+side*3.55
        box(root,"Corridor continuous wall",(0,4.6,z),(40,9.2,.32),hull)
        for i in range(15):
            x=-19+i*2.7
            box(root,"Corridor wall panel",(x,4.7,z-side*.19),(1.8,6.8,.08),dark)
            box(root,"Corridor illuminated stripe",(x,5.9,z-side*.26),(.12,4.1,.055),light)
            box(root,"Corridor red indicator",(x,7.0,z-side*.27),(.36,.12,.055),red if i%4==0 else light)
    for x in (-19.6,19.6):
        box(root,"Corridor bulkhead lintel",(x,8,-31),(1.2,1.0,8.2),trim)
    root["landmark"]="two furnished Imperial rooms joined by a walkable corridor"

def build_hogwarts(root):
    wall=mat("Great Hall · old stone",0x56565d,.04,.92)
    dark=mat("Great Hall · carved stone recess",0x33323c,.06,.96)
    stoneLight=mat("Great Hall · worn stone edge",0x89817b,.08,.86)
    wood=mat("Great Hall · old oak",0x4b3529,.03,.88)
    gold=mat("Great Hall · aged brass",0xb29a64,.66,.3)
    candleWax=mat("Great Hall · candle wax",0xe9dfc6,.02,.52)
    flame=mat("Great Hall · candle flame",0xffca64,.02,.25,0xffa63b)
    blue=mat("Great Hall · enchanted blue light",0x83b8e4,.08,.3,0x3a6ca6)
    house=[mat("House banner red",0x941f2b,.04,.87),mat("House banner blue",0x203f72,.04,.87),mat("House banner yellow",0xc5a53a,.04,.87),mat("House banner green",0x2d6647,.04,.87)]
    # Nave and long, monumental side walls.
    box(root,"Great Hall flagstone floor",(0,-.24,-32),(48,.42,94),wall)
    box(root,"Great Hall raised dais",(0,.12,-78),(29,.36,8),stoneLight)
    for side in (-1,1):
        x=side*22.7
        box(root,"Great Hall side wall",(x,8,-32),(.6,16,92),wall)
        for i in range(9):
            z=-76+i*11
            box(root,"Carved wall pier",(x-side*.32,8,z),(1.2,16,2.4),stoneLight)
            box(root,"Pier capital",(x-side*.42,15.6,z),(2.0,.9,3.1),gold,bevel=.08)
            box(root,"Tall lancet window",(x-side*.35,9.4,z+2.0),(.1,7.5,3.5),blue)
            box(root,"Window stone mullion",(x-side*.43,9.4,z+2.0),(.16,8.3,.22),stoneLight)
            for level in (6.1,8.4,10.7,13.0):
                box(root,"Window cross bar",(x-side*.44,level,z+2.0),(.18,.13,3.45),gold)
    # Repeated Gothic ribs across the ceiling.
    for i in range(9):
        z=-76+i*11
        for side in (-1,1):
            beam=box(root,"Gothic arch rib",(side*10.5,17,z),(1.05,1.0,28),stoneLight,rot=side*.32,bevel=.12)
        box(root,"Gothic arch keystone",(0,20,z),(3.2,1.4,2.0),gold,bevel=.16)
        box(root,"Vault crossbeam",(0,21.1,z),(38,1.15,1.7),wall,bevel=.12)
    box(root,"Great Hall upper cornice",(0,19,-32),(40,1.2,2.0),stoneLight)
    # Floating candlelight and house banners overhead.
    for i in range(64):
        x=(random.random()-.5)*34
        z=-77+random.random()*88
        y=10+random.random()*7
        cylinder(root,"Suspended candle", (x,y,z),.055,.62,candleWax,10)
        sphere(root,"Candle brass cup",(x,y-.33,z),(.12,.09,.12),gold,10,6)
        sphere(root,"Candle flame",(x,y+.39,z),(.075,.14,.075),flame,10,8)
    for i in range(4):
        x=-15+i*10
        z=-72+(i%2)*20
        box(root,"Four Houses banner",(x,12,z),(3.3,7.6,.22),house[i])
        box(root,"Banner gilt rod",(x,16.1,z),(3.7,.13,.2),gold)
        cone(root,"Banner point",(x,7.8,z),.22,1.2,gold,4)
    # Four rows of table-side lamps emphasize the long, central nave.
    for z in (-62,-45,-28,-11):
        for x in (-14,-5,5,14):
            cylinder(root,"Table candle", (x,2.3,z),.06,.45,candleWax,10)
            sphere(root,"Table candle flame",(x,2.58,z),(.06,.1,.06),flame,8,6)
    # Enchanted sky ceiling: dark dome, constellations and a moon-like lantern.
    sky=mat("Great Hall · enchanted night ceiling",0x10172d,.02,.45,0x060b20)
    sphere(root,"Enchanted sky dome",(0,20,-32),(28,10,52),sky,40,22)
    for i in range(180):
        x=(random.random()-.5)*47
        z=-78+random.random()*92
        y=19+random.random()*4
        sphere(root,"Enchanted ceiling star",(x,y,z),(.045,.045,.045),blue,8,6)
    sphere(root,"Enchanted ceiling moon",(0,23,-70),(1.2,1.2,1.2),flame,24,14)
    root["landmark"]="Gothic Great Hall nave, house banners, candlelight and enchanted sky"

def build_tournament(root):
    tile=mat("Tournament · warm limestone",0xe7ddc8,.04,.83)
    tileShade=mat("Tournament · tiled joints",0xafa18d,.04,.92)
    red=mat("Tournament · vermilion rails",0x912b24,.2,.48)
    redLight=mat("Tournament · lacquer highlights",0xb34a36,.22,.4)
    wood=mat("Tournament · dark timber",0x523a2b,.02,.9)
    jade=mat("Tournament · jade roof",0x2c5544,.45,.32)
    jadeLight=mat("Tournament · glazed jade edge",0x5f8c69,.38,.3)
    brass=mat("Tournament · tournament gold",0xd8b85b,.68,.27)
    crowd=[mat("Spectator tunic "+str(i),c,.03,.9) for i,c in enumerate((0x417a99,0xb24a3a,0xe1bd6e,0x426747,0x8672a5,0xd5d2c7))]
    skin=[mat("Spectator skin "+str(i),c,.02,.92) for i,c in enumerate((0xd7aa8c,0x8c624a,0xe6c6a8,0xb98b68))]
    box(root,"Tournament arena foundation",(0,-.35,-12),(40,.7,35),tileShade)
    box(root,"Tournament ring tiled surface",(0,.06,-12),(37,.12,32),tile)
    # Raised lacquer border and a 3D seam grid.
    for x in (-18.2,18.2):
        box(root,"Tournament ring side lacquer",(x,.18,-12),(.35,.18,31),red)
    for z in (-27.6,3.6):
        box(root,"Tournament ring end lacquer",(0,.18,z),(36.7,.18,.35),red)
    for x in range(-16,17,4):
        box(root,"Ring tile seam",(x,.131,-12),(.035,.012,29.9),tileShade)
    for z in range(-25,3,4):
        box(root,"Ring tile seam",(0,.132,z),(35.5,.012,.035),tileShade)
    # Traditional tournament gate beyond the north edge.
    for x in (-17,-8.5,0,8.5,17):
        box(root,"Tournament gate pillar",(x,4.1,-43),(.95,8.2,.95),red,bevel=.12)
        box(root,"Tournament gate foot",(x,.65,-43),(1.8,1.0,1.8),wood,bevel=.12)
        box(root,"Pillar gilt collar",(x,7.8,-43),(1.5,.35,1.5),brass,bevel=.07)
    box(root,"Tournament gate lintel",(0,8.5,-43),(37,1.1,6.0),wood,bevel=.2)
    box(root,"Jade gate top",(0,9.2,-43),(40,.55,7),jade,bevel=.15)
    box(root,"Glazed jade roof",(0,10.5,-43),(36,2.3,6.5),jadeLight,bevel=.3)
    for side in (-1,1):
        cone(root,"Gate roof tip",(side*20,10.2,-43),.65,2.3,brass,4)
    # Grandstands with seats and varied spectators; repeated small meshes keep the crowd cheap.
    for side in (-1,1):
        for row in range(4):
            x=side*(22.3+row*2.0)
            h=1.5+row*.65
            box(root,"Tournament grandstand tier",(x,h*.25,-16),(2.3,h,44),tileShade,bevel=.08)
            box(root,"Wood bench line",(x,h*.55,-16),(2.36,.2,43),wood)
            for seat in range(24):
                z=-36+seat*1.72
                top=h*.52
                box(root,"Audience torso",(x,top+.34,z),(.4,.62,.31),crowd[(seat+row+(1 if side>0 else 0))%len(crowd)])
                sphere(root,"Audience head",(x,top+.79,z),(.18,.19,.18),skin[(seat+row)%len(skin)],10,6)
    # Island mountains beyond the stands.
    mountain=mat("Tournament · island greenery",0x536f50,.02,.97)
    for i in range(25):
        x=-165+i*13.5
        z=-117-(i%5)*14
        h=24+((i*17)%43)
        cone(root,"Papaya island mountain",(x,h*.4,z),13+(i%4)*2.5,h,mountain,8)
    sea=mat("Tournament · sea",0x367e9d,.24,.42)
    box(root,"Tropical sea horizon",(0,-3.0,-165),(420,.8,185),sea)
    root["landmark"]="raised tournament ring, traditional gate, spectators and island horizon"

BUILDERS = {
    "asgard": ("Asgard Golden City", build_asgard),
    "helicarrier": ("Helicarrier above Manhattan", build_helicarrier),
    "deathstar": ("Death Star Briefing + Throne Rooms", build_deathstar),
    "hogwarts": ("Hogwarts Great Hall", build_hogwarts),
    "tournament": ("World Martial Arts Tournament", build_tournament),
}

def export_asset(key, label, builder):
    clear_scene()
    root = root_for(key, label)
    builder(root)
    # Keep the full editable source scene for this specific arena.
    blend_path = BLEND_DIR / (key + ".blend")
    glb_path = GLB_DIR / (key + ".glb")
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    bpy.ops.object.select_all(action="DESELECT")
    descendants = [root] + list(root.children_recursive)
    for obj in descendants:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_extras=True,
        export_cameras=False,
        export_lights=False
    )
    print(f"Built arena_{key}: {len(descendants)} Blender objects")
    print(f"  Blender: {blend_path} ({blend_path.stat().st_size/1024/1024:.2f} MiB)")
    print(f"  GLB: {glb_path} ({glb_path.stat().st_size/1024/1024:.2f} MiB)")

def main():
    for key, (label, builder) in BUILDERS.items():
        export_asset(key, label, builder)
    print(f"Built {len(BUILDERS)} cinematic arena assets")

if __name__ == "__main__":
    main()
