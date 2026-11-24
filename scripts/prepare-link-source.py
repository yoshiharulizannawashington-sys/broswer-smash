"""Clean the supplied Smash Link GLB: drop Sketchfab helper spheres, the duplicate eye
armature/meshes, and scale the one retained body skeleton to the roster's 1.79 m body height.
This changes the asset, never its textures or skin weights."""
import bpy, os, sys
from mathutils import Vector

SRC = os.path.abspath('artifacts/asset-fetch/4a3d7152e1ea4e80b6f32a7d1f7c1626/processed/link-pbr.glb')
OUT = os.path.abspath('artifacts/link-upgrade/link-clean.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# Sketchfab exports two 2 m empty-material Icospheres unrelated to the character.
for obj in list(bpy.data.objects):
    if obj.type == 'MESH' and obj.name.startswith('Icosphere'):
        bpy.data.objects.remove(obj, do_unlink=True)

# The model ships two copies of the eye mesh under a second armature. The body armature already
# owns a complete eye pair; keep that one so every node name is unique for runtime animation tracks.
for name in ('Object_494', 'Object_496', 'Object_234', 'Armature.001', 'Object_493', 'Object_495'):
    obj = bpy.data.objects.get(name)
    if obj:
        bpy.data.objects.remove(obj, do_unlink=True)
# Drop empty helper roots left behind by the removed duplicate meshes; the exporter would otherwise
# emit their names again and animations cannot address duplicate node names.
for obj in list(bpy.data.objects):
    if obj.type == 'EMPTY' and not obj.children and obj.name not in ('Sketchfab_model', 'RootNode', 'link.fbx'):
        bpy.data.objects.remove(obj, do_unlink=True)
for arm in list(bpy.data.armatures):
    if arm.users == 0:
        bpy.data.armatures.remove(arm)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
mins = [1e9] * 3; maxs = [-1e9] * 3
for obj in meshes:
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        for i in range(3): mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
height = maxs[2] - mins[2]
print('SOURCE_HEIGHT', height, 'RIG', rig.name)

# Scale the skeleton and every mesh as one object hierarchy. Applying the transform before export
# bakes the scale into positions and inverse-bind matrices rather than leaving a 3.6x root node.
# Keep the author's source units: the runtime mounts every imported fighter at its own
# measured height, so changing the geometry here would only fight that normalisation.

mins = [1e9] * 3; maxs = [-1e9] * 3
for obj in meshes:
    for corner in obj.bound_box:
        w = obj.matrix_world @ Vector(corner)
        for i in range(3): mins[i] = min(mins[i], w[i]); maxs[i] = max(maxs[i], w[i])
print('FINAL_HEIGHT', maxs[2]-mins[2], 'WIDTH', maxs[0]-mins[0])
print('ARMATURES', [o.name for o in bpy.data.objects if o.type == 'ARMATURE'])
print('MESHES', [(o.name, len(o.data.vertices)) for o in meshes])

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=False,
                          export_animations=False, export_yup=True)
print('WROTE', OUT)
