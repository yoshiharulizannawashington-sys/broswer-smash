"""Extract Link's back-mounted Master Sword and Hylian Shield as static props.
Usage: blender -b --python scripts/extract-link-equipment.py -- <link-rigged.glb> <outdir>
"""
import bpy, os, sys
from mathutils import Vector
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
SRC,OUTDIR=argv[0],argv[1]
os.makedirs(os.path.abspath(OUTDIR),exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
targets={'Object_222':'link_sword','Object_232':'link_shield'}
for name,label in targets.items():
    src=bpy.data.objects[name]
    # Evaluate in rest pose and bake the armature deformation into a static mesh.
    dg=bpy.context.evaluated_depsgraph_get()
    ev=src.evaluated_get(dg)
    me=bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    obj=bpy.data.objects.new(label,me)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world=src.matrix_world.copy()
    obj.parent=None
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # Keep only this object selected for the export.
    for o in bpy.context.view_layer.objects:
        o.select_set(o is obj)
    bpy.context.view_layer.objects.active=obj
    out=os.path.abspath(os.path.join(OUTDIR,label+'.glb'))
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,
        export_apply=True,export_animations=False,export_yup=True)
    pts=[obj.matrix_world @ v.co for v in obj.data.vertices]
    mn=Vector([min(p[i] for p in pts) for i in range(3)]); mx=Vector([max(p[i] for p in pts) for i in range(3)])
    print('EXPORTED',label,out,'MIN',*[round(x,4) for x in mn],'MAX',*[round(x,4) for x in mx])
