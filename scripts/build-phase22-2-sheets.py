#!/usr/bin/env python3
"""Phase 22.2 contact sheets: one sheet per view, labelled with phase and capture date.

    python3 scripts/build-phase22-2-sheets.py

Only `artifacts/phase22-2/roster/<slug>/` captures with `status: complete` are used. A fighter
without a current capture gets a MISSING pane - a Phase 21 or Phase 22 image is never substituted
here, because the point of this phase is a trustworthy audit.
"""
import datetime
import json
import os

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAPTURES = os.path.join(ROOT, 'artifacts/phase22-2/roster')
OUT = os.path.join(ROOT, 'artifacts/phase22-2')

LAUNCH = """superman iron_man_tony_stark hulk_bruce_banner green_lantern_hal_jordan wonder_woman
professor_x_charles_xavier the_flash_barry_allen aquaman doctor_strange arnold_schwarzenegger
goku naruto_uzumaki vegeta saitama l_death_note_style all_might edward_elric levi_ackerman
mario luigi kratos link master_chief thor aang madara_uchiha hashirama_senju lord_voldemort
sasuke_uchiha edna_mode captain_jack_sparrow spider_man iron_spider kaze""".split()

VIEWS = [
    ('front', 'FULL BODY - FRONT'),
    ('quarter', 'FULL BODY - THREE QUARTER'),
    ('side', 'FULL BODY - SIDE'),
    ('rear', 'FULL BODY - REAR'),
    ('head-front', 'FACIAL CLOSE-UP - FRONT'),
    ('head-quarter', 'FACIAL CLOSE-UP - THREE QUARTER'),
    ('equipment', 'SIGNATURE EQUIPMENT'),
]
TW, TH, HEADER = 240, 320, 34
COLUMNS = 6
DATE = datetime.date.today().isoformat()


def capture_state(slug, view):
    meta_path = os.path.join(CAPTURES, slug, 'metadata.json')
    image_path = os.path.join(CAPTURES, slug, view + '.png')
    if not os.path.exists(meta_path) or not os.path.exists(image_path):
        return None, 'MISSING'
    with open(meta_path, encoding='utf-8') as handle:
        meta = json.load(handle)
    if meta.get('status') != 'complete' or meta.get('current') is not True:
        return None, 'FAILED'
    return image_path, 'current'


def build(view, title):
    rows = []
    for slug in LAUNCH:
        path, state = capture_state(slug, view)
        rows.append((slug, path, state))
    present = sum(1 for _, path, _ in rows if path)
    height = HEADER + (TH + 18) * ((len(rows) + COLUMNS - 1) // COLUMNS)
    sheet = Image.new('RGB', (TW * COLUMNS, height), (5, 11, 18))
    draw = ImageDraw.Draw(sheet)
    draw.text((8, 6), f'BROWSER SMASH - PHASE 22.2 - {title}', fill=(190, 235, 255))
    draw.text((8, 20), f'captured {DATE} - {present}/{len(rows)} current - MISSING means no current capture',
              fill=(140, 175, 195))
    for index, (slug, path, state) in enumerate(rows):
        column, row = index % COLUMNS, index // COLUMNS
        x, y = column * TW, HEADER + row * (TH + 18)
        draw.rectangle([x, y, x + TW - 2, y + TH + 16], fill=(10, 20, 30))
        draw.text((x + 5, y + 3), f'{slug}  [{state}]', fill=(150, 215, 235) if path else (235, 150, 140))
        if path:
            sheet.paste(Image.open(path).convert('RGB').resize((TW, TH)), (x, y + 16))
        else:
            draw.rectangle([x + 4, y + 18, x + TW - 6, y + TH + 14], outline=(90, 50, 50))
            draw.text((x + 18, y + TH // 2), state, fill=(235, 150, 140))
    target = os.path.join(OUT, f'sheet-{view}.png')
    sheet.save(target)
    print(f'{target} - {present}/{len(rows)} current')


def main():
    os.makedirs(OUT, exist_ok=True)
    for view, title in VIEWS:
        build(view, title)
    status = {}
    for slug in LAUNCH:
        meta_path = os.path.join(CAPTURES, slug, 'metadata.json')
        if not os.path.exists(meta_path):
            status[slug] = 'missing'
            continue
        with open(meta_path, encoding='utf-8') as handle:
            meta = json.load(handle)
        status[slug] = meta.get('status', 'unknown')
    with open(os.path.join(OUT, 'roster-status.json'), 'w', encoding='utf-8') as handle:
        json.dump({'phase': '22.2', 'date': DATE, 'fighters': status,
                   'complete': sum(1 for value in status.values() if value == 'complete'),
                   'total': len(LAUNCH)}, handle, indent=2)
    print('roster status:', sum(1 for value in status.values() if value == 'complete'), '/', len(LAUNCH))


if __name__ == '__main__':
    main()
