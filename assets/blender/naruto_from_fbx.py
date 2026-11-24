"""Export the Naruto half of the downloaded FBX as a game-ready GLB.

Source: "Naruto & Sasuke Low Poly + Rig + Texture" by ronildo.facanha (Sketchfab, CC BY 4.0), whose
description publishes the project files. The FBX holds both characters on separate 567-bone rigs;
this keeps only Naruto's mesh and rig, restores the external texture paths, and writes a GLB whose
skin, weights and animation survive into Three.js.

    bash scripts/blender.sh -b --python assets/blender/naruto_from_fbx.py
"""
import os

import bpy
from mathutils import Vector

SOURCE = "artifacts/asset-fetch/naruto_sasuke/extracted/source/Naruto & Sasuke.fbx"
TEXTURES = "artifacts/asset-fetch/naruto_sasuke/extracted/textures"
OUT = "public/models/characters/naruto_uzumaki/naruto_uzumaki.glb"
CLIP = "Naruto_Run"


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_and_split():
    bpy.ops.import_scene.fbx(filepath=SOURCE)
    naruto = bpy.data.objects["Naruto"]
    rig = naruto.parent
    keep = {naruto.name, rig.name}
    for obj in list(bpy.data.objects):
        if obj.name not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    return naruto, rig


# The FBX names its materials after the maps it expects but arrives with no image nodes at all, so
# every material is rebuilt around the PNG the creator shipped. `face.png` has no file of that name;
# the supplied face map is `smiling.png`, which is the only face texture in the package.
TEXTURE_FOR = {
    "tex01.png": "tex01.png",
    "tex02.png": "tex02.png",
    "hands.png": "hands.png",
    "palms.png": "palms.png",
    "face.png": "smiling.png",
    "tex2_2.png": "tex2_2.png",
}


def restore_textures(mesh):
    """Rebuild each of Naruto's materials around its PNG and report what was actually attached."""
    restored = []
    for material in mesh.materials:
        if material is None:
            continue
        material.use_nodes = True
        tree = material.node_tree
        tree.nodes.clear()
        output = tree.nodes.new("ShaderNodeOutputMaterial")
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
        bsdf.location = (-200, 0)
        tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
        filename = TEXTURE_FOR.get(material.name)
        image = None
        if filename and os.path.exists(os.path.join(TEXTURES, filename)):
            image = bpy.data.images.load(os.path.join(TEXTURES, filename), check_existing=True)
            image.colorspace_settings.name = "sRGB"
            texture = tree.nodes.new("ShaderNodeTexImage")
            texture.image = image
            texture.location = (-620, 220)
            tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
            bsdf.inputs["Roughness"].default_value = 0.62
            bsdf.inputs["Metallic"].default_value = 0.0
        else:
            # `Outline` is the inverted-hull shell; it is meant to be flat ink, not textured.
            bsdf.inputs["Base Color"].default_value = (0.02, 0.02, 0.025, 1.0)
            bsdf.inputs["Roughness"].default_value = 0.92
        restored.append((material.name, filename or "(flat ink)", tuple(image.size) if image else (0, 0)))
    return restored


def strip_outline(mesh):
    """Drop the inverted-hull ink shell.

    The creator's FBX ships a duplicate skin painted with an `Outline` material: the geometry has its
    faces reversed so only the inside shows, which is how the comic outline was drawn. glTF has no
    per-material culling side, so Three.js renders that shell in FRONT of the character and the whole
    body reads as a black silhouette. Removing it leaves the five textured materials visible.
    """
    import bmesh

    data = mesh.data
    slots = [index for index, material in enumerate(data.materials) if material and material.name == "Outline"]
    if not slots:
        return 0
    bm = bmesh.new()
    bm.from_mesh(data)
    dead = [face for face in bm.faces if face.material_index in slots]
    removed = len(dead)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(data)
    bm.free()
    for index in sorted(slots, reverse=True):
        data.materials.pop(index=index)
    data.update()
    print("OUTLINE removed %d faces from the ink shell" % removed)
    return removed


def normalise_scale(naruto, rig, target=1.8):
    """The FBX authors Naruto about 6.15 m tall; the roster bodies are ~1.8 m, so scale the rig.

    The scale is left on the armature object (not applied) because the glTF exporter writes it into
    the root node, where Three.js applies it uniformly to the skin and its bind matrices.
    """
    bpy.context.view_layer.update()
    corners = [naruto.matrix_world @ Vector(corner) for corner in naruto.bound_box]
    zs = [corner.z for corner in corners]
    xs = [corner.x for corner in corners]
    height = max(zs) - min(zs)
    factor = target / height
    rig.scale = (factor, factor, factor)
    bpy.context.view_layer.update()
    corners = [naruto.matrix_world @ Vector(corner) for corner in naruto.bound_box]
    zs = [corner.z for corner in corners]
    xs = [corner.x for corner in corners]
    print("SCALE source height=%.3f m factor=%.4f -> height=%.3f m span=%.3f m feet=%.3f m"
          % (height, factor, max(zs) - min(zs), max(xs) - min(xs), min(zs)))
    return factor


def export(naruto, rig):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    animation = rig.animation_data
    if animation and animation.action:
        action = animation.action
        action.use_fake_user = True
        for track in list(animation.nla_tracks):
            animation.nla_tracks.remove(track)
        track = animation.nla_tracks.new()
        track.name = CLIP
        strip = track.strips.new(CLIP, int(action.frame_start), action)
        strip.name = CLIP
        track.mute = True
        animation.action = None
    bpy.ops.object.select_all(action="DESELECT")
    naruto.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        use_selection=True,
        export_apply=False,
        export_skins=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_bake_animation=False,
        # Only the bones a clip actually keys get channels. Sampling every bone of this 567-bone
        # Rigify rig wrote 1,701 channels per clip (10.6 MB); unkeyed bones stay at rest instead.
        export_force_sampling=False,
        export_optimize_animation_size=True,
        export_anim_single_armature=True,
        export_yup=True,
        export_cameras=False,
        export_lights=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )


def main():
    clear()
    naruto, rig = import_and_split()
    restored = restore_textures(naruto.data)
    strip_outline(naruto)
    normalise_scale(naruto, rig)
    export(naruto, rig)
    mesh = naruto.data
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    print("NARUTO mesh verts=%d tris=%d groups=%d bones=%d materials=%d"
          % (len(mesh.vertices), tris, len(naruto.vertex_groups), len(rig.data.bones), len(mesh.materials)))
    for entry in restored:
        print("TEXTURE %-24s -> %-18s size=%s" % entry)
    missing = [m.name for m in mesh.materials if m and m.use_nodes and not any(
        n.type == "TEX_IMAGE" and n.image and tuple(n.image.size) != (0, 0) for n in m.node_tree.nodes)]
    print("UNRESOLVED " + (", ".join(missing) if missing else "none"))
    print("EXPORTED %s (%d bytes)" % (OUT, os.path.getsize(OUT)))


if __name__ == "__main__":
    main()
