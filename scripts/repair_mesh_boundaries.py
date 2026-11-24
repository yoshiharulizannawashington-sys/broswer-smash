"""Inspect and repair open boundary loops on an imported character mesh.

inspect  -> per-object boundary edge count and one entry per connected boundary loop
repair   -> weld duplicated boundary vertices, then fill the remaining loops, preserving
            materials and UVs

Run through the project Blender wrapper:
  bash scripts/blender.sh -b --python scripts/repair_mesh_boundaries.py -- inspect <in.glb> [out.glb]
"""
import bpy, bmesh, json, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = argv[0] if argv else "inspect"
src = argv[1]
out = argv[2] if len(argv) > 2 else None

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)


def boundary_loops(bm):
    """Connected groups of edges that belong to exactly one face."""
    seen, groups = set(), []
    for edge in bm.edges:
        if edge in seen or len(edge.link_faces) != 1:
            continue
        stack, group = [edge], []
        seen.add(edge)
        while stack:
            current = stack.pop()
            group.append(current)
            for vert in current.verts:
                for neighbour in vert.link_edges:
                    if neighbour not in seen and len(neighbour.link_faces) == 1:
                        seen.add(neighbour)
                        stack.append(neighbour)
        groups.append(group)
    return groups


def describe(obj, bm):
    info = {"boundaryEdges": sum(1 for e in bm.edges if len(e.link_faces) == 1),
            "verts": len(bm.verts), "faces": len(bm.faces), "loops": []}
    for group in boundary_loops(bm):
        verts = {v for e in group for v in e.verts}
        points = [obj.matrix_world @ v.co for v in verts]
        lo = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
        hi = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
        info["loops"].append({
            "edges": len(group), "verts": len(verts),
            "size": [round((hi - lo).x, 3), round((hi - lo).y, 3), round((hi - lo).z, 3)],
            "center": [round((lo.x + hi.x) / 2, 3), round((lo.y + hi.y) / 2, 3), round((lo.z + hi.z) / 2, 3)],
        })
    info["loops"].sort(key=lambda entry: -entry["edges"])
    return info


if mode == "inspect":
    report = {}
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        # The ingest gate welds by position before counting, so count the same way here.
        bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
        report[obj.name] = describe(obj, bm)
        bm.free()
    print("INSPECT:" + json.dumps(report))
else:
    result = {}
    for obj in [o for o in bpy.data.objects if o.type == "MESH"]:
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        before = describe(obj, bm)
        boundary = [v for v in bm.verts if any(len(e.link_faces) == 1 for e in v.link_edges)]
        bmesh.ops.remove_doubles(bm, verts=boundary, dist=1e-4)
        remaining = [e for e in bm.edges if len(e.link_faces) == 1]
        filled = bmesh.ops.holes_fill(bm, edges=remaining, sides=0) if remaining else {"faces": []}
        # holes_fill leaves tiny fans (3 verts / 2 open edges) behind; close them explicitly.
        extra = 0
        for _ in range(4):
            left = [e for e in bm.edges if len(e.link_faces) == 1]
            if not left:
                break
            made = bmesh.ops.contextual_create(bm, geom=left)
            created = made.get("faces", []) or []
            extra += len(created)
            if not created:
                break
        filled_faces = len(filled.get("faces", []) or []) + extra
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
        bm2 = bmesh.new(); bm2.from_mesh(obj.data)
        after = describe(obj, bm2); bm2.free()
        result[obj.name] = {
            "beforeEdges": before["boundaryEdges"], "afterEdges": after["boundaryEdges"],
            "loopsBefore": len(before["loops"]), "loopsAfter": len(after["loops"]),
            "filledFaces": filled_faces,
        }
    if out:
        bpy.ops.object.select_all(action="SELECT")
        bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=False,
                                  export_animations=True, export_skins=True, export_yup=True)
    print("REPAIR:" + json.dumps(result))
