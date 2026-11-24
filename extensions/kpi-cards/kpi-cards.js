// Bleckmann KPI Cards - one card per member of the "Card" encoding.
//
// Encodings (ids from manifest.trex):
//   label       dimension  one card per member; none = a single card
//   value       measure    the headline number (required)
//   target      measure    status + progress bar against target
//   threshold   measure    amber band: between threshold and target = amber
//   compare     measure    delta vs this value (e.g. previous period)
//   trend       date dim   sparkline; headline/target/compare come from the LAST point,
//                          and without a compare field the delta is vs the previous point
//   lowerbetter measure    1 = lower is better (status and delta colours flip)
//   detail      any, <= 4  extra "name: value" lines at the bottom of the card
(function () {
  'use strict';
  const { el, num, text, field, fields, cleanName } = BX;

  function status (v, target, threshold, lower) {
    if (v === null || target === null) return null;
    const meets = (bound) => (lower ? v <= bound : v >= bound);
    if (meets(target)) return { key: 'green', label: 'On target' };
    if (threshold !== null && meets(threshold)) return { key: 'amber', label: 'Near target' };
    return { key: 'red', label: 'Off target' };
  }

  function delta (v, c, lower, label) {
    if (v === null || c === null || c === 0) return null;
    const pct = (v - c) / Math.abs(c);
    const flat = Math.abs(pct) < 0.0005;
    const better = lower ? pct < 0 : pct > 0;
    const cls = flat ? 'flat' : better ? 'good' : 'bad';
    const arrow = flat ? '▶' : pct > 0 ? '▲' : '▼';
    const pctText = (pct > 0 ? '+' : '') + (pct * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + '%';
    return el('span', { class: 'kpi-delta ' + cls, title: `${pctText} ${label}` },
      `${arrow} ${pctText} `, el('span', { class: 'kpi-delta-label' }, label));
  }

  function card (ctx, title, rows) {
    const { enc } = ctx;
    const fValue = field(enc, 'value'); const fTrend = field(enc, 'trend');
    const fTarget = field(enc, 'target'); const fThreshold = field(enc, 'threshold');
    const fCompare = field(enc, 'compare'); const fLower = field(enc, 'lowerbetter');

    const ordered = fTrend ? [...rows].sort((a, b) => {
      const x = BX.sortKey(a, fTrend); const y = BX.sortKey(b, fTrend);
      return x < y ? -1 : x > y ? 1 : 0;
    }) : rows;
    const cur = ordered[ordered.length - 1];
    const prev = ordered.length > 1 ? ordered[ordered.length - 2] : null;

    const v = num(cur, fValue);
    const lower = num(cur, fLower) === 1;
    const target = num(cur, fTarget);
    const st = status(v, target, num(cur, fThreshold), lower);

    let d = null;
    if (fCompare) d = delta(v, num(cur, fCompare), lower, 'vs ' + cleanName(fCompare));
    else if (fTrend && prev) d = delta(v, num(prev, fValue), lower, 'vs ' + text(prev, fTrend));

    const tupleIds = ordered.map(r => r.__tupleId);
    const selected = tupleIds.some(t => ctx.selected.has(t));

    const parts = [
      el('div', { class: 'kpi-title', title },
        title, fTrend ? el('span', { class: 'kpi-period' }, ' · ' + text(cur, fTrend)) : null),
      el('div', { class: 'kpi-main' },
        el('span', { class: 'kpi-value' }, v === null ? '–' : text(cur, fValue)), d)
    ];

    if (fTarget && target !== null) {
      const ratio = v === null || target === 0 ? 0 : Math.max(0, v / target);
      const scale = Math.max(1, ratio) * 1.1; // leave room right of the target marker
      parts.push(el('div', { class: 'kpi-target' },
        el('div', { class: 'kpi-target-text' },
          st ? el('span', { class: 'kpi-status ' + st.key }, st.label) : el('span'),
          el('span', null, 'Target ' + text(cur, fTarget))),
        el('div', { class: 'kpi-bar', role: 'presentation' },
          el('div', { class: 'kpi-bar-fill', style: { width: (ratio / scale * 100).toFixed(1) + '%' } }),
          el('div', { class: 'kpi-bar-target', style: { left: (100 / scale).toFixed(1) + '%' } }))));
    }

    if (fTrend && ordered.length > 1) {
      parts.push(BX.sparkline(ordered.map(r => num(r, fValue))));
    }

    const details = fields(enc, 'detail');
    if (details.length) {
      parts.push(el('ul', { class: 'kpi-details' },
        details.map(f => el('li', null,
          el('span', { class: 'k' }, cleanName(f)), el('span', { class: 'v' }, text(cur, f))))));
    }

    return el('button', {
      type: 'button',
      class: 'kpi-card' + (selected ? ' is-selected' : ''),
      style: st ? { '--status': `var(--bx-${st.key})` } : null,
      'aria-pressed': selected ? 'true' : 'false',
      'data-card': title,
      onclick: (e) => { e.stopPropagation(); BX.clickSelect(ctx, tupleIds, e); },
      onmouseenter: (e) => BX.hover(ctx, cur.__tupleId, e)
    }, parts);
  }

  function render (ctx) {
    const { enc, rows, root } = ctx;
    if (!field(enc, 'value')) {
      return BX.empty(root, 'Drag a measure onto Value. Add a dimension on Card for one card per member.');
    }
    if (!rows.length) return BX.empty(root, 'No data for the current filters.');

    const fLabel = field(enc, 'label');
    const groups = fLabel ? BX.groupBy(rows, [fLabel]) : new Map([[cleanName(field(enc, 'value')), rows]]);

    // Without a trend field each card should be exactly one row. More rows means a
    // dimension sits on Detail lines and splits the data: say so instead of guessing.
    const split = !field(enc, 'trend') && [...groups.values()].some(g => g.length > 1);

    const grid = el('div', { class: 'kpi-grid' + (ctx.selected.size ? ' has-selection' : '') },
      [...groups].map(([title, groupRows]) => card(ctx, title, groupRows)));
    // replaceChildren turns null into the text "null", so build the list explicitly.
    const nodes = [grid];
    if (split) {
      nodes.unshift(el('div', { class: 'bx-notice' },
        'Some cards have more than one row. Put dimensions on Card or Trend only; Detail lines should be measures.'));
    }
    root.replaceChildren(...nodes);
  }

  // Clicking empty space clears the selection, like a native sheet.
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.kpi-card')) return;
    const ctx = window.__bxCtx;
    if (ctx && ctx.selected.size) BX.clickSelect(ctx, [...ctx.selected], e);
  });

  BX.run((ctx) => { window.__bxCtx = ctx; render(ctx); });
})();
