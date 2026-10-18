#!/usr/bin/env python3
"""Browser Smash articulated character library.
Builds editable, original Blender character meshes and a GLB prefab library.
The characters use articulated transform joints so the browser combat code can animate
limbs directly. They are stylized production meshes (not ripped meshes or scanned assets).
"""
import bpy
import math
from pathlib import Path
from mathutils import Matrix

ROOT = Path(__file__).resolve().parents[2]
BLEND_PATH = ROOT / "assets" / "blender" / "character_models.blend"
GLB_PATH = ROOT / "public" / "assets" / "character_models.glb"

# keys match the game's normalized identity keys exactly.
CHARACTERS = {
    "superman": ("Superman", "warrior", "superman", 0x1a55aa, 0xc42b3a, 0xf4c94f, 0xc99b7f, 0x111822, 0x18191c, 1.08),
    "iron_man_tony_stark": ("Iron Man", "cyborg", "ironman", 0x901d25, 0xc32d28, 0xe9b94a, 0xc99d87, 0x121722, 0x8d2025, 1.00),
    "hulk_bruce_banner": ("Hulk", "brawler", "hulk", 0x317d3b, 0x522747, 0x87dc59, 0x388c48, 0x171a21, 0x1c261c, 1.32),
    "green_lantern_hal_jordan": ("Green Lantern", "mage", "lantern", 0x123d32, 0x205c46, 0x65f2a5, 0xc89a7d, 0x101821, 0x17261f, 1.00),
    "wonder_woman": ("Wonder Woman", "warrior", "wonderwoman", 0x8b2029, 0x173b7a, 0xf0c44a, 0xc99d82, 0x151820, 0x20171a, 1.02),
    "professor_x_charles_xavier": ("Professor X", "mage", "professorx", 0x455565, 0x5e7180, 0x80d9ef, 0xc7a18b, 0x141923, 0x555a60, 0.90),
    "the_flash_barry_allen": ("The Flash", "ninja", "flash", 0x9e2027, 0xc62f32, 0xf2c63c, 0xc89b7e, 0x10141c, 0x3c1418, 1.00),
    "aquaman": ("Aquaman", "warrior", "aquaman", 0x1d695b, 0xb77d27, 0x54d5c7, 0xc89b7b, 0x10181b, 0x9b692e, 1.05),
    "doctor_strange": ("Doctor Strange", "mage", "strange", 0x31233f, 0x6f2a2d, 0xd9aa49, 0xd0aa91, 0x11121b, 0x4a2924, 1.00),
    "arnold_schwarzenegger": ("T-800", "cyborg", "terminator", 0x20262d, 0x404a54, 0xb8c7d0, 0xc59b81, 0x111319, 0x272a2d, 1.10),
    "goku": ("Goku", "warrior", "goku", 0xe56e21, 0x275ba5, 0xf6c442, 0xd2a27f, 0x11131b, 0x17171b, 1.04),
    "naruto_uzumaki": ("Naruto", "ninja", "naruto", 0xe5791f, 0x2a4b75, 0x3cb8ff, 0xd3a17f, 0x11151c, 0xe7b342, 1.00),
    "vegeta": ("Vegeta", "warrior", "vegeta", 0x1a355c, 0xd5dce5, 0x4c89d5, 0xc49a7a, 0x10151c, 0x18181e, 1.02),
    "saitama": ("Saitama", "brawler", "saitama", 0xd9c5a4, 0xe5bd37, 0xbf2d35, 0xe4c2a9, 0x16171c, 0xd2c9b8, 1.02),
    "l_death_note_style": ("L", "ninja", "l", 0x272b34, 0xebe7df, 0x64758b, 0xd0b19a, 0x171821, 0x191820, 0.96),
    "all_might": ("All Might", "brawler", "allmight", 0x1c376a, 0xd6aa31, 0xc3313c, 0xd2aa88, 0x12151e, 0xf1c34a, 1.22),
    "edward_elric": ("Edward Elric", "mage", "edward", 0x9a2632, 0x242a34, 0xcbb68c, 0xd4ad8c, 0x13161d, 0xf0c66a, 0.98),
    "levi_ackerman": ("Levi Ackerman", "ninja", "levi", 0x243849, 0x516e4b, 0xc4d0d1, 0xcaa187, 0x13171e, 0x262129, 0.96),
    "mario": ("Mario", "warrior", "mario", 0x24519b, 0xd72d2b, 0xf1c64c, 0xe0b397, 0x171a21, 0x6b3325, 0.92),
    "luigi": ("Luigi", "ninja", "luigi", 0x285b46, 0x3565a5, 0xead147, 0xe0b397, 0x171a21, 0x594031, 0.93),
    "kratos": ("Kratos", "brawler", "kratos", 0x33363d, 0x625044, 0xb52c35, 0xe2dbcf, 0x12151b, 0x242329, 1.18),
    "link": ("Link", "ninja", "link", 0x387741, 0x326645, 0xd5bb69, 0xe0c2a0, 0x151922, 0xe3c28a, 0.98),
    "master_chief": ("Master Chief", "cyborg", "chief", 0x435b3b, 0x697951, 0xd4be68, 0x8d9b81, 0x151d19, 0x3b4c32, 1.16),
    "thor": ("Thor", "warrior", "thor", 0x1c2e47, 0x8597aa, 0xefd075, 0xd6b194, 0x121822, 0xd7b16f, 1.10),
    "aang": ("Aang", "mage", "aang", 0xb9783b, 0xd7b073, 0x57d7ff, 0xd7ad8b, 0x121720, 0xb87943, 0.92),
    "madara_uchiha": ("Madara Uchiha", "warrior", "madara", 0x4a2b32, 0x7c3f3c, 0xc4a06c, 0xc79c80, 0x15141a, 0x18181e, 1.20),
    "hashirama_senju": ("Hashirama Senju", "warrior", "hashirama", 0x2f5945, 0x594232, 0x99bc89, 0xc89c7d, 0x141a19, 0x191a1c, 1.20),
    "lord_voldemort": ("Lord Voldemort", "mage", "voldemort", 0x15161b, 0x2c3038, 0x9fa7b2, 0xd8d5cc, 0x15141a, 0x141419, 1.02),
    "sasuke_uchiha": ("Sasuke Uchiha", "ninja", "sasuke", 0x18223b, 0x384359, 0x5d9be3, 0xc79c82, 0x15141a, 0x15161d, 1.00),
    "edna_mode": ("Edna Mode", "cyborg", "edna", 0x14151a, 0x2e3238, 0xece8e2, 0xe0bba5, 0x13151a, 0x161519, 0.82),
    "captain_jack_sparrow": ("Captain Jack Sparrow", "ninja", "pirate", 0x5d4534, 0x2e3038, 0xb99555, 0xcda47f, 0x171820, 0x352a26, 0.99),
    "spider_man": ("Spider-Man", "ninja", "spiderman", 0xc62b33, 0x164c91, 0xe8524d, 0xbfc7d3, 0x10141b, 0x17202d, 1.00),
    # Reserved DLC models: generated now so the editable Blender archive is ready when DLC is enabled.
    "the_rock": ("The Rock", "brawler", "blackadam", 0x17191f, 0x252a33, 0xe1b94e, 0x875f4c, 0x111318, 0x17171a, 1.08),
    "samuel_l_jackson": ("Samuel L. Jackson", "warrior", "samuel", 0x151922, 0x242c38, 0x5d86bc, 0x6b4a38, 0x10131b, 0x151519, 1.00),
    "bruce_lee": ("Bruce Lee", "ninja", "brucelee", 0xe9c129, 0x17191d, 0xe9c129, 0xd0a17e, 0x111317, 0x121212, 0.96),
    "jean_claude_van_damme": ("Jean-Claude Van Damme", "brawler", "vandamme", 0x6c1d2a, 0x272a33, 0xcbb18b, 0xc99b7e, 0x13151a, 0x15151a, 1.00),
    "lucy_liu": ("Lucy Liu", "ninja", "lucyliu", 0xe3ddd2, 0x232832, 0xb92d39, 0xe0b398, 0x14171d, 0x121318, 0.96),
    "sigourney_weaver": ("Sigourney Weaver", "cyborg", "sigourney", 0x4c5a42, 0x28352e, 0xb2a16b, 0xc99d84, 0x12171a, 0x45372b, 1.00),
    "keanu_reeves": ("Keanu Reeves", "ninja", "keanu", 0x1d3047, 0x222832, 0xc82f3d, 0xc9a086, 0x11151b, 0x111217, 1.02),
    "burt_reynolds": ("Burt Reynolds", "brawler", "burt", 0x9a2930, 0xe4d9c8, 0xcbb68a, 0xd1a47f, 0x13151a, 0x60422c, 1.02),
    "grace_jones": ("Grace Jones", "mage", "grace", 0x17171d, 0x31313b, 0xc6a34f, 0x9e6d56, 0x101218, 0x151519, 1.00),
    "wolverine_logan": ("Wolverine (Logan)", "brawler", "wolverine", 0x174b91, 0xe2ba2c, 0xefd247, 0xc69a7a, 0x15171d, 0x33251f, 1.06),
    "roronoa_zoro": ("Roronoa Zoro", "warrior", "zoro", 0x2d694c, 0x29343a, 0x9bb6a2, 0xc89c7f, 0x11151a, 0x2a3328, 1.03),
    "jotaro_kujo": ("Jotaro Kujo", "brawler", "jotaro", 0x1d293a, 0x243e59, 0xd7b95d, 0xc99c80, 0x12151b, 0x151519, 1.04),
    "solid_snake": ("Solid Snake", "cyborg", "snake", 0x4a6148, 0x3c5144, 0x9da8a0, 0xc7a087, 0x151a18, 0x272c25, 1.02),
    "geralt_of_rivia": ("Geralt of Rivia", "warrior", "geralt", 0x343b42, 0x6c7379, 0xd8e0e6, 0xd5b18e, 0x11151b, 0xd1d3cf, 1.03),
    "lara_croft": ("Lara Croft", "ninja", "lara", 0x4b6a60, 0x513d2c, 0xd0b17d, 0xcba184, 0x171a20, 0x3e2920, 0.98),
    "sephiroth": ("Sephiroth", "warrior", "sephiroth", 0x222733, 0x343a46, 0xbac7d8, 0xc9a187, 0x12151d, 0xd1d5df, 1.12),
    "doom_slayer": ("Doom Slayer", "cyborg", "doom", 0x315b45, 0x5d6b54, 0xff713d, 0x9a9d8c, 0x11171a, 0x222a22, 1.18),
    "shrek": ("Shrek", "brawler", "shrek", 0x548f37, 0x7d8c42, 0x9bcf5a, 0x63a344, 0x24251a, 0x344e24, 1.18),
    "aladdin": ("Aladdin", "ninja", "aladdin", 0x2e5996, 0x8a2b2d, 0xf0c55d, 0xd5a37f, 0x14171e, 0x292126, 0.96),
    "ariel": ("Ariel", "mage", "ariel", 0x1b6c58, 0x2d9b7b, 0x75e0d1, 0xe2b99b, 0x14181e, 0xd84b3f, 0.98),
    "ursula": ("Ursula", "mage", "ursula", 0x482d56, 0x222333, 0x9e5cae, 0x9a6c82, 0x12131b, 0x17141b, 1.12),
    "sesshomaru": ("Sesshomaru", "warrior", "sesshomaru", 0xe5e2d9, 0x3b494c, 0xb6d5a5, 0xd4b59a, 0x141820, 0xe4e3de, 1.06),
    "norman_bates": ("Norman Bates", "ninja", "norman", 0x4b6c4f, 0x4b362a, 0xc9c6a8, 0xd1a78a, 0x17191b, 0x443228, 1.00),
    "han_solo": ("Han Solo", "warrior", "hansolo", 0x403a34, 0x26272b, 0xc8b18a, 0xc99f83, 0x13151a, 0x3b2d25, 1.02),
    "indiana_jones": ("Indiana Jones", "warrior", "indiana", 0x65503a, 0x44332b, 0xd3b56f, 0xc89b7c, 0x14171d, 0x392d25, 1.04),

}

