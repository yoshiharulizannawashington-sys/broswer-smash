"""Probe whether Blender can import the imported Goku rig without moving the mesh.

The repaired body's node hierarchy carries a 100 scale on the Armature node and 0.01 on the FBX
wrapper. Blender applies the first without the second, which puts the rest skeleton ~94 m from the
mesh. This prints the actual numbers so the render pipeline can be planned from measurement rather
than assumption, and it tries the one corrective that would keep skinning intact: importing with the
original bind pose and measuring the deformed mesh instead of the bone sticks.

    bash scripts/blender.sh -b --python scripts/blender-goku-probe.py -- <body.glb> <clips.glb>
"""
import json
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
body = argv[0] if argv else "public/models/characters/bespoke/goku_body.glb"
clips = argv[1] if len(argv) > 1 else "public/models/characters/bespoke/goku_animated.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=body)

report = {"body": body, "objects": []}
armature = None
for obj in bpy.data.objects:
    entry = {"name": obj.name, "type": obj.type, "scale": [round(v, 4) for v in obj.scale],
             "location": [round(v, 4) for v in obj.location]}
    if obj.type == "MESH":
        points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        entry["worldBounds"] = {
            "min": [round(min(p[i] for p in points), 3) for i in range(3)],
            "max": [round(max(p[i] for p in points), 3) for i in range(3)],
        }
        entry["verts"] = len(obj.data.vertices)
        entry["armatureModifier"] = [m.object.name for m in obj.modifiers if m.type == "ARMATURE"]
    if obj.type == "ARMATURE":
        armature = obj
        entry["bones"] = len(obj.data.bones)
        heads = [obj.matrix_world @ bone.head_local for bone in obj.data.bones]
        entry["boneHeadBounds"] = {
            "min": [round(min(h[i] for h in heads), 3) for i in range(3)],
            "max": [round(max(h[i] for h in heads), 3) for i in range(3)],
        }
    report["objects"].append(entry)

# Deformed-mesh measurement: evaluate the depsgraph so the armature modifier is applied.
if armature:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    deformed = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        if mesh.vertices:
            world = [evaluated.matrix_world @ v.co for v in mesh.vertices]
            deformed[obj.name] = {
                "min": [round(min(p[i] for p in world), 3) for i in range(3)],
                "max": [round(max(p[i] for p in world), 3) for i in range(3)],
            }
        evaluated.to_mesh_clear()
    report["evaluatedMeshBounds"] = deformed

    # Try the documented corrective: scale the armature object's *data* only.
    before = [armature.matrix_world @ b.head_local for b in armature.data.bones]
    armature.data.transform(__import__("mathutils").Matrix.Scale(0.01, 4))
    after = [armature.matrix_world @ b.head_local for b in armature.data.bones]
    report["scaleCorrective"] = {
        "beforeMaxX": round(max(h.x for h in before), 2),
        "afterMaxX": round(max(h.x for h in after), 2),
        "note": "data.transform rescales bone rest matrices; skinning will be re-evaluated below",
    }
    depsgraph = bpy.context.evaluated_depsgraph_get()
    scaled = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        if mesh.vertices:
            world = [evaluated.matrix_world @ v.co for v in mesh.vertices]
            scaled[obj.name] = {
                "min": [round(min(p[i] for p in world), 3) for i in range(3)],
                "max": [round(max(p[i] for p in world), 3) for i in range(3)],
            }
        evaluated.to_mesh_clear()
    report["scaledEvaluatedBounds"] = scaled

# Does the clip-only GLB import as a posable armature with named bones?
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=clips)
clipReport = {"clips": clips, "armatures": [], "actions": [a.name for a in bpy.data.actions]}
for obj in bpy.data.objects:
    if obj.type == "ARMATURE":
        clipReport["armatures"].append({
            "name": obj.name,
            "bones": len(obj.data.bones),
            "hasHips": bool(obj.data.bones.get("Hips")),
            "hasRightHand": bool(obj.data.bones.get("RightHand")),
        })
report["clipFile"] = clipReport

print("PROBE_JSON " + json.dumps(report))
