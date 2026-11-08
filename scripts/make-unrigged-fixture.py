#!/usr/bin/env python3
"""Strip the skeleton from a rigged GLB, producing an unrigged humanoid fixture.

Used to prove the unrigged branch of the import pipeline with real geometry rather than a
hand-waved claim. Vertices, UVs, materials and world scale are preserved; only the armature,
skin weights and clips are removed.
"""
import sys
import bpy

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
if len(argv) < 2:
    raise SystemExit('usage: blender -b -P make-unrigged-fixture.py -- <in.glb> <out.glb>')
source, target = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source)

# Clear parenting without losing the world transform the armature applied, then drop the
# armature deform so the mesh keeps its authored shape at the imported scale.
meshes = [obj for obj in bpy.data.objects if obj.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
    if obj.parent:
        obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')

for obj in list(bpy.data.objects):
    if obj.type == 'ARMATURE':
        bpy.data.objects.remove(obj, do_unlink=True)

for obj in meshes:
    for modifier in list(obj.modifiers):
        if modifier.type == 'ARMATURE':
            obj.modifiers.remove(modifier)
    obj.vertex_groups.clear()

for action in list(bpy.data.actions):
    bpy.data.actions.remove(action)

# Apply the remaining object transforms so the exported vertex data is already in metres.
bpy.ops.object.select_all(action='DESELECT')
for obj in meshes:
    obj.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

dims = [tuple(round(value, 3) for value in obj.dimensions) for obj in meshes]
print('UNRIGGED_DIMS:' + repr(dims))

bpy.ops.export_scene.gltf(
    filepath=target,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
    export_animations=False,
    export_skins=False,
    export_yup=True,
)
print('UNRIGGED:' + target)
