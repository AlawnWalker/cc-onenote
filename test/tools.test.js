import assert from "node:assert/strict";
import test from "node:test";

import { makeToolHandlers, renderResult } from "../lib/tools.js";

function fakeBridge(responder) {
  const calls = [];
  return {
    calls,
    async invoke(action, params) {
      calls.push({ action, params });
      return responder(action, params);
    },
  };
}

test("onenote_create lifts a leading '# Title' out of the markdown", async () => {
  const bridge = fakeBridge(() => ({ pageId: "{PAGE}", title: "标题", sectionId: "{SEC}" }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_create({ sectionId: "{SEC}", markdown: "# 标题\n\n正文\n" });

  assert.equal(result.ok, true);
  const call = bridge.calls[0];
  assert.equal(call.action, "create");
  assert.equal(call.params.title, "标题");
  assert.equal(call.params.blocks[0].type, "para");
  assert.equal(call.params.blocks[0].text, "正文");
});

test("onenote_create rejects markdown without a title", async () => {
  const bridge = fakeBridge(() => ({ pageId: "{PAGE}" }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_create({ sectionId: "{SEC}", markdown: "只有正文" });
  assert.equal(result.ok, false);
  assert.equal(result.code, "BAD_ARGUMENT");
  assert.equal(bridge.calls.length, 0);
});

test("onenote_read renders the page as markdown", async () => {
  const bridge = fakeBridge(() => ({
    pageId: "{PAGE}",
    title: "页面",
    lastModified: "2026-10-29T00:00:00.000Z",
    blocks: [
      { type: "para", text: "━━━ 小节 ━━━", level: 0 },
      { type: "bullet", text: "条目", level: 0 },
    ],
  }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_read({ pageId: "{PAGE}" });
  assert.equal(result.ok, true);
  assert.match(result.data.markdown, /## 小节/);
  assert.match(result.data.markdown, /- 条目/);

  const rendered = renderResult({}, result);
  assert.match(rendered[0].text, /^# 页面/);
  assert.match(rendered[0].text, /pageId: \{PAGE\}/);
});

test("onenote_update forwards an explicit title and strips it from the body", async () => {
  const bridge = fakeBridge(() => ({ pageId: "{PAGE}", updated: true }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_update({
    pageId: "{PAGE}",
    markdown: "# 新标题\n\n正文\n",
  });
  assert.equal(result.ok, true);
  assert.equal(bridge.calls[0].params.title, "新标题");
  assert.deepEqual(
    bridge.calls[0].params.blocks.map((block) => block.type),
    ["para"],
  );
});

test("onenote_publish validates the format and resolves relative paths", async () => {
  const bridge = fakeBridge(() => ({ path: "out/p.one", bytes: 1 }));
  const handlers = makeToolHandlers({ bridge });
  const bad = await handlers.onenote_publish({ pageId: "{PAGE}", path: "out/p.exe", format: "exe" });
  assert.equal(bad.ok, false);
  assert.equal(bad.code, "BAD_ARGUMENT");
  assert.equal(bridge.calls.length, 0);

  const good = await handlers.onenote_publish({ pageId: "{PAGE}", path: "out/p.pdf", format: "pdf" });
  assert.equal(good.ok, true);
  assert.equal(bridge.calls[0].params.format, "pdf");
});

test("bridge failures surface as structured tool errors", async () => {
  const bridge = {
    async invoke() {
      const err = new Error("page not found: 不存在");
      err.code = "PAGE_NOT_FOUND";
      throw err;
    },
  };
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_read({ pageTitle: "不存在" });
  assert.deepEqual(result, { ok: false, code: "PAGE_NOT_FOUND", message: "page not found: 不存在" });
});

test("onenote_list passes filters and limits through", async () => {
  const bridge = fakeBridge(() => ({ notebooks: [], localSections: [], counts: {} }));
  const handlers = makeToolHandlers({ bridge });
  await handlers.onenote_list({ notebook: "Work", includePages: false, maxSections: 50, maxPages: 10 });
  assert.deepEqual(bridge.calls[0].params, {
    notebook: "Work",
    section: undefined,
    includePages: false,
    includeRecycleBin: false,
    maxSections: 50,
    maxPages: 10,
  });
});

test("onenote_list rejects negative limits", async () => {
  const bridge = fakeBridge(() => ({ notebooks: [] }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_list({ maxSections: -1 });
  assert.equal(result.ok, false);
  assert.equal(bridge.calls.length, 0);
});

test("onenote_read forwards maxBlocks and surfaces truncation", async () => {
  const bridge = fakeBridge(() => ({
    pageId: "{PAGE}",
    title: "T",
    lastModified: "2026-11-03T00:00:00.000Z",
    blockCount: 100,
    truncated: true,
    blocks: [{ type: "para", text: "first", level: 0 }],
  }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_read({ pageId: "{PAGE}", maxBlocks: 20 });
  assert.equal(result.ok, true);
  assert.equal(bridge.calls[0].params.maxBlocks, 20);
  assert.equal(result.data.blockCount, 100);
  assert.equal(result.data.truncated, true);
  const rendered = renderResult({}, result);
  assert.match(rendered[0].text, /截断/);
});

test("onenote_create_section forwards path and keepBlankPage", async () => {
  const bridge = fakeBridge(() => ({ sectionId: "{SEC}", path: "notes/x.one", created: true }));
  const handlers = makeToolHandlers({ bridge });
  const result = await handlers.onenote_create_section({ path: "notes/x.one", keepBlankPage: true });
  assert.equal(result.ok, true);
  assert.equal(bridge.calls[0].action, "createsection");
  assert.equal(bridge.calls[0].params.path, "notes/x.one");
  assert.equal(bridge.calls[0].params.keepBlankPage, true);
});

test("onenote_rename_section requires sectionId or path", async () => {
  const bridge = fakeBridge(() => ({ sectionId: "{SEC}", name: "new" }));
  const handlers = makeToolHandlers({ bridge });
  const blocked = await handlers.onenote_rename_section({ name: "new" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.code, "BAD_ARGUMENT");
  assert.equal(bridge.calls.length, 0);

  const ok = await handlers.onenote_rename_section({ sectionId: "{SEC}", name: "new" });
  assert.equal(ok.ok, true);
  assert.equal(bridge.calls[0].action, "renamesection");
  assert.equal(bridge.calls[0].params.name, "new");
});
