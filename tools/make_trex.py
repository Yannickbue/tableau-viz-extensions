"""Validate every extensions/<name>/manifest.trex and write the two installable copies:

    trex/local/<name>.trex   -> http://localhost:8765/...   (Tableau Desktop development)
    trex/cloud/<name>.trex   -> <pages_base from config.json> (Tableau Cloud, GitHub Pages)

    python tools/make_trex.py            # all extensions
    python tools/make_trex.py kpi-cards  # one extension

Exits non-zero on any validation error, and then writes nothing for that extension.
"""
import json
import pathlib
import re
import sys
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
NS = {'m': 'http://www.tableau.com/xml/extension_manifest'}
LOCAL_BASE = 'http://localhost:8765'
ROLE_TYPES = {'discrete-dimension', 'continuous-dimension', 'discrete-measure', 'continuous-measure'}


def validate(name, text):
    errors = []
    if '{{BASE_URL}}' not in text:
        errors.append('source-location url must start with {{BASE_URL}}')
    try:
        root = ET.fromstring(text.replace('{{BASE_URL}}', LOCAL_BASE))
    except ET.ParseError as e:
        return [f'XML is not well-formed: {e}']
    ext = root.find('m:worksheet-extension', NS)
    if ext is None:
        return ['missing <worksheet-extension> (a viz extension is not a <dashboard-extension>)']
    if not re.fullmatch(r'[a-z0-9]+(\.[a-z0-9]+)+', ext.get('id', '')):
        errors.append(f"id '{ext.get('id')}' should look like com.bleckmann.viz.<name>")
    if not re.fullmatch(r'\d+\.\d+\.\d+', ext.get('extension-version', '')):
        errors.append('extension-version must be x.y.z')
    for tag in ('default-locale', 'name', 'description', 'author', 'min-api-version', 'source-location/m:url', 'icon'):
        if ext.find('m:' + tag, NS) is None:
            errors.append(f'missing <{tag}>')
    url = ext.findtext('m:source-location/m:url', default='', namespaces=NS)
    if not url.endswith(f'/extensions/{name}/index.html'):
        errors.append(f'url should end with /extensions/{name}/index.html, got {url}')
    # Tableau's content model for <worksheet-extension>, quoted from its FD722608 error:
    # (default-locale,name,description,author,min-api-version,source-location,icon,
    #  permissions?,context-menu?,disable-sorting-ui?,encoding*) - in this order.
    order = ['default-locale', 'name', 'description', 'author', 'min-api-version',
             'source-location', 'icon', 'permissions', 'context-menu', 'disable-sorting-ui', 'encoding']
    tags = [c.tag.split('}')[-1] for c in ext if isinstance(c.tag, str)]
    unknown = [t for t in tags if t not in order]
    if unknown:
        errors.append(f'elements Tableau does not allow in <worksheet-extension>: {unknown}')
    ranks = [order.index(t) for t in tags if t in order]
    if ranks != sorted(ranks):
        errors.append(f'children out of order: {tags}; required order is {order}')
    seen = set()
    encodings = ext.findall('m:encoding', NS)
    if not encodings:
        errors.append('no <encoding> elements: the Marks card would have nothing to drop fields on')
    if len(encodings) > 4:
        # Documented limit ("up to four custom encodings"); Tableau rejects the file with
        # FD722608 "element 'encoding' is not allowed for content model".
        errors.append(f'{len(encodings)} encodings; Tableau allows at most 4 custom encodings. '
                      'Combine roles (max-count 2) or use the built-in Detail tile.')
    for enc in encodings:
        eid = enc.get('id', '')
        if not re.fullmatch(r'[a-z][a-z0-9]*', eid):
            errors.append(f"encoding id '{eid}' must be lowercase letters/digits only")
        if eid in seen:
            errors.append(f"duplicate encoding id '{eid}'")
        seen.add(eid)
        if enc.find('m:display-name', NS) is None:
            errors.append(f"encoding '{eid}' has no <display-name>")
        fields = enc.find('m:fields', NS)
        if fields is None or not fields.get('max-count', '').isdigit():
            errors.append(f"encoding '{eid}' needs <fields max-count=\"n\"/>")
        for rt in enc.findall('m:role-spec/m:role-type', NS):
            if rt.text not in ROLE_TYPES:
                errors.append(f"encoding '{eid}' has unknown role-type '{rt.text}'")
    res_ids = {r.get('id') for r in root.findall('m:resources/m:resource', NS)}
    name_el = ext.find('m:name', NS)
    if name_el is not None and name_el.get('resource-id') not in res_ids:
        errors.append(f"<name resource-id> '{name_el.get('resource-id')}' has no matching <resource>")
    return errors


def main(only):
    cfg = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))
    cloud_base = cfg['pages_base'].rstrip('/')
    failed = False
    for manifest in sorted((ROOT / 'extensions').glob('*/manifest.trex')):
        name = manifest.parent.name
        if name.startswith('_') or (only and name not in only):
            continue
        text = manifest.read_text(encoding='utf-8')
        errors = validate(name, text)
        if errors:
            failed = True
            print(f'FAIL {name}')
            for e in errors:
                print(f'   - {e}')
            continue
        for kind, base in (('local', LOCAL_BASE), ('cloud', cloud_base)):
            out = ROOT / 'trex' / kind / f'{name}.trex'
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_text(text.replace('{{BASE_URL}}', base), encoding='utf-8')
        version = re.search(r'extension-version="([^"]+)"', text).group(1)
        print(f'OK   {name} {version} -> trex/local/{name}.trex, trex/cloud/{name}.trex')
    if 'YOUR-GITHUB-USER' in cloud_base:
        print('NOTE config.json pages_base is still the placeholder; cloud .trex files will not work yet.')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main(set(sys.argv[1:])))
