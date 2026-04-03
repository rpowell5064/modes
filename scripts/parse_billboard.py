#!/usr/bin/env python3
"""
Parse McGill Billboard Corpus → public/songs.xml

USAGE:
  python scripts/parse_billboard.py --corpus PATH_TO_CORPUS_DIR [--output public/songs.xml]

Download the corpus from either:
  https://ddmal.ca/research/The_McGill_Billboard_Project_(Chord_Analysis_Dataset)/
  OR Kaggle: https://www.kaggle.com/datasets/jacobvs/mcgill-billboard

The corpus directory should contain:
  - billboard-2.0-index.csv  (or index.csv)
  - Numbered subdirectories: 0003/, 0004/, ...
    Each containing salami_chords.txt and/or *.lab files
"""

import argparse
import csv
import os
import re
import xml.etree.ElementTree as ET
from xml.dom import minidom


# ── Constants ──────────────────────────────────────────────────────────────────

SECTION_LABEL_RE = re.compile(r"^[A-Z]'*$|^Z'*$")

HARTE_QUALITY_MAP = {
    'maj': '',    'min': 'm',   '7': '7',       'maj7': 'maj7',
    'min7': 'm7', 'dom7': '7',  'hdim7': 'm7b5','dim7': 'dim7',
    'dim': 'dim', 'aug': 'aug', 'sus4': 'sus4', 'sus2': 'sus2',
    'maj6': '6',  'min6': 'm6', '6': '6',
    'maj9': 'maj9','min9': 'm9','9': '9',
    'maj11': 'maj11','min11': 'm11','11': '11',
    'maj13': 'maj13','min13': 'm13','13': '13',
    '5': '5',     '1': '',
}

SEMITONE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
NOTE_TO_SEMI = {n: i for i, n in enumerate(SEMITONE_NAMES)}
NOTE_TO_SEMI.update({
    'Db': 1, 'D#': 3, 'Fb': 4, 'E#': 5,
    'Gb': 6, 'G#': 8, 'A#': 10, 'Cb': 11, 'B#': 0,
})


# ── Chord normalization ────────────────────────────────────────────────────────

def normalize_chord(token):
    """Convert a Harte-notation chord token to a readable chord name."""
    token = token.strip()
    if not token or token in ('N', 'X', 'silence', 'end', '*'):
        return None
    if token == '.':
        return '.'
    if re.match(r'^x\d+$', token):
        return None

    token = token.split('/')[0]  # drop bass note

    if ':' not in token:
        if re.match(r'^[A-G][b#]?$', token):
            return token
        return None

    root, quality = token.split(':', 1)
    if not re.match(r'^[A-G][b#]?$', root):
        return None

    quality = re.sub(r'\(.*?\)', '', quality).strip()
    suffix = HARTE_QUALITY_MAP.get(quality, quality[:8])
    return f"{root}{suffix}"


# ── File parsers ───────────────────────────────────────────────────────────────

def parse_salami_chords(filepath):
    """
    Parse a salami_chords.txt annotation file.
    Returns (title, artist, tonic, sections) where sections = {label: [chord, ...]}
    """
    title = artist = tonic = ''
    sections = {}
    current_label = 'A'
    last_phrase_key = None

    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.rstrip('\n\r')

            if line.startswith('# title:'):
                title = line.split(':', 1)[1].strip()
                continue
            if line.startswith('# artist:'):
                artist = line.split(':', 1)[1].strip()
                continue
            if line.startswith('# tonic:'):
                tonic = line.split(':', 1)[1].strip()
                continue
            if line.startswith('#') or not line.strip():
                continue

            parts = line.split('\t')
            if len(parts) < 2:
                continue

            # Detect optional section label in column 2
            if len(parts) >= 3 and SECTION_LABEL_RE.match(parts[1].strip()):
                current_label = parts[1].strip()
                chord_content = '\t'.join(parts[2:])
            else:
                chord_content = '\t'.join(parts[1:])

            tokens = re.findall(r'\|\s*([^|]+?)\s*(?=\|)', chord_content + '|')

            phrase_chords = []
            last_chord = None
            for tok in tokens:
                tok = tok.strip()
                if not tok:
                    continue
                if SECTION_LABEL_RE.match(tok):
                    current_label = tok
                    continue
                chord = normalize_chord(tok)
                if chord == '.':
                    if last_chord:
                        phrase_chords.append(last_chord)
                elif chord:
                    phrase_chords.append(chord)
                    last_chord = chord

            if not phrase_chords:
                continue

            phrase_key = ' '.join(phrase_chords)
            if current_label not in sections:
                sections[current_label] = []
                last_phrase_key = None

            if phrase_key != last_phrase_key:
                sections[current_label].extend(phrase_chords)
                last_phrase_key = phrase_key

    return title, artist, tonic, sections


