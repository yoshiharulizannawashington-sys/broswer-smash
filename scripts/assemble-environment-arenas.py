#!/usr/bin/env python3
"""Assemble the Skyloft, Mario Kart and Konoha Hokage Overlook arenas in Blender.

Sources (preserved under artifacts/asset-fetch):
  d3efeec729644b67a444f900815b33d9  Skyloft (Dola, CC BY)
  bc6367ba43ac4af9939e99beac3493a0  Wuhu Island (Dola, CC BY)
  cca07d1f6600401691170b825b6220cc  Sunshine Airport (Dola, CC BY)
  bd95c17d67c44756b4fa5097bce9a547  Naruto Hidden Leaf Village (kyrox, CC BY)

Each mode joins the imported meshes (preserving their materials and packed textures), normalises
the asset into game metres, adds an `arena_*` marker, saves the Blender source and exports a runtime
GLB. Konoha exports only its imported village; the other two keep their authored arena dressing.

  bash scripts/blender.sh -b --python scripts/assemble-environment-arenas.py -- skyloft
  bash scripts/blender.sh -b --python scripts/assemble-environment-arenas.py -- mariokart
  bash scripts/blender.sh -b --python scripts/assemble-environment-arenas.py -- konoha
"""
import json
import math
import os
import sys

import bpy
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
mode = args[0] if args else ""

SRC = "artifacts/asset-fetch"
OUT_GLB = "public/assets/arenas"
OUT_BLEND = "assets/blender/environments"
REPORT = "artifacts/environment/arenas"

_materials = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _materials.clear()


def material(name, colour, roughness=0.75, metallic=0.0, emission=None):
    if name in _materials:
        return _materials[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.4
    _materials[name] = mat
    return mat


def import_join(label, path, hide_names=(), scale=1.0, source_point=(0, 0, 0), target=(0, 0, 0)):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(path))
    imported = [o for o in bpy.data.objects if o not in before]
    meshes = []
    for obj in imported:
        if obj.type in {"CAMERA", "LIGHT"}:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        if obj.type == "MESH":
            if any(token in obj.name for token in hide_names):
                bpy.data.objects.remove(obj, do_unlink=True)
            else:
                meshes.append(obj)
    if not meshes:
        raise RuntimeError("no meshes imported from " + path)
    # Flatten imported hierarchy so joining cannot double-apply a parent's transform.
    for obj in meshes:
        world = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = label
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

    if scale != 1.0:
        obj.scale = (scale, scale, scale)
        bpy.ops.object.transform_apply(scale=True)
    sx, sy, sz = (source_point[0] * scale, source_point[1] * scale, source_point[2] * scale)
    obj.location = (target[0] - sx, target[1] - sy, target[2] - sz)
    bpy.ops.object.transform_apply(location=True)

    obj.data.calc_loop_triangles()
    print("ASSET", label, "tris", len(obj.data.loop_triangles), "materials", len(obj.data.materials),
          "bounds", [round(v, 2) for v in obj.dimensions])
    return obj


