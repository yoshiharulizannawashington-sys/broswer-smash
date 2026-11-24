"""Map the supplied Smash Link skeleton onto the canonical roster joint names.

The supplied hierarchy is Clavicle -> Shoulder -> Arm -> Hand, but its *Shoulder* bone is the
upper arm, *Arm* is the forearm and *Hand* is the wrist. Renaming those three levels gives the
retargeter the 19 canonical joints it needs without adding or discarding any deform bone.

  blender -b --python scripts/upgrade-link-rig.py -- <clean.glb> <out.glb>
"""
import bpy, os, sys

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))

rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
meshes = [o for o in bpy.data.objects if o.type == 'MESH']

RENAME = {
    'Hip_06': 'Hips', 'Waist_07': 'Spine', 'Bust_08': 'Chest',
    'Neck_09': 'Neck', 'Head_010': 'Head',
    'ClavicleL_055': 'LeftShoulder', 'ClavicleR_084': 'RightShoulder',
    # The FBX's Shoulder/Arm/Hand chain is upper arm / forearm / wrist. Its vertices confirm it:
    # Shoulder covers the upper arm, Arm covers the forearm, Hand covers the wrist.
    'ShoulderL_056': 'LeftArm', 'ShoulderR_085': 'RightArm',
    'ArmL_057': 'LeftForeArm', 'ArmR_086': 'RightForeArm',
    'HandL_058': 'LeftHand', 'HandR_087': 'RightHand',
    'LegL_0118': 'LeftUpLeg', 'LegR_0122': 'RightUpLeg',
    'KneeL_0119': 'LeftLeg', 'KneeR_0123': 'RightLeg',
    'FootL_0120': 'LeftFoot', 'FootR_0124': 'RightFoot',
}
for old, new in RENAME.items():
    bone = rig.data.bones.get(old)
    if bone:
        bone.name = new
    for obj in meshes:
        group = obj.vertex_groups.get(old)
        if group:
            group.name = new

# Remove any duplicate helper armature/empty roots left from the two-skin Sketchfab export. Their
# names would otherwise collide with the retained skeleton and make animation tracks ambiguous.
for obj in list(bpy.data.objects):
    if obj.type == 'ARMATURE' and obj is not rig:
        bpy.data.objects.remove(obj, do_unlink=True)
    elif obj.type == 'EMPTY' and obj.name in ('Armature.001', 'Object_493', 'Object_495'):
        bpy.data.objects.remove(obj, do_unlink=True)

bpy.context.view_layer.update()
print('RIG', rig.name)
print('BONES', len(rig.data.bones), [b.name for b in rig.data.bones if b.name in ('Hips','Spine','Chest','Neck','Head','LeftShoulder','LeftArm','LeftForeArm','LeftHand','LeftUpLeg','LeftLeg','LeftFoot','RightShoulder','RightArm','RightForeArm','RightHand','RightUpLeg','RightLeg','RightFoot')])
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_apply=False,
                          export_animations=False, export_yup=True)
print('WROTE', OUT)
