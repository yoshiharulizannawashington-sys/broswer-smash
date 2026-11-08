"""Measure skeletal and mesh deformation for every clip, including tearing.

Bone rotation and vertex displacement alone do not prove a usable skin: a mesh can move while tearing,
or move because its vertices are being dragged by the wrong bone. This reports, per clip:

  * bones moving and peak bone rotation
  * per-mesh vertex displacement (which body parts actually follow the rig)
  * edge stretch: the worst pose/rest edge-length ratio, which is what a torn or smeared skin shows
  * a verdict, so an unacceptable result cannot be read as a pass

Usage:
  blender -b --python scripts/blender_check_deform.py -- <model.glb> [clip ...]
"""

import json
import math
import re
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
SOURCE = argv[0]
WANTED = [name.lower() for name in argv[1:]]
STRETCH_LIMIT = 1.9

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SOURCE)
rig = next((o for o in bpy.data.objects if o.type == "ARMATURE"), None)
if not rig:
    print("RESULT:" + json.dumps({"ok": False, "error": "no armature"}))
    raise SystemExit(0)
meshes = [
    o for o in bpy.data.objects
    if o.type == "MESH" and any(m.type == "ARMATURE" and m.object == rig for m in o.modifiers)
]
if not meshes:
    print("RESULT:" + json.dumps({"ok": False, "error": "no skinned mesh"}))
    raise SystemExit(0)

rig.animation_data_create()
for track in rig.animation_data.nla_tracks:
    track.mute = True
rig.animation_data.action = None
bpy.context.scene.frame_set(0)
bpy.context.view_layer.update()

# Rest edge lengths, per mesh, from the undeformed topology.
rest_edges = []
for obj in meshes:
    lengths = []
    for edge in obj.data.edges:
        a = obj.data.vertices[edge.vertices[0]].co
        b = obj.data.vertices[edge.vertices[1]].co
        lengths.append((edge.vertices[0], edge.vertices[1], (a - b).length))
    rest_edges.append(lengths)


def sample():
    depsgraph = bpy.context.evaluated_depsgraph_get()
    out = []
    for obj in meshes:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        out.append([v.co.copy() for v in mesh.vertices])
        evaluated.to_mesh_clear()
    return out


rest_vertices = sample()
rest_rotations = {b.name: b.matrix.to_quaternion() for b in rig.pose.bones}

results = {}
for action in sorted(bpy.data.actions, key=lambda a: a.name):
    label = re.sub(r"_(?:Kaze_)?Rig$", "", action.name)
    if WANTED and not any(label.lower() == w or action.name.lower().startswith(w) for w in WANTED):
        continue
    start, end = [int(round(v)) for v in action.frame_range]
    if end <= start:
        continue
    rig.animation_data.action = action
    per_bone = {}
    per_mesh = {obj.name: 0.0 for obj in meshes}
    worst_stretch = 0.0
    worst_edge_rest = 0.0
    worst_edge = None
    stretched_edges = 0
    for frame in sorted({start, start + (end - start) // 3, start + 2 * (end - start) // 3, end}):
        bpy.context.scene.frame_set(frame)
        bpy.context.view_layer.update()
        for name, rotation in {b.name: b.matrix.to_quaternion() for b in rig.pose.bones}.items():
            degrees = math.degrees(rest_rotations[name].rotation_difference(rotation).angle)
            per_bone[name] = max(per_bone.get(name, 0.0), degrees)
        posed = sample()
        for index, obj in enumerate(meshes):
            rest_part = rest_vertices[index]
            pose_part = posed[index]
            for rest_vertex, pose_vertex in zip(rest_part, pose_part):
                distance = (rest_vertex - pose_vertex).length
                if distance > per_mesh[obj.name]:
                    per_mesh[obj.name] = distance
            for a, b, rest_length in rest_edges[index]:
                if rest_length < 1e-5:
                    continue
                pose_length = (pose_part[a] - pose_part[b]).length
                ratio = pose_length / rest_length
                if ratio > worst_stretch:
                    worst_stretch = ratio
                    worst_edge_rest = rest_length
                    worst_edge = (index, a, b, rest_length, pose_length)
                if ratio > 1.5:
                    stretched_edges += 1
    moved = sum(1 for value in per_bone.values() if value > 1.0)
    max_displacement = max(per_mesh.values()) if per_mesh else 0.0
    verdict = "pass"
    if moved < 8 or max_displacement < 0.02:
        verdict = "static"
    elif worst_stretch > STRETCH_LIMIT:
        verdict = "torn"
    offending = None
    if worst_edge:
        mesh_index, vertex_a, vertex_b, rest_length, pose_length = worst_edge
        edge_obj = meshes[mesh_index]
        group_names = {g.index: g.name for g in edge_obj.vertex_groups}

        def top_bones(vertex_index):
            vertex = edge_obj.data.vertices[vertex_index]
            pairs = [(group_names.get(g.group, '?'), round(g.weight, 2)) for g in vertex.groups]
            return [name for name, _ in sorted(pairs, key=lambda item: -item[1])[:3]]

        offending = {
            "mesh": edge_obj.name,
            "restMeters": round(rest_length, 4),
            "poseMeters": round(pose_length, 3),
            "ratio": round(worst_stretch, 2),
            "bonesA": top_bones(vertex_a),
            "bonesB": top_bones(vertex_b),
        }
    results[label] = {
        "worstEdge": offending,
        "frames": [start, end],
        "bonesMoved": moved,
        "maxBoneDegrees": round(max(per_bone.values()) if per_bone else 0.0, 1),
        "maxVertexMeters": round(max_displacement, 3),
        "perMesh": {name: round(value, 3) for name, value in per_mesh.items()},
        "maxEdgeStretch": round(worst_stretch, 2),
        "worstEdgeRestMeters": round(worst_edge_rest, 4),
        "edgesOver150pct": stretched_edges,
        "verdict": verdict,
    }

rig.animation_data.action = None
failing = [name for name, data in results.items() if data["verdict"] != "pass"]
print("RESULT:" + json.dumps({
    "ok": True,
    "file": SOURCE,
    "bones": len(rig.pose.bones),
    "skinnedMeshes": len(meshes),
    "clips": results,
    "failing": failing,
    "passed": not failing,
}))