# Principled materials are shared across all prefabs to reduce the final GLB.
_materials = {}
def mat(name, hex_color, metallic=0.05, roughness=0.55, emission=0, coat=0.0, backface=False):
    key=(name,hex_color,metallic,roughness,emission,coat,backface)
    if key in _materials: return _materials[key]
    c=((hex_color>>16&255)/255,(hex_color>>8&255)/255,(hex_color&255)/255,1)
    m=bpy.data.materials.new(name)
    m.diffuse_color=c
    m.use_nodes=True
    bsdf=m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value=c
    bsdf.inputs["Metallic"].default_value=metallic
    bsdf.inputs["Roughness"].default_value=roughness
    coat_input=bsdf.inputs.get("Coat Weight") or bsdf.inputs.get("Clearcoat")
    if coat_input is not None: coat_input.default_value=coat
    emission_input=bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
    if emission_input is not None and emission:
        ec=((emission>>16&255)/255,(emission>>8&255)/255,(emission&255)/255,1)
        emission_input.default_value=ec
    strength=bsdf.inputs.get("Emission Strength")
    if strength is not None and emission: strength.default_value=1.4
    m.use_backface_culling=not backface
    _materials[key]=m
    return m

def as_material(value, label="Character Detail"):
    if isinstance(value, int):
        return mat(label + " " + format(value, "06x"), value, .22, .42)
    return value

