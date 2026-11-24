import bpy, os, sys, json, importlib.util
from mathutils import Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('konoha_asm', os.path.join(HERE, 'konoha_landmark_lib.py'))
asm = importlib.util.module_from_spec(spec); spec.loader.exec_module(asm)
argv = sys.argv[sys.argv.index('--') + 1:]
mountain_path, office_path, blend_out = argv
asm.reset()
parts = asm.import_glb(mountain_path)
source_tris = sum(asm.triangles(o) for o in parts)
for o in parts:
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True); bpy.context.view_layer.objects.active = o
    mod = o.modifiers.new('runtime-lod', 'DECIMATE')
    mod.ratio = 0.32
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
mountain = asm.join_meshes(parts, 'konoha_hokage_mountain')
asm.normalize(mountain, target_width=asm.MOUNTAIN_WIDTH_M)
mountain.location = (0, 185, 0)
office_parts = asm.import_glb(office_path)
keep = ('Office_lambert1_0','Silo_lambert8_0','Silo1_lambert8_0','Pole_lambert7_0','Pole1_lambert7_0','Pole2_lambert7_0')
selected = [o for o in office_parts if o.name in keep]
for o in list(office_parts):
    if o not in selected:
        bpy.data.objects.remove(o, do_unlink=True)
office = asm.join_meshes(selected, 'konoha_hokage_office')
asm.normalize(office, target_height=asm.OFFICE_HEIGHT_M)
office.location = (46, 88, 0)
for o in (mountain, office):
    while len(o.data.uv_layers) > 1:
        o.data.uv_layers.remove(o.data.uv_layers[-1])
    print('UVS', o.name, len(o.data.uv_layers), 'verts', len(o.data.vertices), 'tris', asm.triangles(o))
asm.cap_textures()
bpy.context.view_layer.update()
report = {
  'stage': 'blend', 'blend': os.path.abspath(blend_out),
  'sourceTriangles': source_tris,
  'mountain': {'triangles': asm.triangles(mountain), 'sizeM': [round(v,2) for v in (asm.bounds(mountain)[1]-asm.bounds(mountain)[0])], 'location': list(mountain.location)},
  'office': {'triangles': asm.triangles(office), 'sizeM': [round(v,2) for v in (asm.bounds(office)[1]-asm.bounds(office)[0])], 'location': list(office.location)},
  'materials': len(bpy.data.materials), 'images': len(bpy.data.images)
}
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend_out))
print('KONOHA_BLEND_RESULT:' + json.dumps(report))
with open(os.path.join(os.path.dirname(os.path.abspath(blend_out)), 'blend-report.json'), 'w') as fh:
    json.dump(report, fh, indent=2); fh.write('\n')