def parse_lab_file(filepath):
    """Parse a 3-column LAB file: start end chord → returns [chord, ...]"""
    chords = []
    with open(filepath, 'r', encoding='utf-8', errors='replace') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            parts = line.split()
            token = parts[2] if len(parts) >= 3 else (parts[1] if len(parts) == 2 else None)
            if token:
                chord = normalize_chord(token)
                if chord and chord != '.':
                    chords.append(chord)
    return chords


# ── Mode inference ─────────────────────────────────────────────────────────────

def infer_mode(tonic, sections):
    """Infer Ionian / Mixolydian / Aeolian from tonic and chord data."""
    if not tonic or tonic == '?':
        return 'Ionian'

    all_chords = [c for chords in sections.values() for c in chords]
    if not all_chords:
        return 'Ionian'

    def root_of(chord):
        m = re.match(r'^([A-G][b#]?)', chord)
        return m.group(1) if m else ''

    def quality_of(chord):
        root = root_of(chord)
        return chord[len(root):]

    tonic_chords = [c for c in all_chords if root_of(c) == tonic]

    minor_count = sum(1 for c in tonic_chords if quality_of(c).startswith('m') and not quality_of(c).startswith('maj'))
    major_count = sum(1 for c in tonic_chords if quality_of(c) == '' or quality_of(c).startswith('maj') or quality_of(c).startswith('7'))

    if minor_count > major_count:
        return 'Aeolian'

    # Check for Mixolydian: bVII (10 semitones up) appears as major chord
    tonic_semi = NOTE_TO_SEMI.get(tonic)
    if tonic_semi is not None:
        bvii_semi = (tonic_semi + 10) % 12
        bvii_note = SEMITONE_NAMES[bvii_semi]
        bvii_major = sum(1 for c in all_chords if root_of(c) == bvii_note and quality_of(c) in ('', 'maj7', '7'))
        if bvii_major >= 2 and len(all_chords) > 0 and bvii_major / len(all_chords) > 0.08:
            return 'Mixolydian'

    return 'Ionian'


# ── Helpers ────────────────────────────────────────────────────────────────────

def find_annotation_file(song_dir):
    """Return (path, filename) of the best annotation file in a directory."""
    for name in ('salami_chords.txt', 'full.lab', 'majmin7inv.lab', 'majmin.lab'):
        p = os.path.join(song_dir, name)
        if os.path.exists(p):
            return p, name
    for fname in sorted(os.listdir(song_dir)):
        if fname.endswith('.lab'):
            return os.path.join(song_dir, fname), fname
    return None, None


