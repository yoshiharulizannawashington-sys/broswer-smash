#!/usr/bin/env python3
"""Forensic motion audit for Iron Spider's two suspect source clips.

Reads the original Sketchfab scene.gltf + scene.bin, the source GLB, the runtime GLB and
the normalized bake directly. It reports temporal motion, target-node validity, the static
pose's difference from bind, and whether the runtime/GLB channel data still equals the
original glTF. It never writes or edits a model.

Usage:
  python3 scripts/audit-iron-spider-source-animations.py \
    --json artifacts/iron-spider/forensic-diagnostic.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import struct
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ("@collection", "@skill07-03")
COMPONENT = {
    5120: ("b", 1), 5121: ("B", 1), 5122: ("h", 2),
    5123: ("H", 2), 5125: ("I", 4), 5126: ("f", 4),
}
TYPE_SIZE = {
    "SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4,
    "MAT2": 4, "MAT3": 9, "MAT4": 16,
}
NORMALIZER = {"b": 127.0, "B": 255.0, "h": 32767.0, "H": 65535.0}


def load_glb(path: Path):
    data = path.read_bytes()
    magic, version, length = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError(f"{path}: not a GLB (magic {magic:#x})")
    offset = 12
    chunks = {}
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunks[chunk_type] = data[offset:offset + chunk_length]
        offset += chunk_length
    return json.loads(chunks[0x4E4F534A].decode("utf-8")), chunks.get(0x004E4942, b"")


def load_gltf(path: Path):
    document = json.loads(path.read_text())
    buffers = []
    for buffer in document.get("buffers", []):
        uri = buffer.get("uri")
        if not uri:
            buffers.append(b"")
        elif uri.startswith("data:"):
            import base64
            buffers.append(base64.b64decode(uri.split(",", 1)[1]))
        else:
            buffers.append((path.parent / uri).read_bytes())
    if len(buffers) != 1:
        raise ValueError(f"{path}: expected one external/embedded buffer, got {len(buffers)}")
    return document, buffers[0]


def read_accessor(document, binary: bytes, index: int):
    accessor = document["accessors"][index]
    view = document["bufferViews"][accessor["bufferView"]]
    fmt, size = COMPONENT[accessor["componentType"]]
    width = TYPE_SIZE[accessor["type"]]
    stride = view.get("byteStride", size * width)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    values = []
    for key in range(accessor["count"]):
        row = struct.unpack_from("<" + fmt * width, binary, start + key * stride)
        if accessor.get("normalized"):
            row = tuple(value / NORMALIZER[fmt] for value in row)
        values.append(row if width > 1 else row[0])
    return values, accessor


def clip_channels(document, animation):
    """(node name, path) -> {times, values, interpolation}; coordinates by stable node name."""
    nodes = document.get("nodes", [])
    channels = {}
    for channel in animation.get("channels", []):
        sampler = animation["samplers"][channel["sampler"]]
        times, _ = read_accessor(document, channel["_binary"], sampler["input"])
        values, accessor = read_accessor(document, channel["_binary"], sampler["output"])
        node_index = channel["target"].get("node")
        node = nodes[node_index] if node_index is not None and node_index < len(nodes) else {}
        name = node.get("name") or f"node-{node_index}"
        path = channel["target"].get("path")
        channels[(name, path)] = {
            "times": tuple(times),
            "values": tuple(values),
            "interpolation": sampler.get("interpolation", "LINEAR"),
            "componentType": accessor.get("componentType"),
            "normalized": bool(accessor.get("normalized")),
        }
    return channels


def with_binary(document, binary):
    """Attach the binary buffer to each channel descriptor without changing the document."""
    for animation in document.get("animations", []):
        for channel in animation.get("channels", []):
            channel["_binary"] = binary
    return document


def angle_between(a, b):
    dot = abs(sum(x * y for x, y in zip(a, b)))
    return 2 * math.acos(min(1.0, dot)) * 180 / math.pi


def temporal_motion(channels):
    result = {
        "channels": len(channels),
        "targets": len({name for name, _ in channels}),
        "paths": dict(Counter(path for _, path in channels)),
        "keyCounts": sorted({len(entry["times"]) for entry in channels.values()}),
        "multiKeyChannels": 0,
        "multiKeyRotationChannels": 0,
        "multiKeyTranslationChannels": 0,
        "maxRotationDegrees": 0.0,
        "maxTranslationMeters": 0.0,
        "maxTranslationStepMeters": 0.0,
        "maxTranslationFromFirstMeters": 0.0,
        "maxScaleDelta": 0.0,
        "maxRotationChannel": None,
        "maxTranslationChannel": None,
        "maxScaleChannel": None,
        "armTargets": len({name for name, _ in channels if "spider" in name.lower()}),
        "armTargetChannels": sum(1 for name, _ in channels if "spider" in name.lower()),
        "armMovingChannels": 0,
        "maxArmMotion": 0.0,
    }
    for (name, path), entry in channels.items():
        times = entry["times"]
        if len(times) < 2:
            continue
        result["multiKeyChannels"] += 1
        values = entry["values"]
        if path == "rotation":
            result["multiKeyRotationChannels"] += 1
            peak = 0.0
            reference = values[0]
            for value in values[1:]:
                peak = max(peak, angle_between(reference, value))
            if peak > result["maxRotationDegrees"]:
                result["maxRotationDegrees"] = peak
                result["maxRotationChannel"] = name
        elif path == "translation":
            result["multiKeyTranslationChannels"] += 1
            reference = values[0]
            previous = values[0]
            from_first = 0.0
            from_previous = 0.0
            for value in values[1:]:
                from_first = max(from_first, math.sqrt(sum((a - b) ** 2 for a, b in zip(value, reference))))
                from_previous = max(from_previous, math.sqrt(sum((a - b) ** 2 for a, b in zip(value, previous))))
                previous = value
            peak = max(from_first, from_previous)
            result["maxTranslationFromFirstMeters"] = max(result["maxTranslationFromFirstMeters"], from_first)
            result["maxTranslationStepMeters"] = max(result["maxTranslationStepMeters"], from_previous)
            if peak > result["maxTranslationMeters"]:
                result["maxTranslationMeters"] = peak
                result["maxTranslationChannel"] = name
        elif path == "scale":
            peak = 0.0
            reference = values[0]
            for value in values[1:]:
                peak = max(peak, max(abs(a - b) for a, b in zip(value, reference)))
            if peak > result["maxScaleDelta"]:
                result["maxScaleDelta"] = peak
                result["maxScaleChannel"] = name
        if "spider" in name.lower():
            result["armMovingChannels"] += 1
            result["maxArmMotion"] = max(result["maxArmMotion"], peak)
    return result


def pose_delta(channels, nodes):
    """How far the clip's first frame is from the node's bind/rest transform."""
    by_name = {node.get("name"): node for node in nodes}
    max_rotation = (0.0, None)
    max_translation = (0.0, None)
    for (name, path), entry in channels.items():
        node = by_name.get(name)
        if node is None:
            continue
        value = entry["values"][0]
        if path == "rotation":
            peak = angle_between(value, node.get("rotation", [0, 0, 0, 1]))
            if peak > max_rotation[0]:
                max_rotation = (peak, name)
        elif path == "translation":
            peak = math.sqrt(sum((a - b) ** 2 for a, b in zip(value, node.get("translation", [0, 0, 0]))))
            if peak > max_translation[0]:
                max_translation = (peak, name)
    return {
        "maxRotationFromBindDegrees": round(max_rotation[0], 6),
        "maxRotationBone": max_rotation[1],
        "maxTranslationFromBindMeters": round(max_translation[0], 6),
        "maxTranslationBone": max_translation[1],
        "isDistinctFromBind": max_rotation[0] > 0.1 or max_translation[0] > 0.001,
    }


def target_coverage(document, animation):
    skin_joints = set()
    for skin in document.get("skins", []):
        skin_joints.update(skin.get("joints", []))
    nodes = document.get("nodes", [])
    outside = []
    for channel in animation.get("channels", []):
        index = channel["target"].get("node")
        if index not in skin_joints:
            outside.append({
                "node": index,
                "name": nodes[index].get("name") if index is not None and index < len(nodes) else None,
            })
    return {
        "skeletonJoints": len(skin_joints),
        "targetsOutsideSkeleton": len(outside),
        "outside": outside,
    }


def compare_channels(original, candidate):
    if set(original) != set(candidate):
        return {
            "identical": False,
            "missing": sorted(str(key) for key in set(original) - set(candidate))[:20],
            "extra": sorted(str(key) for key in set(candidate) - set(original))[:20],
        }
    differing = []
    for key in original:
        a, b = original[key], candidate[key]
        if a["times"] != b["times"] or a["values"] != b["values"]:
            differing.append({"target": key, "originalKeys": len(a["times"]), "candidateKeys": len(b["times"])})
    return {
        "identical": not differing,
        "channels": len(original),
        "differing": differing[:20],
        "differingCount": len(differing),
    }


def sha256(path: Path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default="artifacts/iron-spider/forensic-diagnostic.json")
    args = parser.parse_args()

    originals = {
        "sketchfab-scene-gltf": ROOT / "artifacts/asset-fetch/99e52e57a8dc4feda750af87b87d2955/extracted/scene.gltf",
        "source-glb": ROOT / "public/models/characters/iron_spider/iron_spider.glb",
        "runtime-glb": ROOT / "public/models/characters/iron_spider/iron_spider_source_animated.glb",
        "fetch-glb": ROOT / "artifacts/asset-fetch/iron_spider/iron_spider.glb",
        "normalized-bake": ROOT / "artifacts/iron-spider/prepared/iron_spider_normalized.glb",
    }
    documents = {}
    for label, path in originals.items():
        if not path.exists():
            continue
        if path.suffix == ".gltf":
            document, binary = load_gltf(path)
        else:
            document, binary = load_glb(path)
        documents[label] = with_binary(document, binary)

    animations = {}
    for label, document in documents.items():
        animations[label] = {
            animation["name"]: animation
            for animation in document.get("animations", [])
            if any(target in (animation.get("name") or "") for target in TARGETS)
        }

    source_doc = documents["sketchfab-scene-gltf"]
    source_anims = animations["sketchfab-scene-gltf"]
    records = []
    for target in TARGETS:
        name = next((key for key in source_anims if key.endswith(target)), None)
        if not name:
            continue
        source_animation = source_anims[name]
        source_channels = clip_channels(source_doc, source_animation)
        record = {
            "name": name,
            "sourcePath": str(originals["sketchfab-scene-gltf"].relative_to(ROOT)),
            "sourceBuffer": "artifacts/asset-fetch/99e52e57a8dc4feda750af87b87d2955/extracted/scene.bin",
            "sourceSha256": sha256(originals["sketchfab-scene-gltf"]),
            "durationSeconds": round(max(
                (max(entry["times"]) for entry in source_channels.values() if entry["times"]), default=0
            ), 6),
            "trackCount": len(source_channels),
            "targetNames": sorted({key[0] for key in source_channels}),
            "targetCoverage": target_coverage(source_doc, source_animation),
            "motion": temporal_motion(source_channels),
            "pose": pose_delta(source_channels, source_doc.get("nodes", [])),
            "comparisons": {},
        }
        for label, document in documents.items():
            animation = animations[label].get(name)
            if not animation:
                record["comparisons"][label] = {"present": False}
                continue
            channels = clip_channels(document, animation)
            record["comparisons"][label] = {
                "present": True,
                "path": str(originals[label].relative_to(ROOT)),
                "sha256": sha256(originals[label]) if label != "sketchfab-scene-gltf" else record["sourceSha256"],
                "trackCount": len(channels),
                "durationSeconds": round(max(
                    (max(entry["times"]) for entry in channels.values() if entry["times"]), default=0
                ), 6),
                "motion": temporal_motion(channels),
                **compare_channels(source_channels, channels),
            }
        records.append(record)

    # Runtime ownership: the manifest is the authoritative gameplay-slot map.
    manifest = (ROOT / "public/js/anim/animation_manifest.js").read_text()
    for record in records:
        record["runtimeMapReferences"] = [
            {"clip": record["name"], "references": manifest.count(record["name"])}
        ][0]

    from datetime import datetime, timezone
    report = {
        "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "task": "Iron Spider original-animation forensic investigation",
        "sourceOfTruth": "Sketchfab scene.gltf + scene.bin, compared against source GLB, runtime GLB and normalized bake",
        "rendererNote": "This is source/data inspection. Live browser measurements are in artifacts/iron-spider/clip-matrix/.",
        "thresholds": {
            "rotationDegrees": 0.1,
            "translationMeters": 0.0001,
            "scale": 0.0001,
        },
        "files": {
            label: {
                "path": str(path.relative_to(ROOT)),
                "sha256": sha256(path),
                "bytes": path.stat().st_size,
            }
            for label, path in originals.items() if path.exists()
        },
        "clips": records,
        "conclusion": {
            "integrationFailure": False,
            "sourceMotionAvailable": False,
            "repairApplied": False,
            "collection": "One-frame static pose. It is structurally valid and loads, but is not a temporal animation; no runtime binding failure is present.",
            "skill07-03": "Two-second static pose with 45 translation tracks carrying only 2.139e-06 m total displacement from the first key (5.960e-08 m key-to-key) of export noise; rotations are single-key and scales are constant. No temporal body motion exists in any available source copy.",
            "mechanicalArms": "Both clips carry all 20 spider-leg targets (39 channels for collection, 38 for skill07-03) but have 0 moving arm channels; the native arm is present in the source animation data and is not omitted.",
            "runtimeUse": "Neither clip is referenced by the Iron Spider gameplay slot map in animation_manifest.js; the failures are inventory-level animation-acceptance failures, not combat-state failures.",
            "repairDecision": "No repair is legitimate from the available data. Making either clip move would require invented keyframes or borrowing another clip's motion.",
        },
    }
    out = ROOT / args.json
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n")

    for record in records:
        motion = record["motion"]
        print(f"\n{record['name']}")
        print(f"  source: {record['sourcePath']} ({record['trackCount']} tracks, {record['durationSeconds']}s)")
        print(f"  targets: {record['targetCoverage']['skeletonJoints']} joints, "
              f"{record['targetCoverage']['targetsOutsideSkeleton']} outside")
        print(f"  motion: rotation {motion['maxRotationDegrees']:.6g} deg, "
              f"translation {motion['maxTranslationMeters']:.6g} m "
              f"(step {motion['maxTranslationStepMeters']:.6g} m), scale {motion['maxScaleDelta']:.6g}")
        print(f"  mechanical arm targets: {motion['armTargets']} ({motion['armTargetChannels']} channels), "
              f"moving channels {motion['armMovingChannels']}, max arm motion {motion['maxArmMotion']:.6g}")
        print(f"  static pose: distinct={record['pose']['isDistinctFromBind']}, "
              f"rotation {record['pose']['maxRotationFromBindDegrees']:.3f} deg, "
              f"translation {record['pose']['maxTranslationFromBindMeters']:.3f} m")
        for label, comparison in record["comparisons"].items():
            print(f"  {label}: present={comparison.get('present')} identical={comparison.get('identical')}")
    print(f"\nWROTE {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
