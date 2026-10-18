import bpy, math, os, random
from mathutils import Matrix

# Browser Smash Character Weapon Library.
# All weapons are original low-poly/PBR game assets modeled from recognizable silhouettes,
# with one hand-grip at the root origin. Blender scene uses Z-up; GLB exports with Y-up.
random.seed(42)
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT_BLEND = os.path.join(ROOT, "character_weapons.blend")
OUT_GLB = os.path.abspath(os.path.join(ROOT, "..", "..", "public", "assets", "character_weapons.glb"))

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for block in list(datablocks):
        if block.users == 0:
            datablocks.remove(block)

def mat(name, color, metallic=0.0, roughness=.45, emission=0.0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color,1)
    bs.inputs['Metallic'].default_value = metallic
    bs.inputs['Roughness'].default_value = roughness
    if emission:
        inp = bs.inputs.get('Emission Color') or bs.inputs.get('Emission')
        if inp:
            inp.default_value = (*color,1)
        strength = bs.inputs.get('Emission Strength')
        if strength: strength.default_value = emission
    return m

def rgb(hexv):
    return (((hexv>>16)&255)/255, ((hexv>>8)&255)/255, (hexv&255)/255)

def new_obj(root, name, op, loc, dims, material, rotation=(0,0,0), **kwargs):
    if op == 'cube':
        bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,0))
    elif op == 'cylinder':
        bpy.ops.mesh.primitive_cylinder_add(vertices=kwargs.get('vertices',16), radius=1, depth=1, location=(0,0,0))
    elif op == 'cone':
        bpy.ops.mesh.primitive_cone_add(vertices=kwargs.get('vertices',12), radius1=1, radius2=0, depth=1, location=(0,0,0))
    elif op == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=kwargs.get('segments',16), ring_count=kwargs.get('rings',10), radius=1, location=(0,0,0))
    elif op == 'ico':
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=kwargs.get('subdivisions',1), radius=1, location=(0,0,0))
    elif op == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_segments=kwargs.get('major_segments',24), minor_segments=8,
                                         major_radius=1, minor_radius=.12, location=(0,0,0))
    else:
        raise ValueError(op)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.location = loc
    obj.scale = dims
    obj.rotation_euler = rotation
    obj.data.materials.append(material)
    for p in obj.data.polygons:
        p.use_smooth = op in ('sphere','torus')
    if op == 'cube' and max(dims) < 2:
        bevel = obj.modifiers.new('Edge catches', 'BEVEL')
        bevel.width = .025
        bevel.segments = 2
    return obj

def box(r,n,l,d,m,rot=(0,0,0)): return new_obj(r,n,'cube',l,d,m,rot)
def cyl(r,n,l,rad,depth,m,rot=(0,0,0),verts=16): return new_obj(r,n,'cylinder',l,(rad,rad,depth),m,rot,vertices=verts)
def cone(r,n,l,rad,depth,m,rot=(0,0,0),verts=12): return new_obj(r,n,'cone',l,(rad,rad,depth),m,rot,vertices=verts)
def sphere(r,n,l,d,m): return new_obj(r,n,'sphere',l,d,m)
def ico(r,n,l,d,m): return new_obj(r,n,'ico',l,d,m)
def torus(r,n,l,rad,minor,m,rot=(0,0,0)):
    return new_obj(r,n,'torus',l,(rad,rad,rad),m,rot,major_segments=32)

def root_for(key, hand, name, display_pos):
    ob = bpy.data.objects.new(f'weapon_{key}_{hand}', None)
    bpy.context.scene.collection.objects.link(ob)
    ob.empty_display_type='CIRCLE'
    ob.empty_display_size=.24
    ob['character_key']=key
    ob['hand']=hand
    ob['display_name']=name
    ob.location=display_pos
    return ob

