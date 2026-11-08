"""Delete-only repair of the CC0 Quaternius mannequin, plus a restricted selected-object export.

Nothing is welded, merged, dissolved, normal-recalculated or transformed: the only geometry change is
removing faces whose area is zero, with BMesh context="FACES" so vertices and edges survive. The
export selects the armature and only the meshes bound to it, because the earlier bounds failure came
from exporting every object in the scene (an 80-triangle Icosphere inflated the width).

Usage:
  blender -b --python scripts/repair_quaternius_mannequin.py -- <src.glb> <out.glb>
"""

import json
import sys

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SRC, OUT = argv[0], argv[1]
EPS = 1e-9

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
scene = bpy.context.scene

inventory = []
for o in scene.objects:
    entry = {"name": o.name, "type": o.type, "parent": o.parent.name if o.parent else None}
    if o.type == "MESH":
        entry.update({
            "faces": len(o.data.polygons),
            "verts": len(o.data.vertices),
            "materials": [m.name for m in o.data.materials if m],
            "uvLayers": [uv.name for uv in o.data.uv_layers],
            "vgroups": len(o.vertex_groups),
            "armatureModifier": any(m.type == "ARMATURE" for m in o.modifiers),
            "dims": [round(v, 4) for v in o.dimensions],
        })
    inventory.append(entry)
print("INVENTORY " + json.dumps(inventory))

armatures = [o for o in scene.objects if o.type == "ARMATURE"]
meshes = [o for o in scene.objects if o.type == "MESH"]

report = []
for obj in meshes:
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    faces_before = len(bm.faces)
    boundary_before = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bad = [f for f in bm.faces if f.calc_area() < EPS]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES")
    faces_after = len(bm.faces)
    boundary_after = sum(1 for e in bm.edges if len(e.link_faces) == 1)
    bm.to_mesh(me)
    bm.free()
    me.update()
    report.append({
        "object": obj.name,
        "facesBefore": faces_before,
        "facesAfter": faces_after,
        "deleted": faces_before - faces_after,
        "boundaryBefore": boundary_before,
        "boundaryAfter": boundary_after,
        "verts": len(me.vertices),
        "vgroups": len(obj.vertex_groups),
        "materials": [m.name for m in me.materials if m],
        "uvLayers": [uv.name for uv in me.uv_layers],
        "armatureModifier": any(m.type == "ARMATURE" for m in obj.modifiers),
    })

# SELECTION-OK: only the mannequin itself. An armature modifier bound to the kept rig is the proof
# that a mesh belongs to this character; the stray Icosphere is a mesh too, and including it is
# exactly what inflated the width measurement last time.
keep = armatures + [
    o for o in meshes
    if any(m.type == "ARMATURE" and m.object in armatures for m in o.modifiers)
]
for o in scene.objects:
    o.select_set(False)
for o in keep:
    o.select_set(True)
if keep:
    bpy.context.view_layer.objects.active = keep[0]
print("SELECTED " + json.dumps([{"name": o.name, "type": o.type} for o in keep]))

# Bounds of the selection only, so an unselected stray object cannot contaminate the measurement.
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for obj in meshes:
    if obj not in keep:
        continue
    for corner in obj.bound_box:
        p = obj.matrix_world @ Vector(corner)
        lo = Vector((min(lo.x, p.x), min(lo.y, p.y), min(lo.z, p.z)))
        hi = Vector((max(hi.x, p.x), max(hi.y, p.y), max(hi.z, p.z)))
print("BOUNDS " + json.dumps({
    "width": round(hi.x - lo.x, 3),
    "height": round(hi.z - lo.z, 3),
    "depth": round(hi.y - lo.y, 3),
    "bones": len(armatures[0].data.bones) if armatures else 0,
}))
print("REPORT " + json.dumps(report))

bpy.ops.export_scene.gltf(
    filepath=OUT,
    export_format="GLB",
    use_selection=True,
    export_apply=False,
    export_animations=False,
    export_yup=True,
)
print("EXPORTED " + OUT)
