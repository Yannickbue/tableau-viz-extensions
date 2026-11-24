"""Build an offline Tableau workbook with fictional data for testing viz extensions.

    python tools/build_test_workbook.py   ->  test-workbook/Viz extension test.twbx

Uses the bleckmann-tableau skill (cwtwb) to write the workbook and bundle the CSV,
so it opens in Desktop without Tableau Cloud or Snowflake. Data is invented:
4 brands x 2 sites x 12 months.

Sheets:
  Data check        reference crosstab to compare the extension's numbers with
  KPI cards - 1..3  empty sheets: set Marks type > Add Extension > kpi-cards there
"""
import csv
import datetime as dt
import inspect
import os
import pathlib
import random
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SKILL = pathlib.Path.home() / '.claude' / 'skills' / 'bleckmann-tableau'
sys.path.insert(0, str(SKILL / 'lib'))
import adapter                      # noqa: E402
import bleckmann as BM              # noqa: E402
import showcase as S                # noqa: E402
from cwtwb import TWBEditor         # noqa: E402

OUT_DIR = ROOT / 'test-workbook'
CSV = OUT_DIR / 'kpi_test_data.csv'
OUT = OUT_DIR / 'Viz extension test.twbx'

BRANDS = {'Brand A': 15000, 'Brand B': 9500, 'Brand C': 7000, 'Brand D': 4000}
SITES = {'Site North': 0.55, 'Site South': 0.45}
ERROR_RATE = {'Site North': 0.0021, 'Site South': 0.0031}   # North on target, South off


def write_csv():
    rnd = random.Random(42)
    months = [dt.date(2025, 11, 1)]
    while len(months) < 12:
        m = months[-1]
        months.append(dt.date(m.year + (m.month == 12), m.month % 12 + 1, 1))
    growth = {'Brand A': 0.025, 'Brand B': -0.012, 'Brand C': 0.03, 'Brand D': 0.0}
    rows = []
    for brand, target in BRANDS.items():
        for site, share in SITES.items():
            for i, m in enumerate(months):
                base = target * 0.88 * (1 + growth[brand]) ** i
                units = round(base * share * rnd.uniform(0.93, 1.07))
                units_py = round(units * rnd.uniform(0.85, 1.05))
                orders = round(units / rnd.uniform(2.6, 3.4))
                picks = round(units * 1.02)
                errors = round(picks * ERROR_RATE[site] * rnd.uniform(0.8, 1.2))
                rows.append([brand, site, m.isoformat(), units, units_py,
                             round(target * share), round(target * share * 0.9),
                             orders, picks, errors])
    OUT_DIR.mkdir(exist_ok=True)
    with CSV.open('w', newline='', encoding='utf-8') as f:
        w = csv.writer(f)
        w.writerow(['Client', 'Site', 'Month', 'Units shipped', 'Units shipped PY',
                    'Target units', 'Amber units', 'Orders', 'Picks', 'Pick errors'])
        w.writerows(rows)


def main():
    write_csv()
    adapter.patch_external_placement()
    adapter.patch_quote_safe_lookups()
    blank = os.path.join(os.path.dirname(inspect.getfile(TWBEditor)), 'references', 'empty_template.twb')
    ed = TWBEditor(blank)
    ed.set_csv_connection(str(CSV))
    ed.clear_worksheets()
    ds = ed._datasource.get('name')
    BM.inject_style(ed)

    # Calcs for the "lower is better" scenario. Names differ from raw fields (skill rule 13).
    S.calc(ed, ds, 'Pick error rate', 'SUM([Pick errors]) / SUM([Picks])', fmt='p0.00%')
    S.calc(ed, ds, 'Pick error rate PY', 'SUM([Pick errors]) / SUM([Picks]) * 1.1', fmt='p0.00%')
    S.calc(ed, ds, 'Error rate target', '0.0025', fmt='p0.00%')
    S.calc(ed, ds, 'Lower is better', '1', 'integer')

    S.table(ed, ds, 'Data check', 'Data check (compare with the cards)', ['Client', 'MONTH(Month)'],
            ['SUM(Units shipped)', 'SUM(Target units)', 'SUM(Amber units)', 'SUM(Orders)', 'AGG(Pick error rate)'])
    for i in (1, 2, 3):
        ed.add_worksheet('KPI cards - %d' % i)

    adapter.fix_datasource_instance_order(ed)
    assert not adapter.dangling_datasource_refs(ed)
    ed.save(str(OUT))
    print('saved:', OUT)


if __name__ == '__main__':
    main()
