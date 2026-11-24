#!/usr/bin/env python3
"""Fetch the CC0 PBR texture set the large worlds' materials use.

Poly Haven publishes its whole texture library under CC0 (public domain), so the maps can be
committed with the game and shipped without attribution obligations. This script is the
repeatable record of exactly which assets were used:

  1. query the Poly Haven file API for each asset,
  2. download the 1k diffuse / OpenGL normal / roughness maps,
  3. process them for the game's material pipeline:
       albedo.jpg     - luminance only, compressed into a narrow bright band, because
                        world materials multiply it by the *palette* colour (so the world
                        keeps its art direction and the photo supplies surface detail),
       normal.jpg     - real relief, kept as RGB,
       roughness.jpg  - real specular breakup,
  4. write public/assets/textures/<family>/ and a manifest.json with asset id, author,
     licence and source URL for every family.

Run from the repository root:  python3 scripts/fetch-world-textures.py
"""
import io
import json
import os
import sys
import urllib.request

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'public', 'assets', 'textures')
API = 'https://api.polyhaven.com/files/'

# family -> Poly Haven asset id. Families are what world_textures.SURFACES points at.
FAMILIES = {
    'stone': 'stone_block_wall',
    'rock': 'cliff_side',
    'concrete': 'concrete_slab_wall_02',
    'brick': 'brick_wall_001',
    'asphalt': 'asphalt_02',
    'marble': 'marble_tiles',
    'wood': 'brown_planks_09',
    'grass': 'leafy_grass',
    'roof': 'clay_roof_tiles_02',
    'metal': 'metal_plate_02',
    'paving': 'precast_stone_paving',
}

SIZE = 512
# Diffuse is turned into a near-white detail map. Anything darker than this would start
# multiplying the palette colours down and change every world's colour identity.
ALBEDO_MEAN = 236
ALBEDO_CONTRAST = 0.30
ALBEDO_MIN = 186


def fetch(url):
    # The CDN rejects Python's default urllib agent; identify the project instead.
    request = urllib.request.Request(url, headers={'User-Agent': 'browser-smash/1.0 (+world textures)'})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def map_url(asset_id, map_key):
    files = json.loads(fetch(API + asset_id))
    if map_key not in files:
        raise SystemExit(f'{asset_id}: no "{map_key}" map published')
    entry = files[map_key].get('1k', {}).get('jpg')
    if not entry:
        raise SystemExit(f'{asset_id}: no 1k jpg for "{map_key}"')
    return entry['url']


def detail_albedo(image):
    """Luminance, centred on a bright mean so it multiplies the palette instead of replacing it."""
    grey = image.convert('L').resize((SIZE, SIZE), Image.LANCZOS)
    pixels = list(grey.getdata())
    mean = sum(pixels) / len(pixels)
    out = []
    for value in pixels:
        shifted = ALBEDO_MEAN + (value - mean) * ALBEDO_CONTRAST
        out.append(max(ALBEDO_MIN, min(255, int(shifted))))
    result = Image.new('L', (SIZE, SIZE))
    result.putdata(out)
    return result


def save_jpg(image, path, quality):
    image.save(path, 'JPEG', quality=quality, optimize=True, progressive=False)


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {
        'note': 'CC0 PBR surface maps for the large worlds. Regenerate with scripts/fetch-world-textures.py.',
        'source': 'Poly Haven (https://polyhaven.com)',
        'licence': 'CC0 1.0 Universal (public domain)',
        'resolution': f'{SIZE}x{SIZE}',
        'families': {}
    }
    total = 0
    for family, asset_id in FAMILIES.items():
        folder = os.path.join(OUT, family)
        os.makedirs(folder, exist_ok=True)
        print(f'== {family} <- {asset_id}')
        info = json.loads(fetch('https://api.polyhaven.com/info/' + asset_id))
        credit = info.get('authors') or {}
        author = ', '.join(credit.keys()) if credit else 'Poly Haven'
        manifest['families'][family] = {
            'asset': asset_id,
            'author': author,
            'url': f'https://polyhaven.com/a/{asset_id}',
            'maps': ['albedo.jpg', 'normal.jpg', 'roughness.jpg']
        }
        albedo = Image.open(io.BytesIO(fetch(map_url(asset_id, 'Diffuse'))))
        normal = Image.open(io.BytesIO(fetch(map_url(asset_id, 'nor_gl')))).convert('RGB')
        rough = Image.open(io.BytesIO(fetch(map_url(asset_id, 'Rough')))).convert('L')

        save_jpg(detail_albedo(albedo), os.path.join(folder, 'albedo.jpg'), 84)
        save_jpg(normal.resize((SIZE, SIZE), Image.LANCZOS), os.path.join(folder, 'normal.jpg'), 90)
        save_jpg(rough.resize((SIZE, SIZE), Image.LANCZOS), os.path.join(folder, 'roughness.jpg'), 82)

        for name in ('albedo.jpg', 'normal.jpg', 'roughness.jpg'):
            path = os.path.join(folder, name)
            size = os.path.getsize(path)
            total += size
            print(f'   {name:14s} {size / 1024:6.1f} kB')

    with open(os.path.join(OUT, 'manifest.json'), 'w') as handle:
        json.dump(manifest, handle, indent=2, sort_keys=True)
        handle.write('\n')
    print(f'\n{len(FAMILIES)} families, {total / 1024 / 1024:.2f} MB total, written to {OUT}')


if __name__ == '__main__':
    sys.exit(main())
