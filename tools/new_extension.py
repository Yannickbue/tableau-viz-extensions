"""Scaffold a new viz extension from extensions/_template.

    python tools/new_extension.py waterfall "Waterfall"

Creates extensions/<name>/ with manifest.trex, index.html, <name>.js/.css, a sample
fixture and tests.json that already pass. Name: lowercase letters, digits, hyphens.
"""
import pathlib
import re
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main(name, title):
    if not re.fullmatch(r'[a-z][a-z0-9-]*', name):
        sys.exit('name must be lowercase letters, digits and hyphens, e.g. kpi-cards')
    src = ROOT / 'extensions' / '_template'
    dst = ROOT / 'extensions' / name
    if dst.exists():
        sys.exit(f'{dst} already exists')
    shutil.copytree(src, dst)
    ext_id = name.replace('-', '')
    for f in list(dst.rglob('*')):
        if f.is_file():
            t = f.read_text(encoding='utf-8')
            t = t.replace('__NAME__', name).replace('__TITLE__', title).replace('__ID__', ext_id)
            f.write_text(t, encoding='utf-8')
        if '__NAME__' in f.name:
            f.rename(f.with_name(f.name.replace('__NAME__', name)))
    print(f'Created extensions/{name}/ (id com.bleckmann.viz.{ext_id})')
    print(f'Next: python tools/check.py {name}  and  python tools/make_trex.py {name}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
