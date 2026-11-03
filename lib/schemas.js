/**
 * onenote-mcp — tool catalog and standard JSON Schema.
 *
 * Extracted from the DSH plugin's index.js so the MCP server advertises the
 * same tools without pulling in the DSH host. Parameter schemas use standard
 * JSON Schema (MCP has no DSH value-schema DSL restrictions), and the tool
 * descriptions carry the known limitations from the handover design (§12).
 */

const str = (description) => ({ type: "string", description });
const int = (description) => ({ type: "integer", description });
const bool = (description) => ({ type: "boolean", description });

const PAGE_LOCATOR = {
  pageId: str("OneNote page ID (from onenote_list / onenote_search). Highest priority."),
  pageTitle: str("Page title to resolve when pageId is not given (exact match first, then substring)."),
  sectionId: str("Section ID used together with pageTitle."),
  sectionName: str("Section name used together with pageTitle (e.g. 快速笔记)."),
};

export const TOOL_NAMES = Object.freeze([
  "onenote_list",
  "onenote_read",
  "onenote_search",
  "onenote_create",
  "onenote_update",
  "onenote_append",
  "onenote_publish",
  "onenote_delete",
  "onenote_create_section",
  "onenote_rename_section",
]);

export const TOOL_PARAMETERS = Object.freeze({
  onenote_list: {
    notebook: str("Filter by notebook name or ID (substring match)."),
    section: str("Filter by section name or ID (substring match)."),
    includePages: bool("Include page lists (default true). Set false for a compact notebook/section map."),
    includeRecycleBin: bool("Include recycle-bin sections and deleted pages (default false)."),
    maxSections: int("Cap the number of sections returned (0 = all, default)."),
    maxPages: int("Cap the pages returned per section (0 = all, default)."),
  },
  onenote_read: {
    ...PAGE_LOCATOR,
    maxBlocks: int("Cap the number of content blocks returned (0 = all, default)."),
  },
  onenote_search: {
    query: str("Text to look for. Page titles are matched first (case-insensitive substring)."),
    scopeId: str("Optional notebook/section/group ID limiting the search scope."),
    limit: int("Max results (default 20)."),
    includeContent: bool("Also scan page text, not just titles (slower; default false)."),
    maxScan: int("Max pages whose text is read when includeContent=true (default 200)."),
    includeRecycleBin: bool("Include pages that live in a recycle-bin section (default false)."),
  },
  onenote_create: {
    sectionId: str("Target section ID (preferred)."),
    sectionName: str("Target section name, used when sectionId is absent."),
    notebook: str("Notebook name used to disambiguate sectionName."),
    title: str("Page title. Optional when markdown starts with '# Title'."),
    markdown: str("Page body in the supported markdown subset."),
  },
  onenote_update: {
    ...PAGE_LOCATOR,
    title: str("New page title. Omit to keep the current title."),
    markdown: str("New page body; replaces all existing text outlines on the page."),
  },
  onenote_append: {
    ...PAGE_LOCATOR,
    title: str("Optional new page title."),
    markdown: str("Content appended as a new outline at the end of the page."),
  },
  onenote_publish: {
    ...PAGE_LOCATOR,
    path: str("Absolute target file path. Existing files are replaced unless overwrite=false."),
    format: str("one | onepkg | mht | pdf | xps | docx | emf | html (default one)."),
    overwrite: bool("Replace an existing target file (default true)."),
  },
  onenote_delete: {
    ...PAGE_LOCATOR,
    permanent: bool("Skip the recycle bin and delete permanently (default false)."),
  },
  onenote_create_section: {
    path: str("Absolute path of the .one file to create or open (a folder path ending in .one)."),
    keepBlankPage: bool("Keep the empty page OneNote adds to a new section (default false: it is removed)."),
  },
  onenote_rename_section: {
    sectionId: str("Section ID to rename (from onenote_list)."),
    path: str("Standalone .one path, used when sectionId is absent."),
    name: str("New section name."),
  },
});

export const TOOL_REQUIRED = Object.freeze({
  onenote_list: [],
  onenote_read: [],
  onenote_search: ["query"],
  onenote_create: ["markdown"],
  onenote_update: ["markdown"],
  onenote_append: ["markdown"],
  onenote_publish: ["path"],
  onenote_delete: [],
  onenote_create_section: ["path"],
  onenote_rename_section: ["name"],
});

export const TOOL_DESCRIPTIONS = Object.freeze({
  onenote_list:
    "List OneNote notebooks, sections and pages (local desktop OneNote via COM). Includes configured local sections that are not part of an open notebook.",
  onenote_read:
    "Read a OneNote page and return it as markdown (headings, lists, tables, code lines). Headings are recognised by their font size relative to the body; legacy symbol headings (━━━ / ▌) are still read. Resolve the page by pageId, or by section + pageTitle. Fenced-code language markers are lost on write, so code reads back as a bare fence.",
  onenote_search:
    "Search OneNote pages by title (case-insensitive substring). Set includeContent=true to also scan page text; that reads up to maxScan pages and is slower. No Windows Search index required.",
  onenote_create:
    "Create a new OneNote page from markdown in an existing section. Supports a markdown subset: # title, ##/### headings, bullets, numbered lists, tables, fenced code, quotes. ## and ### become real sized paragraphs (body +4pt / +2pt, with paragraph spacing); the page background follows the ONENOTE_PAGECOLOR setting. Numbered lists are stored as bullet + number (OneNote rejects one:Number); other inline styles, fonts, colors and images are not applied.",
  onenote_update:
    "Replace the text content of an existing OneNote page (keeps the page ID). All existing text outlines are removed first, so embedded images/ink inside outlines are lost; page-level images are kept.",
  onenote_append:
    "Append a new outline with markdown content to the end of an existing OneNote page, leaving existing content untouched.",
  onenote_publish:
    "Export a OneNote page to a file: .one, .onepkg, .pdf, .docx, .xps, .mht, .html or .emf. The target must be an absolute path with backslashes (forward slashes fail). PDF export always has a white background.",
  onenote_delete:
    "Delete a OneNote page (moved to the recycle bin unless permanent=true).",
  onenote_create_section:
    "Create a standalone OneNote section (.one file) at an absolute path, or open it when it already exists. When the new section comes with an empty placeholder page it is removed unless keepBlankPage=true.",
  onenote_rename_section:
    "Rename a section. Notebook sections can be renamed; standalone .one sections are read-only in OneNote and fail with SECTION_READ_ONLY (0x8004200B).",
});

/**
 * Build the standard JSON Schema the MCP client and model see for one tool.
 * The DSH plugin keeps `required` as a separate map; MCP wants it inline.
 */
export function buildJsonSchema(toolName) {
  return {
    type: "object",
    properties: TOOL_PARAMETERS[toolName] ?? {},
    required: TOOL_REQUIRED[toolName] ?? [],
  };
}
