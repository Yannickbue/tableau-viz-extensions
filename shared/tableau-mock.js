// Offline stand-in for the Tableau Extensions API, used only when the page is
// opened with ?mock=<fixture.json> (see lib-loader.js). It implements the subset
// of the viz-extension API that shared/bleckmann-ext.js uses, so an extension can
// be rendered and tested in a normal or headless browser without Tableau.
//
// Fixture format (path relative to the extension's index.html):
// {
//   "encodings": { "<encoding id>": ["<field name>", ...] },
//   "columns":   ["<field name>", ...],
//   "formats":   { "<field name>": "number" | "pct" | "month" | "day" | "text" },
//   "rows":      [[<value>, ...], ...]
// }
// Every call the extension makes into Tableau is logged on window.__bxCalls.
(function () {
  'use strict';

  window.__bxCalls = [];
  const log = (name, args) => window.__bxCalls.push({ name, args });

  const listeners = {};
  let fixture = null;
  let selected = new Set(); // tupleIds (1-based row positions)

  function format (value, kind) {
    if (value === null || value === undefined) return 'Null';
    switch (kind) {
      case 'pct': return (value * 100).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + '%';
      // en-US: Chrome's en-GB short month is "Sept", which Tableau never produces.
      case 'month': return new Date(value).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      case 'day': return new Date(value).toLocaleDateString('en-GB');
      case 'number': return Number(value).toLocaleString('en-GB', { maximumFractionDigits: 1 });
      default: return String(value);
    }
  }

  function dataTable (rowIndexes) {
    const kindOf = (c) => (fixture.formats || {})[fixture.columns[c]];
    const columns = fixture.columns.map((fieldName, index) => {
      const k = kindOf(index);
      const sample = fixture.rows.length ? fixture.rows[0][index] : null;
      const dataType = k === 'month' || k === 'day' ? 'date' : typeof sample === 'number' ? 'float' : 'string';
      return { fieldName, index, dataType };
    });
    const data = rowIndexes.map(i => fixture.rows[i].map((v, c) => {
      const kind = (fixture.formats || {})[fixture.columns[c]] || (typeof v === 'number' ? 'number' : 'text');
      return { value: v, nativeValue: v, formattedValue: format(v, kind) };
    }));
    return { columns, data, totalRowCount: data.length };
  }

  function fire (type) {
    (listeners[type] || []).forEach(fn => fn({ type }));
  }

  const worksheet = {
    name: 'Mock sheet',
    async getSummaryDataReaderAsync (pageRowCount, options) {
      log('getSummaryDataReaderAsync', [pageRowCount, options]);
      const all = fixture.rows.map((_, i) => i);
      return {
        pageCount: 1,
        totalRowCount: all.length,
        async getPageAsync () { return dataTable(all); },
        async releaseAsync () {}
      };
    },
    async getVisualSpecificationAsync () {
      const encodings = [];
      // Built-in tiles are reported by type (no custom id) - an assumption until verified
      // in Tableau; BX.detailFields falls back to unclaimed columns either way.
      for (const [id, names] of Object.entries(fixture.encodings || {})) {
        const builtIn = id === 'detail' || id === 'tooltip';
        for (const name of names) encodings.push(builtIn ? { type: id, field: { name } } : { id, field: { name } });
      }
      return { activeMarksSpecificationIndex: 0, marksSpecifications: [{ encodings }] };
    },
    async getSelectedMarksAsync () {
      return { data: [dataTable([...selected].map(t => t - 1))] };
    },
    async selectTuplesAsync (tupleIds, selectOption, tooltip) {
      log('selectTuplesAsync', [tupleIds, selectOption, tooltip]);
      selected = new Set(tupleIds);
      fire('mark-selection-changed');
    },
    async hoverTupleAsync (tupleId, tooltip) {
      log('hoverTupleAsync', [tupleId, tooltip]);
    },
    addEventListener (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
      return () => { listeners[type] = listeners[type].filter(f => f !== fn); };
    }
  };

  window.tableau = {
    TableauEventType: {
      SummaryDataChanged: 'summary-data-changed',
      MarkSelectionChanged: 'mark-selection-changed',
      WorkbookFormattingChanged: 'workbook-formatting-changed'
    },
    SelectOptions: { Simple: 'select-options-simple', Toggle: 'select-options-toggle' },
    ClassNameKey: { Worksheet: 'tableau-worksheet', Tooltip: 'tableau-tooltip' },
    extensions: {
      environment: { mode: 'mock' },
      worksheetContent: { worksheet },
      settings: { getAll: () => ({}), get: () => undefined, set () {}, async saveAsync () {} },
      async initializeAsync () {
        const path = new URLSearchParams(window.location.search).get('mock');
        const res = await fetch(path, { cache: 'no-store' });
        if (!res.ok) throw new Error('Mock fixture not found: ' + path);
        fixture = await res.json();
        log('initializeAsync', [path]);
      }
    },
    // Test hook: replace the data and fire SummaryDataChanged, like a filter change in Tableau.
    __mockSetRows (rows) { fixture.rows = rows; selected.clear(); fire('summary-data-changed'); }
  };

  // Headless test hook (tools/check.py): ?click=<css selector> clicks that element
  // once the first render is done; the call log is then written to <pre id="bx-calls">
  // so it survives chrome --dump-dom.
  const params = new URLSearchParams(window.location.search);
  const rendered = () => Number(document.body && document.body.dataset.bxRendered || 0);
  // Bounded wait: the call log is always written, and a stalled render shows up as a
  // 'test:timeout' entry instead of a page that never finishes.
  const waitFor = (pred, what, ms = 4000) => new Promise(resolve => {
    const start = Date.now();
    const t = setInterval(() => {
      if (pred()) { clearInterval(t); resolve(); } else if (Date.now() - start > ms) {
        clearInterval(t); log('test:timeout', [what]); resolve();
      }
    }, 20);
  });
  window.addEventListener('load', async () => {
    await waitFor(() => rendered() >= 1, 'first render');
    const sel = params.get('click');
    if (sel) {
      const before = rendered();
      const target = document.querySelector(sel);
      log('test:click', [sel, !!target]);
      if (target) target.click();
      await waitFor(() => rendered() > before, 'render after click');
    }
    await new Promise(r => setTimeout(r, 50));
    const pre = document.createElement('pre');
    pre.id = 'bx-calls';
    pre.hidden = true;
    pre.textContent = JSON.stringify(window.__bxCalls);
    document.body.append(pre);
  });
})();