def box(name, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (x1 - x0, y1 - y0, z1 - z0)
    bpy.ops.object.transform_apply(scale=True, location=True)
    obj.data.materials.append(mat)
    if bevel:
        modifier = obj.modifiers.new("soft edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    return obj


def cylinder(name, x, y, z, radius, depth, mat, vertices=20):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(x, y, z))
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


def land_bridge(name, sections, centre_z, bottom, top_material, side_material):
    """A low, irregular grass-and-rock isthmus with open ends.

    Sections are (x, top_height, half_width). The open ends let the ramp meet Wuhu and the
    airport shelf flush instead of creating a vertical end wall the collision baker would turn
    into an invisible barrier.
    """
    vertices = []
    for x, top, half in sections:
        vertices.extend([
            (x, centre_z - half, top), (x, centre_z + half, top),
            (x, centre_z - half, bottom), (x, centre_z + half, bottom),
        ])
    faces = []
    material_indices = []
    for i in range(len(sections) - 1):
        a = i * 4
        b = (i + 1) * 4
        faces.extend([
            (a, b, b + 1, a + 1),          # grass top
            (a, b, b + 2, a + 2),          # west/rock side
            (a + 1, b + 1, b + 3, a + 3),  # east/rock side
            (a + 2, b + 2, b + 3, a + 3),  # underside
        ])
        material_indices.extend([0, 1, 1, 1])
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(top_material)
    mesh.materials.append(side_material)
    for polygon, material_index in zip(mesh.polygons, material_indices):
        polygon.material_index = material_index
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def marker(name):
    empty = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(empty)
    empty.empty_display_type = "PLAIN_AXES"
    empty.empty_display_size = 2
    return empty


def railing(prefix, x0, x1, y0, y1, top, mat, posts=True):
    h = 1.05
    t = 0.22
    box(prefix + "_north_rail", x0, x1, y1 - t, y1, top, top + .15, mat)
    box(prefix + "_south_rail", x0, x1, y0, y0 + t, top, top + .15, mat)
    box(prefix + "_west_rail", x0, x0 + t, y0, y1, top, top + .15, mat)
    box(prefix + "_east_rail", x1 - t, x1, y0, y1, top, top + .15, mat)
    if not posts:
        return
    for x in (x0, (x0 + x1) / 2, x1):
        for y in (y0, y1):
            box(f"{prefix}_post_{x:.0f}_{y:.0f}", x - .16, x + .16, y - .16, y + .16, top, top + h, mat)


def banner(name, x, y, z, colour, height=4.2):
    pole = material("dark timber", (0.12, 0.075, 0.04), .86)
    cloth = material(name + " cloth", colour, .82)
    cylinder(name + "_pole", x, y, z + height / 2, .07, height, pole, 10)
    # A thin hanging cloth, offset from the pole toward the arena.
    box(name + "_cloth", x - .58, x + .58, y - .035, y + .035, z + height - 1.65, z + height - .18, cloth)


def save(name, report):
    os.makedirs(OUT_GLB, exist_ok=True)
    os.makedirs(OUT_BLEND, exist_ok=True)
    os.makedirs(REPORT, exist_ok=True)
    blend_dir = os.path.join(OUT_BLEND, name)
    os.makedirs(blend_dir, exist_ok=True)
    blend = os.path.join(blend_dir, name + ".blend")
    glb = os.path.join(OUT_GLB, name + ".glb")
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(blend))
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(glb),
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=True,
    )
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    triangles = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        triangles += len(obj.data.loop_triangles)
    report.update({
        "name": name,
        "blend": blend,
        "glb": glb,
        "glbBytes": os.path.getsize(glb),
        "meshes": len(meshes),
        "triangles": triangles,
        "exportedAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
    })
    with open(os.path.join(REPORT, name + ".json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=2)
        handle.write("\n")
    print("SAVED", json.dumps(report))


# ---------------------------------------------------------------------------------------------
def build_skyloft():
    reset()
    island = import_join(
        "skyloft_island",
        f"{SRC}/d3efeec729644b67a444f900815b33d9/model.glb",
        scale=1.0,
        source_point=(58, -7, .95),
        target=(0, 0, 0),
    )
    stone = material("skyloft_deck_base", (.29, .265, .225), .92)
    light = material("skyloft_plaza_inset", (.72, .66, .53), .8)
    brass = material("skyloft_brass", (.45, .30, .09), .38, .7)
    blue = material("skyloft_banner_blue", (.06, .24, .58), .8)
    # A level knight's plaza on the lower island terrace. The imported island is the primary
    # environment; this deck is the playable surface and is edged with a low stone balustrade.
    box("skyloft_plaza", -22, 22, -17, 17, -.38, .14, stone, .12)
    for i in range(-5, 6):
        box(f"skyloft_joint_x{i}", -21.5, 21.5, i * 2.8 - .025, i * 2.8 + .025, .145, .16, light)
        box(f"skyloft_joint_y{i}", i * 3.5 - .025, i * 3.5 + .025, -16.5, 16.5, .145, .16, light)
    railing("skyloft", -22.6, 22.6, -17.6, 17.6, .14, stone)
    for x, y in [(-19, -14), (19, -14), (-19, 14), (19, 14)]:
        banner("skyloft_banner_" + str(x) + "_" + str(y), x, y, .14, (.06, .24, .58))
        cylinder("skyloft_brazier_" + str(x) + "_" + str(y), x, -y, .75, .28, .55, brass, 14)
    # Central compass inset gives the plaza an authored focal point at fight distance.
    cylinder("skyloft_compass_ring", 0, 0, .17, 4.2, .035, brass, 48)
    cylinder("skyloft_compass_ring_inner", 0, 0, .18, 3.4, .035, light, 48)
    marker("arena_skyloft")
    report = {
        "mode": "skyloft",
        "reference": {"source": "artifacts/asset-fetch/d3efeec729644b67a444f900815b33d9/model.glb",
                      "uid": "d3efeec729644b67a444f900815b33d9", "author": "Dola", "licence": "CC Attribution",
                      "title": "The legend of zelda : sky word sword - sky loft"},
        "islandBounds": [round(v, 2) for v in island.dimensions],
        "plaza": {"centre": [0, 0], "size": [44, 34], "top": .14},
        "layout": {"bounds": {"x0": -21, "x1": 21, "z0": -15.5, "z1": 15.5}, "ground": .14,
                   "spawns": [{"x": -6.2, "z": -2.0}, {"x": 6.2, "z": 2.0}],
                   "camera": {"yaw": 0, "tilt": .26, "scale": 2.4, "skyline": False}},
    }
    save("skyloft", report)


def build_konoha():
    reset()
    village = import_join(
        "konoha_village",
        f"{SRC}/bd95c17d67c44756b4fa5097bce9a547/model.glb",
        scale=26.0,
        source_point=(1.7, 3.2, -.07),
        target=(0, 78, .25),
    )
    # The imported village, its streets and Hokage cliff are the entire arena. Do not author a
    # terrace, cliff plinth, rails, bridge, gate, banners or lanterns here: those pieces were the
    # old Hokage Overlook and made the import read as a diorama behind a separate plaza.
    marker("arena_konoha_overlook")
    report = {
        "mode": "konoha",
        "reference": {"source": "artifacts/asset-fetch/bd95c17d67c44756b4fa5097bce9a547/model.glb",
                      "uid": "bd95c17d67c44756b4fa5097bce9a547", "author": "kyrox", "licence": "CC Attribution",
                      "title": "Naruto hiddenly village"},
        "villageBounds": [round(v, 2) for v in village.dimensions],
        "villageTarget": [0, 78, .25],
        "authoredGeometry": [],
        "layout": {"bounds": {"x0": -14, "x1": 8, "z0": -108, "z1": -98}, "ground": -.5,
                   "spawns": [{"x": -9, "z": -105}, {"x": 3, "z": -101}],
                   "camera": {"yaw": 0, "tilt": .2, "scale": 1.8, "skyline": True}},
    }
    save("konoha_overlook", report)


def build_mariokart():
    reset()
    wuhu = import_join(
        "wuhu_island",
        f"{SRC}/bc6367ba43ac4af9939e99beac3493a0/model.glb",
        hide_names=("Object_37.001",),
        scale=.55,
        source_point=(-77, -30, 0),
        target=(-72, 0, -4.5),
    )
    # Sunshine Airport is a circular atoll. Move it west so its ring physically overlaps
    # Wuhu's east headland instead of leaving a strait and a separate promenade between them.
    # The old code put the airport at (45, 55) and its 74 m rock base at (45, -55): the base
    # was on the opposite side of Wuhu, and a 60 x 40 m procedural deck had to bridge the gap.
    # The atoll is now the airport land itself; no deck or causeway is authored.
    airport = import_join(
        "sunshine_airport",
        f"{SRC}/cca07d1f6600401691170b825b6220cc/model.glb",
        hide_names=("Object_16.001", "Object_0001_3"),
        scale=.8,
        source_point=(0, 0, .64),
        target=(16, 35, .2),
    )
    grass = material("mariokart_grass", (.18, .27, .12), .96)
    asphalt = material("mariokart_asphalt", (.095, .105, .115), .94)
    water = material("mariokart_ocean", (.085, .30, .36), .28, .05)
    bridge_rock = material("mariokart_bridge_rock", (.22, .205, .17), .96)
    # A natural isthmus joins Wuhu's east shelf to the airport atoll at the same height as the
    # imported airport ground. The open ends sit flush with both source worlds; the sloped grass
    # top is walkable and the rock sides give the causeway its own landform instead of a deck.
    # The GLB exporter is Y-up, so Blender Y is negated into runtime Z: the centre below is
    # +35.2 here and appears as z=-35.2 in the browser and the stage layout.
    land_bridge(
        "mariokart_land_bridge",
        [
            (-22.2, -0.35, 3.4),
            (-21.2, 0.02, 3.4),
            (-20.0, 0.38, 3.9),
            (-19.0, 0.38, 3.4),
        ],
        centre_z=35.2,
        bottom=-3.8,
        top_material=grass,
        side_material=bridge_rock,
    )
    # A bounded sea replaces both source ocean planes. The atoll ring, isthmus and Wuhu are the land.
    box("mariokart_sea", -260, 260, -260, 260, -4.9, -4.6, water)
    # The atoll lagoon is reclaimed as the airport apron. It is one shallow landform that
    # overlaps the atoll ring and Wuhu's east headland, so the imported islands physically
    # touch and the play rectangle always has solid ground under it. There is no deck or
    # causeway: the apron is the airport's own land.
    cylinder("mariokart_apron", 16, 35, .675, 33, .45, asphalt, 64)
    runway = asphalt
    white = material("mariokart_line", (.92, .92, .84), .72)
    box("mariokart_runway", -8, 17, 43, 52, .90, .92, runway)
    box("mariokart_runway_edge_n", -7.5, 16.5, 43.02, 43.32, .92, .935, white)
    box("mariokart_runway_edge_s", -7.5, 16.5, 51.68, 51.98, .92, .935, white)
    for x in range(-7, 17, 4):
        box(f"mariokart_runway_dash_{x}", x, x + 2.2, 47.35, 47.65, .92, .93, white)
    for i in range(8):
        y = 43.5 + i * 1.05
        box(f"mariokart_threshold_w_{i}", -7.8, -5.4, y, y + .48, .92, .93, white)
        box(f"mariokart_threshold_e_{i}", 14.4, 16.8, y, y + .48, .92, .93, white)
    box("mariokart_taxiway", -2, 2, 35.5, 43.2, .90, .915, asphalt)
    box("mariokart_taxi_line", -.1, .1, 35.5, 43.2, .915, .92, white)
    marker("arena_mariokart")
    report = {
        "mode": "mariokart",
        "references": [
            {"source": "artifacts/asset-fetch/bc6367ba43ac4af9939e99beac3493a0/model.glb",
             "uid": "bc6367ba43ac4af9939e99beac3493a0", "author": "Dola", "licence": "CC Attribution",
             "title": "Wuhu Island"},
            {"source": "artifacts/asset-fetch/cca07d1f6600401691170b825b6220cc/model.glb",
             "uid": "cca07d1f6600401691170b825b6220cc", "author": "Dola", "licence": "CC Attribution",
             "title": "Mario kart 8 - Sunshine airport"},
        ],
        "wuhuBounds": [round(v, 2) for v in wuhu.dimensions],
        "airportBounds": [round(v, 2) for v in airport.dimensions],
        "merge": {"airportTarget": [16, 35, .2], "join": "natural grass-and-rock isthmus plus overlapping atoll/Wuhu land",
                  "landBridge": {"name": "mariokart_land_bridge", "x": [-22.2, -19.0], "centreZ": -35.2,
                                 "top": [-.35, .38], "bottom": -3.8, "width": 6.8,
                                 "kind": "natural walkable grass top with rock sides"},
                  "removed": ["mariokart_deck", "mariokart_airport_causeway", "mariokart_airport_base"]},
        "plaza": {"centre": [4.5, 47], "size": [25, 16], "top": .92},
        "layout": {"bounds": {"x0": -45, "x1": -19, "z0": -36, "z1": -10}, "ground": -4.5,
                   "spawns": [{"x": -42, "z": -22}, {"x": -26, "z": -12}],
                   "camera": {"yaw": 0, "tilt": .23, "scale": 2.6, "skyline": True}},
    }
    save("mariokart", report)


if mode == "skyloft":
    build_skyloft()
elif mode == "konoha":
    build_konoha()
elif mode == "mariokart":
    build_mariokart()
else:
    raise SystemExit("usage: ... -- skyloft|konoha|mariokart")