def link_local(obj, parent, loc=(0,0,0), rot=(0,0,0), scale=(1,1,1)):
    obj.parent=parent
    obj.matrix_parent_inverse=Matrix.Identity(4)
    obj.location=loc
    obj.rotation_euler=rot
    obj.scale=scale
    return obj

def bake(obj, bevel=0.0, smooth=False):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel>0:
        mod=obj.modifiers.new("Manufactured edge highlights","BEVEL")
        mod.width=bevel
        mod.segments=3
        mod.affect='EDGES' if hasattr(mod,'affect') else None
        mod.profile=.5
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if smooth:
        for poly in obj.data.polygons: poly.use_smooth=True
    return obj

def cube(parent,name,loc,size,material,rot=(0,0,0),bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0))
    o=bpy.context.object
    o.name=name
    o.dimensions=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel>0:
        mod=o.modifiers.new("Rounded armor seam","BEVEL");mod.width=bevel;mod.segments=3
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception: pass
    o.data.materials.append(as_material(material, name))
    return link_local(o,parent,loc,rot)

def sphere(parent,name,loc,size,material,segments=20,rings=12):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=(0,0,0))
    o=bpy.context.object;o.name=name;o.scale=size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    o.data.materials.append(as_material(material, name))
    for poly in o.data.polygons: poly.use_smooth=True
    return link_local(o,parent,loc)

def cylinder(parent,name,loc,radius,height,material,rot=(0,0,0),vertices=16,bevel=.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=height, location=(0,0,0))
    o=bpy.context.object;o.name=name
    if bevel>0:
        mod=o.modifiers.new("Soft metal lip","BEVEL");mod.width=bevel;mod.segments=2
        try: bpy.ops.object.modifier_apply(modifier=mod.name)
        except Exception: pass
    o.data.materials.append(as_material(material, name))
    return link_local(o,parent,loc,rot)

def cone(parent,name,loc,radius,height,material,rot=(0,0,0),vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=.02, depth=height, location=(0,0,0))
    o=bpy.context.object;o.name=name;o.data.materials.append(as_material(material, name))
    for p in o.data.polygons: p.use_smooth=True
    return link_local(o,parent,loc,rot)

def torus(parent,name,loc,major,minor,material,rot=(0,0,0),scale=(1,1,1)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=28, minor_segments=8, location=(0,0,0))
    o=bpy.context.object;o.name=name;o.data.materials.append(as_material(material, name))
    for p in o.data.polygons:p.use_smooth=True
    return link_local(o,parent,loc,rot,scale)

def empty(name,parent,loc=(0,0,0)):
    o=bpy.data.objects.new(name,None)
    bpy.context.collection.objects.link(o)
    o.empty_display_type='PLAIN_AXES'
    o.parent=parent
    o.matrix_parent_inverse=Matrix.Identity(4)
    o.location=loc
    return o

def cape(parent,name,material,width=.76,height=1.35):
    verts=[];faces=[]
    rows=8;cols=7
    for r in range(rows+1):
        t=r/rows
        y=.54-height*t
        w=(.34*(1-t)+width*t)
        for c in range(cols+1):
            u=c/cols*2-1
            x=u*w
            z=-.28-.12*t-.04*math.sin(c*1.2+r*.55)
            verts.append((x,y,z))
    for r in range(rows):
        for c in range(cols):
            a=r*(cols+1)+c;b=a+1;d=(r+1)*(cols+1)+c;e=d+1
            faces.append((a,d,e,b))
    mesh=bpy.data.meshes.new(name+" Surface")
    mesh.from_pydata(verts,[],faces);mesh.materials.append(as_material(material,name));mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o)
    o.parent=parent;o.matrix_parent_inverse=Matrix.Identity(4);o.location=(0,0,0)
    o["costume_detail"]="cloth_cape"
    return o

def rig_name(key, part):
    return f"joint_{key}_{part}"

