"""Remove the back-mounted sword, shield and scabbard from the Smash Link body so the game's
existing right/left equipment mounts own those props. The quiver and its arrows stay on the back.
Usage: blender -b --python scripts/strip-link-sheathed-gear.py -- <in.glb> <out.glb>
"""
import bpy, os, sys
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC, OUT = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
# In this supplied export: Object_216 is the scabbard, Object_222 the Master Sword, Object_232
# the Hylian Shield. They are all skinned to the back, so leaving them would duplicate the
# separately mounted equipment and make the sword swing around the hand.
removed = []
for name in ('Object_216', 'Object_222', 'Object_232'):
    obj = bpy.data.objects.get(name)
    if obj:
        removed.append(name)
        bpy.data.objects.remove(obj, do_unlink=True)
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=os.path.abspath(OUT), export_format='GLB', export_apply=False,
                          export_animations=False, export_yup=True)
print('REMOVED', removed)
print('WROTE', OUT)
