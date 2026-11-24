// Shared plumbing for Bleckmann viz extensions. An extension only writes a
// render(ctx) function and calls BX.run(render); this file handles init, data
// paging, the encoding map, selection sync, hover tooltips and re-rendering on
// data change, selection change and resize.
//
// API facts this relies on (verified against tableau/extensions-api 1.17):
// - a row's tupleId is its 1-based position in the summary data, read with
//   ignoreSelection: true (same as the official Sankey sample)
// - encoding fields are matched to data columns by field.name === column.fieldName
// - one encoding can hold several fields when the .trex allows max-count > 1
window.BX = (function () {
  'use strict';

  const COLORS = {
    red: '#d20c14', dark: '#545960', ink: '#292929', grid: '#dcdddf',
    panel: '#f3f4f4', context: '#8e9196', green: '#6c8265', amber: '#f3ba44'
  };

  // ---- data -------------------------------------------------------------

  async function getRows (worksheet) {
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    const rows = [];
    try {
      for (let p = 0; p < reader.pageCount; p++) {
        const page = await reader.getPageAsync(p);
        for (const values of page.data) {
          const row = { __tupleId: rows.length + 1 };
          for (const col of page.columns) row[col.fieldName] = values[col.index];
          rows.push(row);
        }
      }
    } finally {
      await reader.releaseAsync();
    }
    return rows;
  }

  // { encodingId: [field, ...] } - only encodings that have a field on them.
  async function getEncodings (worksheet) {
    const spec = await worksheet.getVisualSpecificationAsync();
    const map = {};
    if (spec.activeMarksSpecificationIndex < 0) return map;
    const card = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    for (const e of card.encodings) (map[e.id] = map[e.id] || []).push(e.field);
    return map;
  }

  // Selected marks come back as data rows, not tupleIds: match them on every column.
  async function getSelectedTupleIds (worksheet, rows) {
    const ids = new Set();
    const sel = await worksheet.getSelectedMarksAsync();
    const table = sel && sel.data && sel.data[0];
    if (!table || !table.data.length) return ids;
    const key = (get) => table.columns.map(c => String(get(c))).join('\u0000');
    const wanted = new Set(table.data.map(r => key(c => r[c.index].value)));
    for (const row of rows) {
      if (wanted.has(key(c => row[c.fieldName] && row[c.fieldName].value))) ids.add(row.__tupleId);
    }
    return ids;
  }

  // ---- reading values ---------------------------------------------------

  const field = (enc, id, i = 0) => (enc[id] || [])[i];
  const fields = (enc, id) => enc[id] || [];
  const cell = (row, f) => (f ? row[f.name] : undefined);

  function num (row, f) {
    const c = cell(row, f);
    if (!c || c.value === null || c.value === undefined || c.value === '%null%') return null;
    const n = typeof c.value === 'number' ? c.value : Number(c.value);
    return Number.isFinite(n) ? n : null;
  }

  const text = (row, f) => { const c = cell(row, f); return c ? c.formattedValue : ''; };

  // Sort key for dimension values: dates, numbers, then strings.
  function sortKey (row, f) {
    const c = cell(row, f);
    if (!c) return '';
    const v = c.nativeValue !== undefined ? c.nativeValue : c.value;
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    const t = Date.parse(v);
    return Number.isNaN(t) ? String(v) : t;
  }

  // "SUM(Units Shipped)" -> "Units Shipped"; "MONTH(Date)" -> "Date"
  const cleanName = (f) => (f ? f.name.replace(/^[A-Za-z]+\((.*)\)$/, '$1') : '');

  // Group rows by the formatted values of the given dimension fields, keeping first-seen order.
  function groupBy (rows, dimFields) {
    const groups = new Map();
    for (const row of rows) {
      const k = dimFields.map(f => text(row, f)).join(' | ');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(row);
    }
    return groups;
  }

  // ---- interaction ------------------------------------------------------

  function anchor (evt) {
    return { tooltipAnchorPoint: { x: evt ? evt.pageX : 0, y: evt ? evt.pageY : 0 } };
  }

  // Click semantics match native Tableau: click selects, ctrl/cmd-click toggles,
  // clicking the only selected item clears.
  function clickSelect (ctx, tupleIds, evt) {
    const multi = evt && (evt.ctrlKey || evt.metaKey);
    const current = ctx.selected;
    const allIn = tupleIds.every(t => current.has(t));
    let next;
    if (multi) {
      next = new Set(current);
      tupleIds.forEach(t => (allIn ? next.delete(t) : next.add(t)));
    } else {
      next = allIn && current.size === tupleIds.length ? new Set() : new Set(tupleIds);
    }
    ctx.selected = next;
    ctx.rerender();
    return ctx.worksheet.selectTuplesAsync([...next], tableau.SelectOptions.Simple, anchor(evt));
  }

  function hover (ctx, tupleId, evt) {
    return ctx.worksheet.hoverTupleAsync(tupleId, anchor(evt)).catch(() => {});
  }

  // ---- drawing helpers --------------------------------------------------

  function el (tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') node.className = v;
      // setProperty, not Object.assign: assignment silently drops CSS custom properties (--x).
      else if (k === 'style' && typeof v === 'object') for (const [p, pv] of Object.entries(v)) node.style.setProperty(p.replace(/[A-Z]/g, m => '-' + m.toLowerCase()), pv);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) {
      if (c === null || c === undefined || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Minimal sparkline: grey line, last point emphasised in red (Bleckmann emphasis style).
  function sparkline (values, { height = 32, color = COLORS.context, last = COLORS.red } = {}) {
    const pts = values.map((v, i) => [i, v]).filter(p => p[1] !== null);
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'bx-spark');
    svg.setAttribute('height', height);
    svg.setAttribute('width', '100%');
    if (pts.length < 2) return svg;
    const W = 100; const pad = 3;
    const ys = pts.map(p => p[1]);
    const min = Math.min(...ys); const max = Math.max(...ys);
    const n = values.length - 1 || 1;
    const x = i => (i / n) * W;
    const y = v => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - 2 * pad));
    svg.setAttribute('viewBox', `0 0 ${W} ${height}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', pts.map((p, k) => `${k ? 'L' : 'M'}${x(p[0]).toFixed(2)},${y(p[1]).toFixed(2)}`).join(''));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(path);
    const [li, lv] = pts[pts.length - 1];
    // Drawn as a zero-length round-capped line so preserveAspectRatio=none cannot squash it.
    const dot = document.createElementNS(NS, 'path');
    dot.setAttribute('d', `M${x(li)},${y(lv)}l0,0`);
    dot.setAttribute('stroke', last);
    dot.setAttribute('stroke-width', '5');
    dot.setAttribute('stroke-linecap', 'round');
    dot.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.append(dot);
    return svg;
  }

  function empty (root, message) {
    root.replaceChildren(el('div', { class: 'bx-empty' }, message));
  }

  // ---- lifecycle --------------------------------------------------------

  // render(ctx) receives: { worksheet, rows, enc, selected:Set<tupleId>, root, rerender }
  function run (render) {
    window.addEventListener('load', async () => {
      const root = document.getElementById('content');
      try {
        await tableau.extensions.initializeAsync();
      } catch (e) {
        empty(root, 'This page is a Tableau viz extension. Add its .trex file to a worksheet in Tableau (Marks card > Add Extension).');
        return;
      }
      const worksheet = tableau.extensions.worksheetContent.worksheet;
      const ctx = { worksheet, rows: [], enc: {}, selected: new Set(), root };
      let pending = null;

      // Debounced render. rAF alone is not enough: browsers withhold rAF for hidden or
      // throttled frames (a hidden dashboard tab, headless Chrome), and a pending rAF
      // that never fires would block every later render. Whichever fires first wins.
      const doRender = () => {
        if (!pending) return;
        cancelAnimationFrame(pending.raf);
        clearTimeout(pending.timer);
        pending = null;
        try { render(ctx); } catch (e) { console.error(e); empty(root, 'Render error: ' + e.message); }
        document.body.dataset.bxRendered = String(Number(document.body.dataset.bxRendered || 0) + 1);
      };
      ctx.rerender = () => {
        if (pending) return;
        pending = { raf: requestAnimationFrame(doRender), timer: setTimeout(doRender, 100) };
      };

      const refresh = async () => {
        [ctx.rows, ctx.enc] = await Promise.all([getRows(worksheet), getEncodings(worksheet)]);
        ctx.selected = await getSelectedTupleIds(worksheet, ctx.rows).catch(() => new Set());
        ctx.rerender();
      };
      const resync = async () => {
        ctx.selected = await getSelectedTupleIds(worksheet, ctx.rows).catch(() => ctx.selected);
        ctx.rerender();
      };

      worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
      worksheet.addEventListener(tableau.TableauEventType.MarkSelectionChanged, resync);
      window.addEventListener('resize', ctx.rerender);
      await refresh();
    });
  }

  return {
    COLORS, run, getRows, getEncodings, getSelectedTupleIds,
    field, fields, cell, num, text, sortKey, cleanName, groupBy,
    clickSelect, hover, el, sparkline, empty
  };
})();
