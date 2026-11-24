import bpy, os, sys, json
argv = sys.argv[sys.argv.index('--') + 1:]
blend, out = argv
bpy.ops.wm.open_mainfile(filepath=os.path.abspath(blend))
objs = [bpy.data.objects.get('konoha_hokage_mountain'), bpy.data.objects.get('konoha_hokage_office')]
if any(o is None for o in objs):
    raise RuntimeError('missing assembled Konoha objects')
bpy.ops.object.select_all(action='DESELECT')
for o in objs: o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.export_scene.gltf(filepath=os.path.abspath(out), export_format='GLB', use_selection=True, export_apply=True, export_materials='EXPORT', export_image_format='AUTO', export_yup=True, export_cameras=False, export_lights=False)
print('KONOHA_EXPORT_RESULT:' + json.dumps({'out': os.path.abspath(out), 'bytes': os.path.getsize(out), 'triangles': sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)}))