def make_sword(r, mats, kind='sword', scale=1.0):
    steel,gold,wood,glow,dark=mats
    if kind=='giant_sword': scale=1.42
    if kind=='scimitar': scale=1.02
    # Grip is at Z=0, blade extends up the forearm from the held handle.
    cyl(r,'Wrapped grip',(0,0,-.08*scale),.045*scale,.28*scale,wood,verts=10)
    cyl(r,'Pommel',(0,0,-.24*scale),.07*scale,.06*scale,gold,verts=12)
    box(r,'Cross guard',(0,0,.095*scale),(.42*scale,.09*scale,.075*scale),gold)
    if kind=='scimitar':
        for i in range(6):
            z=(.26+i*.145)*scale
            box(r,f'Curved scimitar segment {i}',(.055*math.sin(i*.22)*scale,0,z),
                (.075*scale,.045*scale,.24*scale),steel,(0,.12+i*.06,0))
        cone(r,'Scimitar point',(.12*scale,0,1.13*scale),.07*scale,.18*scale,steel,(0,.12,0))
    else:
        length=(1.28 if kind=='giant_sword' else 1.03 if kind=='katana' else .9)*scale
        width=(.16 if kind=='giant_sword' else .085 if kind=='katana' else .105)*scale
        box(r,'Main blade',(0,0,.14*scale+length*.47),(width,.045*scale,length),steel)
        box(r,'Blade fuller',(0,-.025*scale,.14*scale+length*.47),(.018*scale,.012*scale,length*.78),glow if kind in ('katana','cyber_blade') else gold)
        cone(r,'Blade point',(0,0,.14*scale+length),width*.52,.18*scale,steel)
        if kind in ('katana','cyber_blade'):
            box(r,'Handle wrap',(0,0,-.07*scale),(.095*scale,.075*scale,.2*scale),dark)
            for i in range(4):
                box(r,f'Grip wrap {i}',(0,-.041*scale,(-.14+i*.045)*scale),(.1*scale,.012*scale,.018*scale),gold)
        if kind=='giant_sword':
            box(r,'Heavy spine',(0,.025*scale,.17*scale+length*.46),(.2*scale,.07*scale,length*.78),dark)
    return r

def make_gun(r, mats, kind='blaster'):
    steel,gold,wood,glow,dark=mats
    size=1.0 if kind=='blaster' else 1.25
    box(r,'Receiver',(0,-.22*size,.06*size),(.22*size,.34*size,.17*size),steel)
    box(r,'Barrel',(0,-.5*size,.09*size),(.09*size,.44*size,.085*size),dark)
    box(r,'Muzzle',(0,-.73*size,.09*size),(.13*size,.08*size,.11*size),gold)
    box(r,'Grip',(0,-.12*size,-.16*size),(.13*size,.14*size,.34*size),wood,(.22,0,0))
    box(r,'Trigger guard',(0,-.22*size,-.12*size),(.12*size,.08*size,.07*size),gold)
    box(r,'Top optic',(0,-.22*size,.18*size),(.12*size,.18*size,.05*size),glow)
    if kind in ('rifle','shotgun','plasma_rifle'):
        box(r,'Stock',(0,.03*size,.015*size),(.19*size,.38*size,.12*size),dark)
        box(r,'Forward grip',(0,-.42*size,-.12*size),(.14*size,.15*size,.28*size),wood)
        if kind=='shotgun':
            for x in [-.065,.065]:
                box(r,'Twin barrel',(x,-.63*size,.1*size),(.055*size,.42*size,.055*size),steel)
        if kind=='plasma_rifle':
            sphere(r,'Glowing plasma chamber',(0,-.36*size,.22*size),(.13*size,.13*size,.13*size),glow)
    return r

def make_gauntlet(r,mats,kind='gauntlet'):
    steel,gold,wood,glow,dark=mats
    box(r,'Wrist cuff',(0,0,-.05),(.24,.3,.23),dark)
    box(r,'Armored knuckle plate',(0,-.02,.13),(.3,.27,.16),steel)
    for i in range(4):
        x=(i-1.5)*.066
        box(r,f'Finger guard {i}',(x,-.12,.16),(.05,.09,.12),gold if i%2==0 else steel)
    if kind in ('repulsor','energy_gauntlet','alchemy_glove'):
        disc=torus(r,'Energy emitter',(0,-.17,.08),.12,.025,glow,(math.pi/2,0,0))
        sphere(r,'Arc core',(0,-.17,.08),(.075,.045,.075),glow)
    if kind=='energy_construct':
        torus(r,'Emerald projection',(0,-.12,.42),.25,.035,glow,(math.pi/2,0,0))
        ico(r,'Construct core',(0,-.14,.42),(.15,.08,.15),glow)
        for i in range(3):
            cone(r,f'Construct crystal {i}',((i-1)*.15,-.15,.65),.075,.3,glow,(0,0,(i-1)*.18),6)
    if kind=='lightning':
        for side in [-1,1]:
            cone(r,'Lightning prong',(side*.16,-.08,.3),.045,.32,glow,(0,side*.35,0),5)
    if kind=='claws':
        for i in [-1,0,1]:
            cone(r,'Adamantium claw',(i*.09,-.19,.44),.045,.72,steel,(math.pi/2,0,0),6)
        box(r,'Claw brace',(0,-.07,.26),(.28,.2,.12),gold)
    return r

