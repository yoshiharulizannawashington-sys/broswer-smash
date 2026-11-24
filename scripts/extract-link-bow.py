"""Split the supplied Bow of Light into a bow/string prop and a separate arrow prop."""
import bpy, os, sys
from mathutils import Vector
argv=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
SRC,OUTDIR=argv[0],argv[1]
os.makedirs(os.path.abspath(OUTDIR),exist_ok=True)
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(SRC))
def export(names,label):
    objs=[bpy.data.objects[n] for n in names]
    for o in bpy.context.view_layer.objects:o.select_set(o in objs)
    bpy.context.view_layer.objects.active=objs[0]
    # Bake the scene's transform into the selected meshes so the exported prop is static.
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    out=os.path.abspath(os.path.join(OUTDIR,label+'.glb'))
    bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,
        export_apply=True,export_animations=False,export_yup=True)
    pts=[]
    for o in objs:
        pts += [o.matrix_world @ v.co for v in o.data.vertices]
    mn=Vector([min(p[i] for p in pts) for i in range(3)]); mx=Vector([max(p[i] for p in pts) for i in range(3)])
    print('EXPORTED',label,out,'MIN',*[round(x,3) for x in mn],'MAX',*[round(x,3) for x in mx])
reset();export(['bow_bow_0','strings_strings_0'],'link_bow')
reset();export(['arrow_arrow_0'],'link_arrow')