def dedupe_chords(chords, max_len=16):
    """Remove consecutive duplicate chords and cap total length."""
    seen = set()
    result = []
    for c in chords:
        if c not in seen:
            result.append(c)
            seen.add(c)
        if len(result) >= max_len:
            break
    return result


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Parse McGill Billboard Corpus → songs.xml')
    parser.add_argument('--corpus', required=True, help='Path to the corpus root directory')
    parser.add_argument('--output', default='src/data/songs.json', help='Output JSON path (default) or XML path')
    args = parser.parse_args()

    corpus_dir = args.corpus

    # Locate index CSV
    index_path = None
    for name in ('billboard-2.0-index.csv', 'index.csv', 'billboard_index.csv'):
        p = os.path.join(corpus_dir, name)
        if os.path.exists(p):
            index_path = p
            break
    if not index_path:
        for fname in os.listdir(corpus_dir):
            if fname.endswith('.csv'):
                index_path = os.path.join(corpus_dir, fname)
                break
    if not index_path:
        print(f'ERROR: No index CSV found in {corpus_dir}')
        return

    print(f'Index: {index_path}')

    # Parse index
    song_meta = {}
    with open(index_path, 'r', encoding='utf-8', errors='replace') as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row.get('id', '').strip().zfill(4)
            song_meta[sid] = {
                'title':  row.get('title', '').strip(),
                'artist': row.get('artist', '').strip(),
            }

    print(f'Index entries: {len(song_meta)}')

    root_el   = ET.Element('songs')
    songs_out = []
    processed = skipped = 0

    for sid, meta in sorted(song_meta.items()):
        song_dir = os.path.join(corpus_dir, sid)
        if not os.path.isdir(song_dir):
            skipped += 1
            continue

        ann_path, ann_name = find_annotation_file(song_dir)
        if not ann_path:
            skipped += 1
            continue

        try:
            if ann_name == 'salami_chords.txt' or (ann_name and 'full' in ann_name):
                title, artist, tonic, sections = parse_salami_chords(ann_path)
            else:
                raw = parse_lab_file(ann_path)
                title, artist, tonic = meta['title'], meta['artist'], ''
                sections = {'A': raw}
        except Exception as e:
            print(f'  WARN {sid}: {e}')
            skipped += 1
            continue

        title  = title  or meta['title']
        artist = artist or meta['artist']

        if not title:
            skipped += 1
            continue

        # Normalize tonic to our note set
        key = tonic.strip() if tonic else ''
        if key not in NOTE_TO_SEMI:
            key = key[0].upper() + key[1:] if key else ''
        if not key or key == '?' or key not in NOTE_TO_SEMI:
            skipped += 1
            continue

        mode = infer_mode(key, sections)

        # Drop intro-only (Z) sections if other sections exist
        non_z = {k: v for k, v in sections.items() if not k.startswith('Z') and v}
        good_sections = non_z if non_z else {k: v for k, v in sections.items() if v}
        if not good_sections:
            skipped += 1
            continue

        # Build records
        song_sections = []
        song_el  = ET.SubElement(root_el, 'song')
        ET.SubElement(song_el, 'title').text  = title
        ET.SubElement(song_el, 'artist').text = artist
        ET.SubElement(song_el, 'key').text    = key
        ET.SubElement(song_el, 'mode').text   = mode
        secs_el = ET.SubElement(song_el, 'sections')
        for label, chords in good_sections.items():
            deduped = dedupe_chords(chords)
            if not deduped:
                continue
            sec_el = ET.SubElement(secs_el, 'section')
            sec_el.set('name', label)
            ET.SubElement(sec_el, 'chords').text = ' '.join(deduped)
            song_sections.append({'name': label, 'chords': deduped})

        songs_out.append({'title': title, 'artist': artist, 'key': key, 'mode': mode, 'sections': song_sections})
        processed += 1

    print(f'Processed: {processed}  Skipped: {skipped}')

    import json as _json
    out_dir = os.path.dirname(args.output)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    if args.output.endswith('.json'):
        with open(args.output, 'w', encoding='utf-8') as f:
            _json.dump(songs_out, f, ensure_ascii=False)
    else:
        xml_str = ET.tostring(root_el, encoding='unicode')
        dom = minidom.parseString(xml_str)
        pretty = dom.toprettyxml(indent='  ', encoding='UTF-8').decode('utf-8')
        lines = pretty.splitlines()
        if lines and lines[0].startswith('<?xml'):
            lines[0] = '<?xml version="1.0" encoding="UTF-8"?>'
        with open(args.output, 'w', encoding='utf-8') as f:
            f.write('\n'.join(lines))

    print(f'Written: {args.output}')


if __name__ == '__main__':
    main()