def make_staff(r,mats,kind='staff'):
    steel,gold,wood,glow,dark=mats
    cyl(r,'Long shaft',(0,0,.54),.045,.98,wood,verts=12)
    cyl(r,'Grip rings',(0,0,.12),.07,.08,gold)
    if kind=='trident':
        cyl(r,'Neck',(0,0,1.07),.06,.3,gold)
        for i in [-1,0,1]:
            x=i*.16
            cone(r,f'Trident tine {i}',(x,0,1.37-(abs(i)*.15)),.07,.6,steel,(0,0,-i*.18),8)
        cone(r,'Center tine',(0,0,1.55),.09,.72,gold)
    elif kind=='wand':
        cone(r,'Wand taper',(0,0,1.08),.038,.85,wood,(0,.04,0),7)
        ico(r,'Wand tip',(0,0,1.48),(.07,.07,.09),glow)
    elif kind=='staff':
        ico(r,'Wood style crest',(0,0,1.15),(.23,.13,.25),glow)
        for i in [-1,1]:
            cone(r,'Branch prong',(i*.18,0,1.27),.055,.45,wood,(0,i*.36,0),7)
    return r

def make_whip(r,mats):
    steel,gold,wood,glow,dark=mats
    cyl(r,'Whip handle',(0,0,-.05),.055,.27,wood,verts=10)
    torus(r,'Handle ferrule',(0,0,.08),.075,.016,gold)
    for i in range(16):
        t=i/15
        x=.48*math.sin(t*math.pi*.96)
        y=-.12-t*.07
        z=.12+t*1.25
        sphere(r,f'Braided whip link {i}',(x,y,z),(.035*(1-t)+.012,.035*(1-t)+.012,.05*(1-t)+.012),wood)
    return r

def make_fan(r,mats):
    steel,gold,wood,glow,dark=mats
    # Gunbai-style fan silhouette with radial ribs.
    ico(r,'War fan body',(0,0,.55),(.58,.1,.55),dark)
    torus(r,'Fan rim',(0,0,.55),.55,.035,gold,(math.pi/2,0,0))
    cyl(r,'Fan handle',(0,0,.02),.045,.66,wood,verts=10)
    for i in range(-4,5):
        angle=i*.19
        bar=box(r,f'Fan rib {i}',(math.sin(angle)*.22,-.105,.56+math.cos(angle)*.12),(.025,.025,.7),gold,(0,angle,0))
    ico(r,'Fan crest',(0,-.13,.57),(.17,.035,.17),glow)
    return r

def make_shield(r,mats):
    steel,gold,wood,glow,dark=mats
    # Vertical shield face; exported axis conversion preserves its facing plane.
    ico(r,'Shield boss',(0,-.15,.5),(.13,.08,.13),gold)
    for z,fac in [(0.5,1),(0.42,.72),(0.34,.45)]:
        ico(r,'Shield ring',(0,-.13,z),(.42*fac,.075,.5*fac),steel if fac==1 else gold)
    box(r,'Shield rim',(0,-.12,.5),(.88,.08,.94),gold)
    return r

def make_orb(r,mats,kind='ki_orb'):
    steel,gold,wood,glow,dark=mats
    sphere(r,'Energy core',(0,-.12,.38),(.19,.17,.19),glow)
    torus(r,'Energy halo',(0,-.13,.38),.31,.025,glow,(math.pi/2,0,0))
    for i in range(5):
        angle=i*math.pi*2/5
        ico(r,f'Floating shard {i}',(math.cos(angle)*.32,-.14,.38+math.sin(angle)*.32),(.06,.06,.06),gold if i%2 else glow)
    if kind in ('spellrings','psychic_focus'):
        torus(r,'Outer sigil',(0,-.13,.38),.43,.022,gold,(math.pi/2,0,0))
    return r

