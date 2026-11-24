// Bleckmann KPI Cards - one card per member of the text field on "Card / Date".
//
// Tableau allows only 4 custom encodings (ids from manifest.trex):
//   card     dims, <= 2  a text field = one card per member (none = a single card);
//                        a date field = sparkline. Told apart by data type.
//   value    measure     the headline number (required)
//   target   measure x2  1st = target (status + progress bar), 2nd = amber threshold
//   compare  measure     delta vs this value; without it, with a date, vs the previous point
// Built-in Detail tile:
//   measures            extra "name: value" lines at the bottom of the card
//   "Lower is better"   a field with that name and value 1 flips status/delta colours
// Lower is better is also implied when the amber threshold is above the target.
// With a date, headline/target/compare come from the LAST point.
(function () {
  'use strict';
  const { el, num, text, field, cleanName } = BX;
  const CUSTOM = ['card', 'value', 'target', 'compare'];
  const isLowerFlag = (f) => /lower\s*is\s*better/i.test(cleanName(f));

  // Resolve the 4 custom encodings + Detail into the roles the card uses.
  function roles (ctx) {
    const { enc, rows } = ctx;
    const dims = enc.card || [];
    const details = BX.detailFields(ctx, CUSTOM);
    return {
      label: dims.find(f => !BX.isTemporal(rows, f)),
      trend: dims.find(f => BX.isTemporal(rows, f)),
      value: field(enc, 'value'),
      target: field(enc, 'target', 0),
      threshold: field(enc, 'target', 1),
      compare: field(enc, 'compare'),
      lowerFlag: details.find(isLowerFlag),
      details: details.filter(f => !isLowerFlag(f)).slice(0, 4)
    };
  }

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

  function card (ctx, R, title, rows) {
    const fValue = R.value; const fTrend = R.trend;
    const fTarget = R.target; const fThreshold = R.threshold;
    const fCompare = R.compare; const fLower = R.lowerFlag;

    const ordered = fTrend ? [...rows].sort((a, b) => {
      const x = BX.sortKey(a, fTrend); const y = BX.sortKey(b, fTrend);
      return x < y ? -1 : x > y ? 1 : 0;
    }) : rows;
    const cur = ordered[ordered.length - 1];
    const prev = ordered.length > 1 ? ordered[ordered.length - 2] : null;

    const v = num(cur, fValue);
    const target = num(cur, fTarget);
    const threshold = num(cur, fThreshold);
    const lower = num(cur, fLower) === 1 ||
      (target !== null && threshold !== null && threshold > target);
    const st = status(v, target, threshold, lower);

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

    if (R.details.length) {
      parts.push(el('ul', { class: 'kpi-details' },
        R.details.map(f => el('li', null,
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
    const { rows, root } = ctx;
    const R = roles(ctx);
    if (!R.value) {
      return BX.empty(root, 'Drag a measure onto Value. Add a text field on Card / Date for one card per member, a date for a sparkline.');
    }
    if (!rows.length) return BX.empty(root, 'No data for the current filters.');

    const groups = R.label ? BX.groupBy(rows, [R.label]) : new Map([[cleanName(R.value), rows]]);

    // Without a date each card should be exactly one row. More rows means a dimension
    // sits on Detail and splits the data: say so instead of guessing.
    const split = !R.trend && [...groups.values()].some(g => g.length > 1);

    const grid = el('div', { class: 'kpi-grid' + (ctx.selected.size ? ' has-selection' : '') },
      [...groups].map(([title, groupRows]) => card(ctx, R, title, groupRows)));
    // replaceChildren turns null into the text "null", so build the list explicitly.
    const nodes = [grid];
    if (split) {
      nodes.unshift(el('div', { class: 'bx-notice' },
        'Some cards have more than one row. Put dimensions on Card / Date only; fields on Detail should be measures.'));
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
