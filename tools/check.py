"""Headless render tests for viz extensions - no Tableau, no npm.

Each extension has a tests.json: a list of cases that open
extensions/<name>/index.html?mock=fixtures/<fixture> in headless Chrome
(shared/tableau-mock.js stands in for Tableau), dump the final DOM and check it.

    python tools/check.py                    # all extensions
    python tools/check.py kpi-cards          # one extension
    python tools/check.py kpi-cards --shots  # also save screenshots to out/

Case fields (all optional except fixture):
    fixture   file in extensions/<name>/fixtures/
    click     CSS selector to click after the first render (selection tests)
    count     {"css-class": n}  number of elements whose class list contains that class
              (every element, so a status class on both a bar and a label counts twice)
    text      ["..."]            strings that must appear in the visible text
    absent    ["..."]            strings that must not appear
    calls     {"apiMethod": firstArg}  first argument of the last call to that
              Tableau API method, e.g. {"selectTuplesAsync": [7, 8, 9]}
    size      [width, height]    viewport for the screenshot (default 900x560)
"""
import html
import html.parser
import json
import pathlib
import subprocess
import sys
import tempfile
import urllib.parse

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import serve  # noqa: E402

ROOT = serve.ROOT
CFG = json.loads((ROOT / 'config.json').read_text(encoding='utf-8'))


class Dom(html.parser.HTMLParser):
    def __init__(self):
        super().__init__()
        self.classes = {}
        self.text = []
        self.calls = None
        self._in_calls = False
        self._skip = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        for c in (a.get('class') or '').split():
            self.classes[c] = self.classes.get(c, 0) + 1
        if tag == 'pre' and a.get('id') == 'bx-calls':
            self._in_calls = True
        if tag in ('script', 'style'):
            self._skip += 1

    def handle_endtag(self, tag):
        if tag == 'pre':
            self._in_calls = False
        if tag in ('script', 'style'):
            self._skip -= 1

    def handle_data(self, data):
        if self._in_calls:
            self.calls = json.loads(html.unescape(data))
        elif not self._skip:
            self.text.append(data)


def chrome(args, profile):
    # A fresh profile per run: reusing one lets the next run attach to a Chrome that
    # is still shutting down, and that run then never renders.
    with tempfile.TemporaryDirectory(dir=profile) as own:
        cmd = [CFG['chrome'], '--headless=new', '--disable-gpu', '--no-first-run',
               f'--user-data-dir={own}', '--virtual-time-budget=10000', *args]
        return subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', timeout=90)


def run_case(name, case, port, profile, shots):
    q = {'mock': f"fixtures/{case['fixture']}"}
    if case.get('click'):
        q['click'] = case['click']
    url = f'http://127.0.0.1:{port}/extensions/{name}/index.html?' + urllib.parse.urlencode(q)
    w, h = case.get('size', [900, 560])
    retried = False
    for attempt in range(2):
        out = chrome([f'--window-size={w},{h}', '--dump-dom', url], profile)
        dom = Dom()
        dom.feed(out.stdout)
        if dom.calls is not None:
            break
        retried = True  # Chrome occasionally exits before the page settles; try once more
    text = ' '.join(' '.join(dom.text).split())
    problems = []
    if dom.calls is None:
        problems.append('page never finished twice (no #bx-calls) - a JS error before the first render? Open: '
                        f'"{CFG["chrome"]}" --auto-open-devtools-for-tabs "{url}"')
    for c in dom.calls or []:
        if c['name'] == 'test:timeout':
            problems.append(f'timed out waiting for {c["args"][0]} - render() threw or never ran')
        if c['name'] == 'test:click' and not c['args'][1]:
            problems.append(f'click selector matched nothing: {c["args"][0]}')
    for cls, n in case.get('count', {}).items():
        got = dom.classes.get(cls, 0)
        if got != n:
            problems.append(f'.{cls}: expected {n}, got {got}')
    for s in case.get('text', []):
        if s not in text:
            problems.append(f'missing text: {s!r}')
    for s in case.get('absent', []) + ['Render error']:
        if s in text:
            problems.append(f'unexpected text: {s!r}')
    for method, first_arg in case.get('calls', {}).items():
        made = [c for c in (dom.calls or []) if c['name'] == method]
        if not made:
            problems.append(f'{method} was never called')
        elif made[-1]['args'][0] != first_arg:
            problems.append(f'{method} first arg: expected {first_arg}, got {made[-1]["args"][0]}')
    if shots:
        shot = ROOT / 'out' / f"{name}--{case['fixture'].removesuffix('.json')}{'--click' if case.get('click') else ''}.png"
        shot.parent.mkdir(exist_ok=True)
        chrome([f'--window-size={w},{h}', f'--screenshot={shot}', '--hide-scrollbars', url], profile)
        problems_suffix = f'  [{shot.relative_to(ROOT)}]'
    else:
        problems_suffix = ''
    label = case['fixture'] + (f" click {case['click']}" if case.get('click') else '') + (' (retried)' if retried else '')
    print(('PASS ' if not problems else 'FAIL ') + f'{name}: {label}{problems_suffix}')
    for p in problems:
        print('     - ' + p)
    return not problems


def main(argv):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')  # cp1252 console + "≤" etc.
    shots = '--shots' in argv
    only = {a for a in argv if not a.startswith('--')}
    srv = serve.start(0, quiet=True)
    ok = True
    try:
        with tempfile.TemporaryDirectory() as profile:
            for tests in sorted((ROOT / 'extensions').glob('*/tests.json')):
                name = tests.parent.name
                if name.startswith('_') or (only and name not in only):
                    continue
                for case in json.loads(tests.read_text(encoding='utf-8')):
                    ok &= run_case(name, case, srv.server_port, profile, shots)
    finally:
        srv.shutdown()
    print('ALL PASSED' if ok else 'FAILURES')
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