def make_book(r,mats):
    steel,gold,wood,glow,dark=mats
    box(r,'Book cover',(0,-.03,.22),(.48,.16,.58),dark)
    box(r,'Gold page block',(0,-.125,.22),(.41,.025,.51),gold)
    box(r,'Front cover',(0,-.15,.22),(.47,.035,.57),wood)
    box(r,'Arcane cover sigil',(0,-.175,.22),(.17,.02,.21),glow)
    for x in [-.2,.2]:
        box(r,'Book corner',(x,-.18,.45),(.05,.03,.06),gold)
    return r

def make_knife(r,mats):
    steel,gold,wood,glow,dark=mats
    cyl(r,'Knife grip',(0,0,-.05),.04,.22,wood,verts=8)
    box(r,'Guard',(0,0,.07),(.2,.06,.05),gold)
    box(r,'Knife blade',(0,0,.3),(.12,.045,.4),steel)
    cone(r,'Sharp taper',(0,0,.53),.08,.16,steel)
    return r

def make_club(r,mats):
    steel,gold,wood,glow,dark=mats
    cyl(r,'Wooden handle',(0,0,.15),.065,.5,wood,verts=10)
    ico(r,'Club head',(0,0,.58),(.26,.22,.28),steel)
    for i in range(6):
        angle=i*math.pi/3
        cone(r,'Club stud',(math.cos(angle)*.18,math.sin(angle)*.17,.62),.045,.16,gold)
    return r

def make_shears(r,mats):
    steel,gold,wood,glow,dark=mats
    for side in [-1,1]:
        torus(r,'Shear finger loop',(side*.13,0,.0),.14,.027,gold,(0,math.pi/2,0))
        box(r,'Shear blade',(side*.09,-.01,.46),(.055,.04,.68),steel,(0,side*.19,0))
    ico(r,'Shear pivot',(0,-.035,.22),(.08,.045,.08),glow)
    return r

def make_nunchaku(r,mats):
    steel,gold,wood,glow,dark=mats
    for i,(x,z) in enumerate([(-.13,.04),(.15,.22)]):
        cyl(r,f'Nunchaku baton {i}',(x,0,z),.052,.47,wood,(0,.1*i,0),10)
        torus(r,f'Baton band {i}',(x,0,z+.12),.057,.012,gold)
    for i in range(4):
        sphere(r,f'Link chain {i}',(-.13+i*.07,0,.14+i*.045),(.025,.025,.025),steel)
    return r

def make_tentacle(r,mats):
    steel,gold,wood,glow,dark=mats
    for i in range(8):
        t=i/7
        x=.27*math.sin(t*math.pi)
        z=.05+t*.78
        sphere(r,f'Octopus tentacle segment {i}',(x,-.04,z),(.12*(1-t*.6),.12*(1-t*.6),.12*(1-t*.6)),steel)
    return r

def make_twin_pistol(r,mats):
    make_gun(r,mats,'blaster')
    return r

def build_kind(root, kind, mats):
    if kind in ('sword','katana','cyber_blade','giant_sword','scimitar'):
        return make_sword(root,mats,kind,1.15 if kind=='giant_sword' else 1.0)
    if kind in ('blaster','rifle','shotgun','plasma_rifle','pistol'):
        return make_gun(root,mats,'rifle' if kind=='plasma_rifle' else kind)
    if kind in ('gauntlet','energy_gauntlet','repulsor','alchemy_glove','energy_construct','lightning','claws'):
        return make_gauntlet(root,mats,kind)
    if kind in ('trident','staff','wand'):
        return make_staff(root,mats,kind)
    if kind=='whip': return make_whip(root,mats)
    if kind=='war_fan': return make_fan(root,mats)
    if kind=='shield': return make_shield(root,mats)
    if kind in ('ki_orb','spellrings','psychic_focus'): return make_orb(root,mats,kind)
    if kind=='book': return make_book(root,mats)
    if kind=='knife': return make_knife(root,mats)
    if kind=='club': return make_club(root,mats)
    if kind=='shears': return make_shears(root,mats)
    if kind=='nunchaku': return make_nunchaku(root,mats)
    if kind=='tentacle': return make_tentacle(root,mats)
    if kind=='hammer':
        make_sword(root,mats,'sword',.62)
        box(root,'Hammer head',(0,0,.83),(.55,.3,.36),mats[0])
        box(root,'Hammer face',(0,-.16,.83),(.37,.05,.24),mats[1])
        return root
    return make_gauntlet(root,mats,'gauntlet')