def create_character(key, data, index):
    display,archetype,style,primary_hex,secondary_hex,accent_hex,skin_hex,dark_hex,hair_hex,scale=data
    root=empty("character_"+key,None,(index%8*5.0,0,-(index//8)*7.0))
    root["identity"]=display;root["characterScale"]=scale;root["rigVersion"]="bs-articulated-v1"
    primary=mat(key+" Suit",primary_hex,.12,.46,0,.25)
    secondary=mat(key+" Armor",secondary_hex,.72,.28,0,.65)
    accent=mat(key+" Accent",accent_hex,.42,.25,accent_hex if style in ("ironman","lantern","flash","thor","aang","spiderman") else 0,.55)
    cloth=mat(key+" Cloth",primary_hex,.05,.72)
    skin=mat(key+" Skin",skin_hex,.02,.62)
    dark=mat(key+" Dark",dark_hex,.22,.42)
    hair=mat(key+" Hair",hair_hex,.03,.65)
    metal=mat(key+" Metal",0xaeb9c6,.84,.22,0,.5)
    glow=mat(key+" Glow",accent_hex,.25,.2,accent_hex,.35)

    pelvis=empty(rig_name(key,"pelvis"),root,(0,1.02,0))
    torso=empty(rig_name(key,"torso"),pelvis,(0,.28,0))
    # Torso and belt are layered as a soft undersuit and hard chest armor.
    cube(torso,key+" Torso Undersuit",(0,.28,0),(.78,.72,.42),cloth,bevel=.09)
    cube(torso,key+" Chest Plate",(0,.42,.205),(.82,.48,.10),secondary,bevel=.065)
    cube(torso,key+" Chest Accent",(0,.37,.265),(.22,.32,.028),glow if style in ("ironman","lantern","flash","thor","spiderman","aang") else accent,bevel=.03)
    cube(pelvis,key+" Belt",(0,.03,.22),(.63,.13,.075),secondary,bevel=.025)
    cube(pelvis,key+" Belt Buckle",(0,.03,.265),(.16,.10,.025),accent,bevel=.018)
    # Shoulder caps and jointed arms. All pivots are named and separately animatable.
    joints={}
    for side,which in [(-1,"left"),(1,"right")]:
        arm=empty(rig_name(key,which+"Arm"),torso,(side*.54,.35,0));joints[which+"Arm"]=arm
        sphere(arm,key+" Shoulder",(0,-.005,0),(.24,.22,.23),secondary)
        cylinder(arm,key+" Upper Arm",(0,-.22,0),.14,.44,primary,vertices=16)
        cube(arm,key+" Bicep Plate",(0,-.22,.11),(.23,.28,.07),secondary,bevel=.04)
        fore=empty(rig_name(key,which+"Fore"),arm,(0,-.42,0));joints[which+"Fore"]=fore
        cylinder(fore,key+" Forearm",(0,-.18,0),.12,.38,secondary,vertices=16)
        cube(fore,key+" Forearm Guard",(0,-.18,.105),(.24,.26,.08),accent,bevel=.035)
        sphere(fore,key+" Glove",(0,-.38,.03),(.14,.13,.15),dark)
    for side,which in [(-1,"left"),(1,"right")]:
        leg=empty(rig_name(key,which+"Leg"),pelvis,(side*.22,-.15,0));joints[which+"Leg"]=leg
        cylinder(leg,key+" Thigh",(0,-.23,0),.17,.47,primary,vertices=16)
        cube(leg,key+" Thigh Plate",(0,-.24,.105),(.26,.27,.075),secondary,bevel=.04)
        shin=empty(rig_name(key,which+"Shin"),leg,(0,-.45,0));joints[which+"Shin"]=shin
        cylinder(shin,key+" Boot Shaft",(0,-.21,0),.135,.43,secondary,vertices=16)
        cube(shin,key+" Boot Toe",(0,-.41,.095),(.31,.14,.37),dark,bevel=.04)
        cube(shin,key+" Boot Sole",(0,-.47,.095),(.30,.045,.30),accent,bevel=.014)
    neck=empty(rig_name(key,"neck"),torso,(0,.72,0))
    head=empty(rig_name(key,"head"),neck,(0,.24,0));joints["head"]=head
    sphere(head,key+" Head",(0,0,0),(.255,.30,.235),skin,24,16)
    # Ear/cheek forms help keep the head readable under dramatic arena lighting.
    for side in (-1,1):
        sphere(head,key+" Ear",(side*.245,-.02,0),(.05,.08,.055),skin,12,8)
        sphere(head,key+" Eye",(side*.095,.045,.206),(.05,.03,.025),dark,12,8)
        sphere(head,key+" Eye Glint",(side*.097,.048,.229),(.012,.008,.007),metal,8,6)

    def headcap(name,color=hair):
        sphere(head,name,(0,.17,-.015),(.27,.20,.24),color,20,12)
    def spike_hair(color=hair,count=7,length=.36):
        for i in range(count):
            a=2*math.pi*i/count
            x=.13*math.cos(a);z=.10*math.sin(a)
            cone(head,key+" Hair Spike",(x,.23+(i%2)*.035,z),.085,length,color,(math.sin(a)*.35,0,-math.cos(a)*.25),8)
        headcap(key+" Hair Crown",color)
    def emblem(color=accent):
        # Layered diamond shield reminiscent of comic chest emblems, without flat 2D decals.
        cube(torso,key+" Emblem Backing",(0,.30,.285),(.31,.34,.06),color,(0,0,math.pi/4),.035)
        cube(torso,key+" Emblem Core",(0,.30,.322),(.16,.20,.04),secondary,(0,0,math.pi/4),.018)
    def eye_lenses(color=0xeaf5ff):
        lensmat=mat(key+" Visor",color,.18,.16,color,.15)
        for side in (-1,1):
            cube(head,key+" Eye Lens Rim",(side*.105,.055,.22),(.15,.105,.035),dark,(0,0,side*.18),.018)
            cube(head,key+" Eye Lens",(side*.105,.055,.245),(.115,.072,.018),lensmat,(0,0,side*.18),.012)
    def band(color=accent,y=.13):
        cube(head,key+" Headband",(0,y,.185),(.48,.075,.095),color,bevel=.018)
        for side in (-1,1):
            cube(head,key+" Band Tail",(side*.27,y-.02,-.035),(.22,.055,.055),color,(0,side*.12,side*.08),.015)

    # Proportions and characteristic silhouettes differ by individual, not just by archetype.
    if style=="hulk":
        # Broader upper body and fists sell Hulk's weight; purple shorts break the silhouette.
        torso.scale=(1.28,1.18,1.12);pelvis.scale=(1.14,1,1.12)
        for which in ("leftArm","rightArm"):
            joints[which].scale=(1.25,1.18,1.15)
        cube(pelvis,key+" Purple Shorts",(0,-.22,.015),(.76,.34,.46),secondary,bevel=.08)
        for side in (-1,1): sphere(joints["leftArm" if side==-1 else "rightArm"],key+" Heavy Fist",(0,-.38,.12),(.18,.17,.18),skin)
    elif style in ("superman","allmight"):
        headcap(key+" Hair Cap",hair)
        spike_hair(hair,7,.20 if style=="superman" else .48)
        emblem(0xc52d3b if style=="superman" else accent)
        if style=="superman":
            cape(root,key+" Superman Red Cape",0x922733,.82,1.52)
        else:
            cape(root,key+" All Might White Cape",0xe6ded2,.80,1.45)
            for side in (-1,1):
                cube(torso,key+" All Might Red Shoulder Stripe",(side*.40,.43,.27),(.10,.40,.035),0xbe3039,bevel=.014)
    elif style=="ironman":
        sphere(head,key+" Helmet Dome",(0,.02,-.01),(.29,.32,.27),secondary,24,16)
        cube(head,key+" Gold Faceplate",(0,-.08,.225),(.31,.19,.075),accent,bevel=.045)
        cube(head,key+" Face Slot",(0,-.03,.27),(.20,.055,.025),dark,bevel=.014)
        sphere(torso,key+" Arc Reactor",(0,.30,.30),(.115,.115,.035),glow,20,14)
    elif style=="lantern":
        headcap(key+" Hair",hair)
        emblem(glow)
        torus(joints["rightFore"],key+" Power Ring",(0,-.31,.125),.075,.018,accent)
    elif style=="hero":
        headcap(key+" Hair",hair);spike_hair(hair,6,.16);emblem(0xc52d3b)
    elif style=="wonderwoman":
        headcap(key+" Hair",hair)
        cylinder(head,key+" Tiara",(0,.19,.005),.27,.065,accent,(0,0,0),24,.012)
        cube(torso,key+" Eagle Chestplate",(0,.46,.27),(.42,.16,.035),accent,bevel=.02)
        for side in (-1,1):
            cylinder(joints["leftFore"] if side<0 else joints["rightFore"],key+" Bracer",(0,-.18,.005),.145,.21,accent,vertices=16)
    elif style=="professorx":
        headcap(key+" Bald Cap",skin)
        # The hover chair replaces lower legs with an instantly recognizable wheeled silhouette.
        chair=empty(rig_name(key,"hoverchair"),root,(0,.04,-.10))
        cube(chair,key+" Chair Seat",(0,.60,0),(.74,.18,.66),dark,bevel=.09)
        cube(chair,key+" Chair Back",(0,.96,-.24),(.67,.68,.16),secondary,bevel=.07)
        cube(chair,key+" Chair Headrest",(0,1.34,-.24),(.42,.20,.15),accent,bevel=.05)
        for side in (-1,1):
            torus(chair,key+" Chair Wheel",(side*.42,.38,-.03),.28,.045,dark,(0,math.pi/2,0))
            torus(chair,key+" Hover Ring",(side*.42,.38,-.03),.20,.022,glow,(0,math.pi/2,0))
        cylinder(chair,key+" Repulsor Base",(0,.27,-.02),.24,.08,glow,vertices=24)
    elif style=="flash":
        sphere(head,key+" Flash Cowl",(0,.03,0),(.28,.32,.25),primary,24,16)
        eye_lenses(0xffefc7)
        for side in (-1,1):
            cone(head,key+" Ear Lightning Bolt",(side*.26,.04,0),.07,.42,accent,(0,0,side*.9),6)
        emblem(accent);cape(root,key+" Short Red Cape",secondary,.55,.88)
    elif style=="aquaman":
        headcap(key+" Long Hair",hair)
        for side in (-1,1):
            for row in range(4):
                cube(torso,key+" Scale Row",(side*.25,.15-row*.10,.267),(.18,.045,.025),accent,bevel=.01)
    elif style=="strange":
        headcap(key+" Dark Hair",hair);cape(root,key+" Cloak of Levitation",secondary,.82,1.42)
        cone(torso,key+" Cloak Collar Left",(-.30,.60,-.04),.16,.52,secondary,(0,0,.45))
        cone(torso,key+" Cloak Collar Right",(.30,.60,-.04),.16,.52,secondary,(0,0,-.45))
        cylinder(torso,key+" Eye of Agamotto",(0,.17,.29),.09,.045,accent,(math.pi/2,0,0),20)
    elif style=="terminator":
        headcap(key+" Hair",hair)
        cube(head,key+" Cyborg Half Face",(0,-.055,.235),(.20,.18,.06),metal,bevel=.025)
        sphere(head,key+" Red Eye",(.10,.035,.274),(.035,.022,.014),glow,12,8)
        for side in (-1,1):
            cube(torso,key+" Endoskeleton Chest Rail",(side*.24,.30,.27),(.06,.53,.07),metal,bevel=.018)
    elif style=="goku":
        cube(torso,key+" Blue Undershirt",(0,.30,.27),(.44,.38,.055),secondary,bevel=.04)
        cube(torso,key+" Gi Belt",(0,.07,.285),(.70,.10,.065),accent,bevel=.022)
    elif style=="naruto":
        band(0x282d35,.15);cube(head,key+" Leaf Plate",(0,.15,.24),(.18,.10,.035),metal,bevel=.02)
        spike_hair(hair,12,.36)
        for side in (-1,1):
            for row in range(3):cube(head,key+" Cheek Mark",(side*.14,-.075+row*.04,.22),(.065,.014,.012),dark,bevel=.003)
    elif style=="vegeta":
        spike_hair(hair,9,.48)
        cube(torso,key+" White Saiyan Armor",(0,.34,.265),(.66,.52,.10),accent,bevel=.06)
        for side in (-1,1):cube(torso,key+" Armor Border",(side*.30,.34,.325),(.065,.46,.025),secondary,bevel=.014)
    elif style=="saitama":
        sphere(head,key+" Bald Scalp",(0,.12,0),(.26,.25,.23),skin,24,16)
        cape(root,key+" White Cape",0xe6e6e1,.85,1.52)
        for side in (-1,1):cylinder(joints["leftFore"] if side<0 else joints["rightFore"],key+" Red Glove",(0,-.37,.015),.13,.18,0xb62d36,vertices=16)
    elif style=="l":
        headcap(key+" Messy Black Hair",hair);spike_hair(hair,6,.15)
        cube(torso,key+" White Shirt",(0,.29,.258),(.64,.54,.08),0xebe7df,bevel=.02)
        for side in (-1,1):cube(head,key+" Dark Eye Shadow",(side*.09,.02,.233),(.095,.035,.012),dark,bevel=.008)
    elif style=="allmight":
        spike_hair(hair,11,.50);emblem(accent);cape(root,key+" White Hero Cape",0xe4ddd3,.78,1.42)
        for side in (-1,1):cube(torso,key+" Red Shoulder Stripe",(side*.40,.43,.27),(.10,.40,.035),0xbe3039,bevel=.014)
    elif style=="edward":
        spike_hair(hair,6,.25);cube(torso,key+" Red Trenchcoat",(0,.15,-.02),(.87,.78,.45),primary,bevel=.06)
        joints["rightArm"].scale=(.92,1,.9)
        cube(joints["rightArm"],key+" Automail Forearm",(0,-.26,.12),(.22,.34,.09),metal,bevel=.025)
        for side in (-1,1):cube(torso,key+" Alchemy Strap",(side*.12,.36,.29),(.05,.60,.025),accent,(0,0,side*.25),.008)
    elif style=="levi":
        band(0x303039,.16);cape(root,key+" Scout Cloak",0x425e43,.66,1.08)
        for side in (-1,1):
            cube(torso,key+" Harness Strap",(side*.22,.28,.29),(.04,.55,.035),accent,(0,0,side*.34),.012)
            cube(joints["leftFore"] if side<0 else joints["rightFore"],key+" ODM Cuff",(0,-.18,.12),(.24,.16,.13),metal,bevel=.025)
    elif style=="mario":
        headcap(key+" Red Cap",primary);cylinder(head,key+" Cap Brim",(0,.19,.11),.25,.08,primary,vertices=24)
        sphere(head,key+" Nose",(0,-.04,.24),(.10,.10,.085),skin,12,8)
        cube(torso,key+" Overall Bib",(0,.24,.25),(.52,.46,.08),secondary,bevel=.04)
        for side in (-1,1):sphere(torso,key+" Overall Button",(side*.20,.38,.31),(.045,.045,.02),accent,10,8)
    elif style=="luigi":
        headcap(key+" Green Cap",primary);cylinder(head,key+" Cap Brim",(0,.19,.11),.25,.08,primary,vertices=24)
        sphere(head,key+" Nose",(0,-.04,.24),(.10,.10,.085),skin,12,8)
        cube(torso,key+" Overall Bib",(0,.24,.25),(.52,.46,.08),secondary,bevel=.04)
        for side in (-1,1):sphere(torso,key+" Overall Button",(side*.20,.38,.31),(.045,.045,.02),accent,10,8)
    elif style=="kratos":
        sphere(head,key+" Beard",(0,-.16,.14),(.20,.13,.17),hair,16,10)
        cube(head,key+" Red Face Tattoo",(-.11,.02,.222),(.045,.38,.016),accent,bevel=.01)
        cube(torso,key+" Leather Harness",(0,.30,.27),(.62,.13,.035),accent,(0,0,-.28),.01)
    elif style=="link":
        cone(head,key+" Green Cap",(0,.23,-.02),.20,.52,primary,(math.pi,0,0),8)
        cube(torso,key+" Leather Belt",(0,.06,.27),(.64,.09,.045),accent,bevel=.015)
        cube(torso,key+" Shield Back Strap",(0,.33,-.25),(.30,.45,.07),dark,bevel=.025)
    elif style=="chief":
        sphere(head,key+" Helmet",(0,.045,0),(.30,.32,.27),secondary,24,16)
        cube(head,key+" Gold Visor",(0,.015,.23),(.40,.12,.055),0xd8b861,bevel=.035)
        cube(torso,key+" Chest Lock",(0,.31,.27),(.24,.21,.06),accent,bevel=.025)
    elif style=="thor":
        headcap(key+" Long Blond Hair",hair);cape(root,key+" Thor Red Cape",0x7c1e2a,.90,1.54)
        for side in (-1,1):
            cylinder(torso,key+" Chest Roundplate",(side*.20,.40,.28),.10,.045,accent,(math.pi/2,0,0),20)
            cube(joints["leftFore"] if side<0 else joints["rightFore"],key+" Asgard Bracer",(0,-.18,.09),(.24,.25,.07),secondary,bevel=.04)
    elif style=="aang":
        sphere(head,key+" Aang Scalp",(0,.11,0),(.25,.24,.23),skin,24,16)
        # Blue arrow tattoo continues over head, sternum and forearms.
        cube(head,key+" Arrow Forehead",(0,.18,.231),(.055,.30,.018),glow,bevel=.008)
        cone(head,key+" Arrow Point",(0,.36,.229),.055,.16,glow,(0,0,0),4)
        cube(torso,key+" Arrow Chest",(0,.32,.274),(.05,.30,.018),glow,bevel=.007)
        for side in (-1,1):cube(joints["leftFore"] if side<0 else joints["rightFore"],key+" Forearm Arrow",(0,-.17,.18),(.035,.22,.018),glow,bevel=.006)
    elif style=="madara":
        headcap(key+" Long Black Hair",hair);spike_hair(hair,12,.42)
        band(0x24272e,.14);cape(root,key+" Madara Hair Mantle",0x27252d,.75,1.3)
        for side in (-1,1):
            cube(torso,key+" Samurai Armor Lamella",(side*.34,.12,.28),(.22,.36,.055),secondary,(0,0,side*.1),.025)
            cube(torso,key+" Red Armor Tie",(side*.34,-.12,.29),(.20,.045,.025),accent,bevel=.008)
    elif style=="hashirama":
        headcap(key+" Hashirama Hair",hair);band(0x30343d,.14);cape(root,key+" Hashirama Green Cloak",0x354f43,.78,1.36)
        for side in (-1,1):
            cube(torso,key+" Samurai Chest Plate",(side*.32,.23,.28),(.21,.48,.06),secondary,(0,0,side*.08),.025)
    elif style=="voldemort":
        sphere(head,key+" Voldemort Smooth Scalp",(0,.12,0),(.27,.26,.23),skin,24,16)
        cube(head,key+" Snake Nose",(0,-.08,.245),(.055,.13,.08),skin,bevel=.012)
        for side in (-1,1):cube(head,key+" Red Eye",(side*.09,.02,.241),(.05,.025,.012),glow,bevel=.006)
        cape(root,key+" Dark Robes",0x17181e,.87,1.54)
    elif style=="sasuke":
        spike_hair(hair,8,.36);band(0x30353d,.14)
        cube(torso,key+" High Collar",(0,.43,.27),(.62,.18,.07),secondary,bevel=.035)
        cube(torso,key+" Rope Belt",(0,.03,.29),(.70,.10,.055),accent,bevel=.018)
    elif style=="edna":
        sphere(head,key+" Black Bob Hair",(0,.025,-.03),(.31,.31,.25),hair,24,16)
        glass=mat(key+" Heavy Glasses",0x14151a,.2,.22,0,.1)
        for side in (-1,1):torus(head,key+" Thick Glasses",(side*.105,.03,.228),.09,.018,glass,(math.pi/2,0,0))
        cube(torso,key+" High Fashion Collar",(0,.55,.27),(.57,.09,.06),accent,bevel=.02)
    elif style=="pirate":
        band(0x6b4935,.13);spike_hair(hair,8,.15);cape(root,key+" Pirate Coat",0x3a3030,.78,1.26)
        cylinder(head,key+" Pirate Bandana",(0,.21,-.01),.24,.10,accent,vertices=18)
        for side in (-1,1):sphere(head,key+" Dreadlock",(side*.24,-.04,-.01),(.055,.25,.06),hair,10,8)
    elif style=="blackadam":
        headcap(key+" Black Adam Bald Head",skin);emblem(0xe1b94e);cape(root,key+" Black Adam Cape",0x17191f,.76,1.38)
        cube(torso,key+" Lightning Bolt",(0,.30,.34),(.11,.38,.045),accent,(0,0,math.pi/5),.012)
    elif style=="samuel":
        sphere(head,key+" Bald Head",(0,.11,0),(.27,.23,.23),skin,20,12)
        cube(head,key+" Eyepatch",(0.11,.055,.23),(.16,.105,.045),dark,bevel=.02)
        cube(head,key+" Eyepatch Strap",(0,.07,-.005),(.5,.035,.025),dark,bevel=.008)
    elif style=="brucelee":
        headcap(key+" Short Black Hair",hair)
        for side in (-1,1):cube(torso,key+" Tracksuit Stripe",(side*.36,.25,.26),(.045,.52,.025),0x15171b,bevel=.008)
        cube(torso,key+" Black Sash",(0,.0,.27),(.68,.07,.04),dark,bevel=.01)
    elif style=="vandamme":
        headcap(key+" Martial Artist Hair",hair);eye_lenses(0x22262d)
        cube(torso,key+" Red Training Sash",(0,.05,.27),(.68,.08,.04),accent,bevel=.01)
    elif style=="lucyliu":
        headcap(key+" Black Hair",hair);cape(root,key+" White Jacket Panels",0xf0ece4,.55,.86)
        cube(torso,key+" Red Waist Sash",(0,.04,.30),(.66,.09,.035),accent,bevel=.012)
    elif style=="sigourney":
        headcap(key+" Short Brown Hair",hair)
        cube(torso,key+" Flight Pack",(0,.20,-.30),(.48,.62,.18),dark,bevel=.04)
        for side in (-1,1):cube(torso,key+" Flight Suit Pocket",(side*.35,.08,.26),(.15,.20,.035),accent,bevel=.02)
    elif style=="keanu":
        headcap(key+" Long Dark Hair",hair);cape(root,key+" Long Black Coat",0x15171d,.72,1.30)
        sphere(head,key+" Beard",(0,-.13,.18),(.19,.09,.10),hair,16,8)
    elif style=="burt":
        headcap(key+" Feathered Brown Hair",hair)
        sphere(head,key+" Mustache",(0,-.085,.225),(.14,.045,.04),hair,16,8)
        cube(torso,key+" Open Shirt Collar",(0,.53,.24),(.32,.10,.04),0xe5d9c8,bevel=.015)
    elif style=="grace":
        cylinder(head,key+" High Fashion Crown Hair",(0,.28,-.02),.17,.42,hair,vertices=12,bevel=.02)
        cube(torso,key+" Sculptural Shoulder",(0,.52,.25),(.74,.16,.09),accent,bevel=.035)
    elif style=="wolverine":
        eye_lenses(0x252a30);headcap(key+" Wolverine Hair",hair)
        for side in (-1,1):
            cone(head,key+" Wolverine Sideburn",(side*.22,-.01,.08),.09,.34,hair,(0,0,side*.5),7)
            for claw in range(3):cone(joints["leftFore"] if side<0 else joints["rightFore"],key+" Claw",(side*.10+claw*.04,-.30,.22),.025,.48,metal,(math.pi/2,0,0),6)
        emblem(0xe4ba2a)
    elif style=="zoro":
        headcap(key+" Green Hair",hair);band(0x273139,.14)
        cube(torso,key+" Green Robe Panel",(0,.22,.28),(.40,.60,.035),primary,bevel=.025)
        cube(torso,key+" Waist Sash",(0,.0,.30),(.72,.09,.045),accent,bevel=.012)
    elif style=="jotaro":
        headcap(key+" Dark Hair",hair);cape(root,key+" Long School Coat",0x182333,.82,1.38)
        cylinder(head,key+" Cap Brim",(0,.16,.03),.31,.06,secondary,vertices=24,bevel=.012)
        cube(head,key+" Gold Cap Badge",(0,.18,.26),(.12,.09,.025),accent,bevel=.01)
    elif style=="snake":
        headcap(key+" Tactical Hair",hair);band(0x5b694f,.14)
        cube(torso,key+" Tactical Harness",(0,.25,.285),(.48,.48,.045),dark,bevel=.02)
        cube(torso,key+" Chest Strap",(-.12,.25,.32),(.06,.58,.035),secondary,(0,0,-.32),.012)
    elif style=="geralt":
        headcap(key+" Silver Hair",hair);cape(root,key+" Witcher Leather Coat",0x2a3036,.72,1.24)
        cube(head,key+" Face Scar",(.09,.04,.235),(.025,.16,.014),0x9e5550,bevel=.004)
        torus(torso,key+" Witcher Medallion",(0,.23,.31),.10,.018,metal,(math.pi/2,0,0))
    elif style=="lara":
        headcap(key+" Brown Ponytail",hair)
        sphere(head,key+" Ponytail",(0,.06,-.32),(.10,.25,.12),hair,12,8)
        cube(torso,key+" Utility Harness",(0,.22,.29),(.54,.09,.035),dark,bevel=.012)
        for side in (-1,1):cube(pelvis,key+" Holster",(side*.32,-.06,.22),(.12,.22,.15),dark,bevel=.018)
    elif style=="sephiroth":
        headcap(key+" Long Silver Hair",hair);cape(root,key+" Long Black Coat",0x171a22,.84,1.55)
        for side in (-1,1):cone(head,key+" Silver Hair Lock",(side*.20,-.08,-.08),.07,.62,hair,(0,0,side*.12),7)
        cube(torso,key+" Silver Coat Clasp",(0,.50,.29),(.12,.20,.035),metal,bevel=.012)
    elif style=="doom":
        sphere(head,key+" Doom Helmet",(0,.02,0),(.30,.33,.28),secondary,20,14);eye_lenses(0xff663d)
        cube(torso,key+" Heavy Chest Plate",(0,.28,.29),(.68,.38,.12),secondary,bevel=.05)
        cube(torso,key+" Orange Armor Mark",(0,.28,.36),(.10,.27,.02),accent,bevel=.012)
    elif style=="shrek":
        sphere(head,key+" Ogre Head",(0,.0,.02),(.29,.31,.25),skin,20,14)
        for side in (-1,1):
            cylinder(head,key+" Ogre Ear",(side*.32,.04,-.02),.085,.24,skin,(0,0,side*math.pi/2),12,.012)
            sphere(head,key+" Ogre Ear Tip",(side*.39,.04,-.02),(.07,.07,.07),skin,12,8)
        cube(torso,key+" Brown Ogre Vest",(0,.30,.27),(.60,.48,.055),secondary,bevel=.04)
    elif style=="aladdin":
        headcap(key+" Black Hair",hair);cylinder(head,key+" Red Fez",(0,.25,-.015),.20,.22,accent,vertices=16,bevel=.025)
        cube(torso,key+" Blue Vest",(0,.26,.27),(.46,.50,.045),primary,bevel=.035)
        cube(pelvis,key+" Loose Sash",(0,.04,.27),(.70,.10,.04),accent,bevel=.012)
    elif style=="ariel":
        headcap(key+" Ariel Red Hair",hair)
        for side in (-1,1):sphere(head,key+" Long Red Hair Lock",(side*.20,-.03,-.08),(.08,.30,.09),hair,12,8)
        sphere(pelvis,key+" Mermaid Tail Skirt",(0,-.22,.0),(.40,.27,.34),secondary,20,12)
        cone(pelvis,key+" Tail Fin",(0,-.44,-.02),.23,.40,accent,(math.pi,0,0),10)
    elif style=="ursula":
        headcap(key+" White Hair",hair);cape(root,key+" Purple Sea Witch Mantle",0x32223e,.90,1.28)
        sphere(torso,key+" Purple Tentacle Skirt",(0,-.20,.03),(.46,.25,.42),primary,20,12)
        for side in (-1,1):
            cone(pelvis,key+" Tentacle",(side*.25,-.40,.04),.13,.68,secondary,(0,0,side*.35),10)
    elif style=="sesshomaru":
        headcap(key+" Silver Hair",hair);cape(root,key+" White Fur Mantle",0xe5e2d9,.90,1.42)
        cube(head,key+" Crescent Forehead Mark",(0,.16,.24),(.09,.07,.025),accent,bevel=.012)
        for side in (-1,1):cube(head,key+" Magenta Cheek Mark",(side*.17,-.01,.22),(.035,.09,.018),0xb83359,bevel=.006)
    elif style=="norman":
        headcap(key+" Brown Hair",hair);cape(root,key+" Motel Jacket",0x5b422f,.72,1.20)
        cube(torso,key+" Green Sweater",(0,.20,.28),(.54,.42,.04),primary,bevel=.025)
    elif style=="hansolo":
        headcap(key+" Brown Hair",hair)
        cube(torso,key+" Black Vest",(0,.24,.285),(.44,.50,.05),dark,bevel=.025)
        cube(torso,key+" White Shirt Front",(0,.25,.32),(.24,.47,.025),0xe6e0d5,bevel=.015)
        cube(pelvis,key+" Utility Belt",(0,.04,.28),(.72,.09,.045),accent,bevel=.012)
    elif style=="indiana":
        headcap(key+" Brown Hair",hair)
        cube(head,key+" Fedora Crown",(0,.20,-.02),(.34,.18,.30),0x62482e,bevel=.035)
        cube(head,key+" Fedora Brim",(0,.14,.03),(.48,.055,.36),0x62482e,bevel=.02)
        cape(root,key+" Leather Adventure Jacket",0x60432e,.74,1.20)
        cube(torso,key+" Adventure Strap",(.13,.27,.30),(.055,.60,.035),0x2b241d,(0,0,-.24),.012)
    elif style=="spiderman":
        # Red/blue panels and raised web lines give the mask/body a recognizable classic suit read.
        sphere(head,key+" Spider-Man Mask",(0,.01,.03),(.275,.31,.235),primary,24,16)
        eye_lenses(0xf3f8ff)
        emblem(0x171b25)
        webmat=mat(key+" Raised Web Seam",0x171d28,.25,.38)
        for y in (.16,.02,-.12,-.26):
            cube(head,key+" Mask Web Arc",(0,y,.232),(.40,.012,.012),webmat,bevel=.004)
        for side in (-1,1):
            cube(torso,key+" Blue Side Suit Panel",(side*.31,.25,.273),(.19,.52,.025),secondary,bevel=.025)
            for row in range(4):cube(joints["leftFore"] if side<0 else joints["rightFore"],key+" Wrist Web Seam",(side*.07,-.18+row*.05,.137),(.20,.012,.008),webmat,bevel=.002)
    else:
        headcap(key+" Hair",hair)
        if style in ("sasuke","madara","hashirama"):band(0x30343c,.14)

    # Character insignia and trim are layered pieces rather than painted billboards.
    if style not in ("l","edna","pirate","voldemort","professorx","terminator","spiderman"):
        for side in (-1,1):
            cube(torso,key+" Shoulder Piping",(side*.49,.46,.20),(.07,.27,.025),accent,(0,0,side*.18),.012)
    # High-detail material response remains compatible with fast glTF PBR rendering.
    root["rigParts"]="torso,pelvis,head,leftArm,rightArm,leftFore,rightFore,leftLeg,rightLeg,leftShin,rightShin"
    return root

def main():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection" and collection.users == 0:
            bpy.data.collections.remove(collection)
    for index,(key,data) in enumerate(CHARACTERS.items()):
        create_character(key,data,index)
    # Save the entire source gallery as an editable Blender project.
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    # Include the complete prefab hierarchy in the runtime GLB.
    bpy.ops.object.select_all(action='SELECT')
    bpy.context.view_layer.objects.active=bpy.context.selected_objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False
    )
    print(f"Built {len(CHARACTERS)} articulated character prefabs")
    print(f"Editable Blender scene: {BLEND_PATH}")
    print(f"Game-ready GLB library: {GLB_PATH}")

if __name__ == "__main__":
    main()
