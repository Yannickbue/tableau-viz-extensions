// Bleckmann drill down tree (decomposition tree).
// The Levels encoding holds 1-6 dimensions in drill order. The tree starts at the
// total of Value; clicking a node opens the next level for that member and selects
// its marks in Tableau, so dashboard actions follow the drill path.
(function () {
  'use strict';
  const { el, field, fields, text, num, cleanName } = BX;

  const NODE_W = 190;     // column width
  const GAP = 56;         // space for the connectors between columns
  const ROW_H = 42;       // height of one node
  const BAR_Y = 27;       // vertical centre of the bar inside a node (connector anchor)
  const HEAD_H = 44;      // column header
  const MAX_NODES = 12;   // per column; the rest is summarised as "+ n more"
  const NON_ADDITIVE = /^(AVG|MEDIAN|CNTD|COUNTD|MIN|MAX|STDEV|STDEVP|VAR|VARP|AGG|ATTR|PCT\d*)\(/i;

  // Drill path: the member picked at each level. Survives re-renders.
  let path = [];

  const fmt = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });
  const fmtPct = new Intl.NumberFormat('en-GB', { style: 'percent', maximumFractionDigits: 0 });

  function label (row, f) {
    const t = text(row, f);
    return t === '' || t === null || t === undefined ? '(blank)' : String(t);
  }

  function sum (rows, f) {
    let s = 0; let any = false;
    for (const r of rows) { const v = num(r, f); if (v !== null) { s += v; any = true; } }
    return any ? s : null;
  }

  // Members of one level under a parent, largest absolute value first (so big
  // negatives stay visible), no value last.
  function children (parent, fLevel, fValue) {
    const groups = new Map();
    for (const r of parent.rows) {
      const k = label(r, fLevel);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const out = [...groups].map(([name, rs]) => {
      const value = sum(rs, fValue);
      return { name, rows: rs, value, share: parent.value ? (value || 0) / parent.value : null };
    });
    out.sort((a, b) => (a.value === null) - (b.value === null) || Math.abs(b.value || 0) - Math.abs(a.value || 0));
    return out;
  }

  function svgEl (tag, attrs) {
    const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  }

  function clearSelection (ctx) {
    if (!ctx.selected.size) return;
    ctx.selected = new Set();
    ctx.worksheet.selectTuplesAsync([], tableau.SelectOptions.Simple, {});
  }

  function render (ctx) {
    const { enc, rows, root } = ctx;
    const levels = fields(enc, 'levels');
    const fValue = field(enc, 'value');
    if (!levels.length && !fValue) return BX.empty(root, 'Drag dimensions onto Levels (in drill order) and a measure onto Value.');
    if (!fValue) return BX.empty(root, 'Drag a measure onto Value.');
    if (!levels.length) return BX.empty(root, 'Drag one or more dimensions onto Levels, in the order you want to drill.');
    if (!rows.length) return BX.empty(root, 'No data for the current filters.');

    // Columns: the total, then one column per level along the drill path.
    const rootNode = { name: cleanName(fValue), rows, value: sum(rows, fValue), share: 1, isRoot: true, onPath: true };
    const columns = [{ header: 'Total', sub: '', nodes: [rootNode], hidden: 0, level: -1 }];
    const keep = [];
    let parent = rootNode;
    for (let lv = 0; lv < levels.length; lv++) {
      const kids = children(parent, levels[lv], fValue);
      const shown = kids.slice(0, MAX_NODES);
      const picked = shown.find(k => k.name === path[lv]);
      columns.push({ header: cleanName(levels[lv]), sub: picked ? picked.name : '', nodes: shown, hidden: kids.length - shown.length, level: lv, parent });
      if (!picked) break;
      picked.onPath = true;
      keep.push(picked.name);
      parent = picked;
    }
    path = keep;   // drops members that disappeared after a filter change

    // Each column is centred on its parent node; then shift so the top node is at 0.
    let parentY = 0;
    for (const col of columns) {
      const n = col.nodes.length + (col.hidden ? 1 : 0);
      const top = parentY - ((n - 1) * ROW_H) / 2;
      col.nodes.forEach((node, i) => { node.y = top + i * ROW_H; });
      col.moreY = top + col.nodes.length * ROW_H;
      const p = col.nodes.find(nd => nd.onPath);
      if (p) parentY = p.y;
    }
    const all = columns.flatMap(c => c.nodes);
    const minY = Math.min(...all.map(n => n.y));
    const maxY = Math.max(...all.map(n => n.y), ...columns.filter(c => c.hidden).map(c => c.moreY));
    all.forEach(n => { n.y -= minY; });
    columns.forEach(c => { c.moreY -= minY; });
    const height = HEAD_H + (maxY - minY) + ROW_H + 8;
    const width = columns.length * (NODE_W + GAP) - GAP + 8;

    const selected = ctx.selected;
    // Outline only the node whose marks are exactly the selection, not its sub-branches.
    const isSelected = (node) => !node.isRoot && selected.size === node.rows.length && node.rows.every(r => selected.has(r.__tupleId));

    // Connectors, drawn behind the nodes.
    const svg = svgEl('svg', { class: 'dt-links', width, height });
    columns.forEach((col, ci) => {
      if (ci === 0) return;
      const x1 = (ci - 1) * (NODE_W + GAP) + NODE_W;
      const x2 = ci * (NODE_W + GAP);
      const y1 = HEAD_H + col.parent.y + BAR_Y;
      const mx = (x1 + x2) / 2;
      col.nodes.forEach(n => {
        const y2 = HEAD_H + n.y + BAR_Y;
        svg.append(svgEl('path', {
          class: 'dt-link' + (n.onPath ? ' on-path' : ''),
          d: `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`
        }));
      });
    });

    const canvas = el('div', { class: 'dt-canvas', style: { width: width + 'px', height: height + 'px' } }, svg);

    columns.forEach((col, ci) => {
      const x = ci * (NODE_W + GAP);
      canvas.append(el('div', { class: 'dt-head', style: { left: x + 'px', width: NODE_W + 'px' } },
        el('div', { class: 'dt-head-name' }, col.header),
        el('div', { class: 'dt-head-sub' }, col.sub || ' ')));

      // One scale per column: the longest bar is the largest absolute value in it.
      const maxAbs = Math.max(...col.nodes.map(n => Math.abs(n.value || 0))) || 1;

      col.nodes.forEach(node => {
        const drillable = !node.isRoot && col.level < levels.length - 1;
        const neg = node.value !== null && node.value < 0;
        const pct = node.isRoot ? '100%' : node.share === null ? '' : fmtPct.format(node.share);
        const valueText = node.value === null ? 'No value'
          : node.rows.length === 1 ? text(node.rows[0], fValue) : fmt.format(node.value);
        const tip = `${node.name}\n${cleanName(fValue)}: ${valueText}` +
          (node.isRoot ? '' : `\nShare of ${col.parent.name}: ${pct}`) +
          (drillable ? `\nClick to ${node.onPath ? 'close' : 'open'} ${cleanName(levels[col.level + 1])}` : '');
        const cls = ['dt-node',
          node.isRoot ? 'is-root' : node.onPath ? 'on-path' : '',
          neg ? 'neg' : '',
          isSelected(node) ? 'is-selected' : ''].filter(Boolean).join(' ');

        canvas.append(el('button', {
          class: cls,
          type: 'button',
          title: tip,
          'data-node': node.isRoot ? 'root' : node.name,
          'data-level': node.isRoot ? 'root' : String(col.level),
          style: { left: x + 'px', top: (HEAD_H + node.y) + 'px', width: NODE_W + 'px', height: ROW_H + 'px' },
          onclick: (e) => {
            e.stopPropagation();
            if (node.isRoot || node.onPath) {
              // Root resets the tree; an open node closes and gives up its selection.
              path = node.isRoot ? [] : path.slice(0, col.level);
              clearSelection(ctx);
              ctx.rerender();
              return;
            }
            path = path.slice(0, col.level).concat(node.name);
            BX.clickSelect(ctx, node.rows.map(r => r.__tupleId), e);
          },
          onmouseenter: node.rows.length === 1 ? (e) => BX.hover(ctx, node.rows[0].__tupleId, e) : null
        },
        el('span', { class: 'dt-label' },
          el('span', { class: 'dt-name' }, node.name),
          pct ? el('span', { class: 'dt-pct' }, pct) : null),
        el('span', { class: 'dt-barline' },
          el('span', { class: 'dt-track' },
            el('span', { class: 'dt-bar', style: { width: (Math.abs(node.value || 0) / maxAbs * 100).toFixed(1) + '%' } })),
          el('span', { class: 'dt-value' }, valueText),
          el('span', { class: 'dt-toggle', 'aria-hidden': 'true' }, drillable ? (node.onPath ? '−' : '+') : ''))));
      });

      if (col.hidden) {
        canvas.append(el('div', {
          class: 'dt-more',
          style: { left: x + 'px', top: (HEAD_H + col.moreY) + 'px', width: NODE_W + 'px' }
        }, `+ ${col.hidden} smaller ${col.hidden === 1 ? 'member' : 'members'} not shown`));
      }
    });

    const parts = [];
    if (NON_ADDITIVE.test(fValue.name)) {
      parts.push(el('div', { class: 'bx-notice' },
        `Value is ${fValue.name}. The tree adds values up per branch, which is only right for an additive measure: use SUM or COUNT on Value.`));
    }
    if (all.some(n => n.value !== null && n.value < 0)) {
      parts.push(el('div', { class: 'dt-legend' }, el('span', { class: 'dt-swatch' }), 'Negative value'));
    }
    parts.push(canvas);
    root.replaceChildren(el('div', { class: 'dt-wrap' }, parts));
  }

  BX.run(render);
})();