# key, display label, right-hand item, optional left-hand item, metal, accent, grip material
WEAPONS = {
'the_rock':('Black Adam · lightning gauntlets','lightning',None,0x34343a,0xf2c94c,0x191b22),
'samuel_l_jackson':('Nick Fury · S.H.I.E.L.D. sidearm','blaster',None,0x394553,0x77c6ef,0x1e232b),
'bruce_lee':('Bruce Lee · nunchaku','nunchaku',None,0x9f763d,0xf2cb76,0x5c311c),
'jean_claude_van_damme':('Johnny Cage · impact knuckles','energy_gauntlet',None,0xb8a16b,0xffe17a,0x3e2d24),
'lucy_liu':('O-Ren Ishii · white katana','katana',None,0xbac5cf,0xd7dce5,0x25242b),
'sigourney_weaver':('Ripley · pulse rifle','rifle',None,0x3d4a42,0xd0aa5a,0x24272b),
'keanu_reeves':('Silverhand · cyber blade','cyber_blade',None,0xb5c2cf,0x57dced,0x28282e),
'burt_reynolds':('Omni-Man · Viltrumite strike gauntlet','energy_gauntlet',None,0xe7e5dd,0xc53242,0x8a202c),
'grace_jones':('Nagini · snake whip','whip',None,0x352b35,0xdab866,0x14151b),
'arnold_schwarzenegger':('T-800 · heavy shotgun','shotgun',None,0x7d858c,0xc44939,0x242930),
'superman':('Superman · solar impact gauntlet','energy_gauntlet',None,0xb1b7bf,0xc42a3b,0x164b90),
'iron_man_tony_stark':('Iron Man · Mark-style repulsor','repulsor',None,0xc4b3a0,0x59dcff,0x801f25),
'hulk_bruce_banner':('Hulk · gamma knuckle','gauntlet',None,0x526e4a,0x70d35f,0x412449),
'green_lantern_hal_jordan':('Green Lantern · construct projector','energy_construct',None,0x3b5146,0x4bf59d,0x153b31),
'wolverine_logan':('Wolverine · adamantium claws','claws','claws',0xc8d0d6,0xf1c839,0x22262b),
'wonder_woman':('Wonder Woman · Amazon sword','sword','shield',0xc7ab73,0xe9bf50,0x7a202b),
'professor_x_charles_xavier':('Professor X · psychic focus','psychic_focus',None,0xa8adb5,0x73d9ef,0x434c58),
'the_flash_barry_allen':('The Flash · speed-force gauntlet','lightning',None,0xb8b8bc,0xffd348,0x93232a),
'aquaman':('Aquaman · Atlantean trident','trident',None,0xb68c43,0x53c6c2,0x195747),
'doctor_strange':('Doctor Strange · spell rings','spellrings',None,0xb88f48,0xffb652,0x5c272a),
'thor':('Thor · Mjolnir','hammer',None,0xaeb7c3,0x79c8ff,0x513321),
'goku':('Goku · ki focus','ki_orb',None,0xc3b4a1,0xff8b2a,0x285e9c),
'naruto_uzumaki':('Naruto · kunai','knife','ki_orb',0x97a3af,0x48aaff,0x262930),
'vegeta':('Vegeta · energy gauntlet','energy_gauntlet',None,0xe2e4e8,0x3caaff,0x1a3b69),
'saitama':('Saitama · impact glove','gauntlet',None,0xb9b6b2,0xd0d0d0,0xb22c2e),
'l_death_note_style':('L · Death Note','book',None,0x363842,0xd0d0d0,0x111319),
'levi_ackerman':('Levi · dual blades','katana','katana',0xbcc6d1,0x8fa7ba,0x2f3a44),
'edward_elric':('Edward Elric · alchemy glove','alchemy_glove',None,0x9eacba,0xc72d38,0x252a32),
'roronoa_zoro':('Roronoa Zoro · three-sword kit','katana','katana',0xb9c3cc,0x51975a,0x303a35),
'all_might':('All Might · Detroit smash gauntlet','gauntlet',None,0xcba744,0x3975ba,0x9a2635),
'jotaro_kujo':('Jotaro · Star Platinum fist aura','energy_construct',None,0x6c5e9e,0xa18af1,0x273054),
'mario':('Mario · fire-flower glove','lightning',None,0xb5a9a0,0xe94737,0x2a4d94),
'luigi':('Luigi · Poltergust nozzle','blaster',None,0x84918d,0x56d68b,0x2f5b41),
'solid_snake':('Solid Snake · tranquilizer sidearm','blaster',None,0x707e8a,0x9eacb7,0x444a54),
'geralt_of_rivia':('Geralt · steel sword','sword','sword',0xbfc6ce,0x9db8c8,0x303238),
'kratos':('Kratos · Leviathan axe','axe',None,0x9ba8b2,0x5aafdf,0x5a3328),
'link':('Link · Master Sword','sword','shield',0xc2ccd5,0x58b8f4,0x28643f),
'lara_croft':('Lara Croft · dual pistols','pistol','pistol',0x8e9ba6,0x8a9da9,0x252930),
'sephiroth':('Sephiroth · Masamune','giant_sword',None,0xd6d9dd,0x8b9aaa,0x161a22),
'master_chief':('Master Chief · battle rifle','plasma_rifle',None,0x67734d,0xd7bb68,0x344136),
'doom_slayer':('Doom Slayer · super shotgun','shotgun',None,0x596653,0x9dac96,0x343a31),
'shrek':('Shrek · swampwood club','club',None,0x725b3f,0xb0a17a,0x543d27),
'aladdin':('Aladdin · curved scimitar','scimitar',None,0xc79d48,0xefcf77,0x5a3827),
'ariel':('Ariel · sea trident','trident',None,0xcdb47a,0x4dd1bb,0x24695d),
'ursula':('Ursula · sea-witch tentacle','tentacle',None,0x61417c,0xbda0db,0x2b183a),
'edna_mode':('Edna Mode · tailor shears','shears',None,0xb6b7b8,0xe8e5df,0x1a1a1c),
'captain_jack_sparrow':('Jack Sparrow · cutlass','sword',None,0xa8b0b9,0xb98f52,0x292a32),
'sesshomaru':('Sesshomaru · Tokijin blade','katana',None,0xd0d6dd,0xb7a3cd,0xf0ece6),
'norman_bates':('Norman Bates · kitchen knife','knife',None,0xbfc8d0,0xc5a4a0,0x59483c),
'han_solo':('Han Solo · DL-style blaster','blaster',None,0x8c9ba8,0x79dfff,0x32343a),
'indiana_jones':('Indiana Jones · bullwhip','whip',None,0x69503b,0x9e7a48,0x4a2e1f),
'lord_voldemort':('Voldemort · Elder Wand','wand',None,0x6f665c,0xbeb8ad,0x312b25),
'sasuke_uchiha':('Sasuke Uchiha · chokutō and lightning','katana','lightning',0xaab5c0,0x59a9f7,0x1a2030),
'hashirama_senju':('Hashirama Senju · wood-style staff','staff',None,0x765840,0x93b580,0x503824),
'madara_uchiha':('Madara Uchiha · Gunbai war fan','war_fan','katana',0x8c6d56,0x9a292b,0x30262a)
}

