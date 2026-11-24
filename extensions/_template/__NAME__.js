// Bleckmann __TITLE__ - starting point. Replace render() with the real visual.
// Encoding ids come from manifest.trex; BX helpers are in shared/bleckmann-ext.js.
(function () {
  'use strict';
  const { el, field, text } = BX;

  function render (ctx) {
    const { enc, rows, root } = ctx;
    const fLabel = field(enc, 'label');
    const fValue = field(enc, 'value');
    if (!fValue) return BX.empty(root, 'Drag a measure onto Value.');
    if (!rows.length) return BX.empty(root, 'No data for the current filters.');

    const list = el('ul', { class: 'ext-list' + (ctx.selected.size ? ' has-selection' : '') },
      rows.map(row => el('li', {
        class: 'ext-row' + (ctx.selected.has(row.__tupleId) ? ' is-selected' : ''),
        'data-row': fLabel ? text(row, fLabel) : 'value',
        onclick: (e) => { e.stopPropagation(); BX.clickSelect(ctx, [row.__tupleId], e); },
        onmouseenter: (e) => BX.hover(ctx, row.__tupleId, e)
      },
      el('span', { class: 'k' }, fLabel ? text(row, fLabel) : BX.cleanName(fValue)),
      el('span', { class: 'v' }, text(row, fValue)))));
    root.replaceChildren(list);
  }

  BX.run(render);
})();