DISPLAY_POS = {}
keys=list(WEAPONS.keys())
columns=9
for index,key in enumerate(keys):
    row=index//columns
    col=index%columns
    DISPLAY_POS[key]=( (col-(columns-1)/2)*4.2, 0, -row*4.1)
weapon_roots=[]
for key, info in WEAPONS.items():
    label,right_kind,left_kind,metal_hex,accent_hex,grip_hex=info
    metallic=mat(f'{key} · metal',rgb(metal_hex),.78,.26)
    gold=mat(f'{key} · trim',rgb(accent_hex),.62,.28,.15 if right_kind in ('repulsor','energy_construct','lightning','ki_orb','spellrings','psychic_focus') else 0)
    wood=mat(f'{key} · grip',rgb(grip_hex),.12,.74)
    glow=mat(f'{key} · energy',rgb(accent_hex),.26,.2,2.0 if right_kind in ('repulsor','energy_construct','lightning','ki_orb','spellrings','psychic_focus') else .55)
    dark=mat(f'{key} · dark parts',(0.055,0.065,0.08),.35,.42)
    mats=(metallic,gold,wood,glow,dark)
    display=DISPLAY_POS[key]
    right=root_for(key,'right',label,display)
    build_kind(right,right_kind,mats)
    weapon_roots.append(right)
    if left_kind:
        left=root_for(key,'left',label+' · offhand', (display[0]+1.2,display[1],display[2]))
        build_kind(left,left_kind,mats)
        weapon_roots.append(left)

# Presentation pedestals/labels are for the editable .blend only and excluded from the GLB.
gallery=bpy.data.collections.new('Weapon Gallery · Blender presentation only')
bpy.context.scene.collection.children.link(gallery)
for index,key in enumerate(keys):
    x,y,z=DISPLAY_POS[key]
    info=WEAPONS[key]
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x,y,z-.36))
    plinth=bpy.context.object;plinth.name=f'Display plinth · {key}';plinth.scale=(2.0,.62,.18)
    plinth.data.materials.append(mat('Gallery charcoal',(.055,.065,.08),.25,.52))
    # Move it out of the export-selectable scene collection into the preview collection.
    for col in list(plinth.users_collection): col.objects.unlink(plinth)
    gallery.objects.link(plinth)
    curve=bpy.data.curves.new(f'Label · {key}','FONT')
    curve.body=info[0]
    curve.size=.25
    curve.extrude=.002
    text_obj=bpy.data.objects.new(f'Label · {key}',curve)
    gallery.objects.link(text_obj);text_obj.location=(x-1.8,y-.38,z-.52)
    text_obj.data.materials.append(mat('Warm labels',(0.9,.78,.55),.12,.55))

# Scene camera and lights for inspecting all the library models inside Blender.
bpy.ops.object.camera_add(location=(0,25,18))
camera=bpy.context.object;camera.name='Weapon gallery camera'
direction=__import__('mathutils').Vector((0,-10,-12))-camera.location
camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
camera.data.lens=38
bpy.context.scene.camera=camera
bpy.ops.object.light_add(type='AREA', location=(2,2,19))
keylight=bpy.context.object;keylight.data.energy=4200;keylight.data.shape='DISK';keylight.data.size=16
bpy.ops.object.light_add(type='AREA', location=(-17,-7,8))
fill=bpy.context.object;fill.data.energy=2400;fill.data.color=(.46,.65,1);fill.data.size=12
bpy.ops.object.light_add(type='AREA', location=(18,-9,8))
rim=bpy.context.object;rim.data.energy=2700;rim.data.color=(1,.68,.35);rim.data.size=10

scene=bpy.context.scene
scene.render.engine='CYCLES'
scene.cycles.samples=32
scene.render.resolution_x=1920
scene.render.resolution_y=1080
scene.view_settings.view_transform='AgX'
try: scene.view_settings.look='AgX - Medium High Contrast'
except Exception: pass
scene.world.color=(.035,.04,.055)
scene.render.image_settings.file_format='PNG'
scene.render.filepath=os.path.join(ROOT,'character_weapons_gallery.png')

# Export compact game pack: only all named right/left weapon root trees, each rooted at zero.
bpy.ops.object.select_all(action='DESELECT')
for index,key in enumerate(keys):
    display=DISPLAY_POS[key]
    for hand in ('right','left'):
        obj=bpy.data.objects.get(f'weapon_{key}_{hand}')
        if obj:
            obj.location=(0,0,0)
            obj.select_set(True)
            for child in obj.children_recursive:
                child.select_set(True)
# Set an appropriate active root for the exporter.
active=bpy.data.objects.get('weapon_the_rock_right')
if active:
    bpy.context.view_layer.objects.active=active
os.makedirs(os.path.dirname(OUT_GLB),exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT_GLB, export_format='GLB', use_selection=True,
                          export_yup=True, export_apply=True, export_materials='EXPORT',
                          export_image_format='AUTO', export_texcoords=True, export_normals=True,
                          export_cameras=False, export_lights=False, export_extras=True)
# Restore gallery positions so the .blend opens as a laid-out reference library.
for key in keys:
    for hand in ('right','left'):
        obj=bpy.data.objects.get(f'weapon_{key}_{hand}')
        if obj:
            display=DISPLAY_POS[key]
            obj.location=display if hand=='right' else (display[0]+1.2,display[1],display[2])
# Organize view layer hierarchy and save the editable library.
bpy.ops.object.select_all(action='DESELECT')
for obj in weapon_roots:
    obj.select_set(True)
if weapon_roots: bpy.context.view_layer.objects.active=weapon_roots[0]
bpy.ops.wm.save_as_mainfile(filepath=OUT_BLEND)
print(f'Weapon library built: {len(WEAPONS)} characters, {len(weapon_roots)} hand-set prefabs')
print(f'Blend: {OUT_BLEND}')
print(f'GLB: {OUT_GLB}')
