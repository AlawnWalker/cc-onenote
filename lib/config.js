/**
 * onenote-mcp — environment-driven configuration.
 *
 * Every tunable is read from environment variables so the server can be
 * registered in an MCP client (e.g. Claude Code) without a config file:
 *
 *   ONENOTE_POWERSHELL      powershell.exe   Windows PowerShell 5.1
 *   ONENOTE_TIMEOUT_MS      180000           single-call timeout (ms)
 *   ONENOTE_PAGECOLOR       #C7EDCC          #RRGGBB | automatic | none
 *   ONENOTE_PAGESIZE        ""               JSON object, or "automatic"
 *   ONENOTE_CODE_PREFIX     "│ "             prefix for each code-block line
 *   ONENOTE_ALIGN_COMMENT_COLUMN  0         0 | auto | N (trailing // comments)
 *   ONENOTE_ALIGN_COMMENT_MAX      80        cap for the automatic column
 *   ONENOTE_BULLET_VALUE    1                OneNote bullet glyph index
 *   ONENOTE_BULLET_VALUES   []               JSON array of per-level glyphs
 *   ONENOTE_EXTRASECTIONS   []               JSON array of { name, path }
 */

const DEFAULTS = Object.freeze({
  powershellPath: "powershell.exe",
  timeoutMs: 180000,
  // Matches the DSH plugin: generated pages get the eye-friendly green
  // (199,237,204). Set ONENOTE_PAGECOLOR="" to inherit OneNote's default.
  pageColor: "#C7EDCC",
  pageSize: null,
  // Code blocks: each source line gets this prefix (the box-drawing bar keeps
  // read-back working). "" removes the bar but loses the code type on read.
  codePrefix: "│ ",
  // 0 = leave comments where they are; "auto" aligns trailing // comments of
  // one fenced block to longest code + 2; N > 0 = fixed column.
  alignCommentColumn: 0,
  // Upper bound for the automatic comment column.
  alignCommentMax: 80,
  // OneNote bullet glyph index: 0 big black circle, 1 U+2022 (solid dot), ...
  bulletValue: 1,
  // Optional per-level glyphs, e.g. [20, 2]; the last entry repeats.
  bulletValues: [],
  extraSections: [],
});

function parseIntStrict(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function parseJson(raw, fallback) {
  if (raw === undefined || raw === null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/**
 * Page size in OneNote points (1/72 in). OneNote only accepts either
 * <Automatic/> or Orientation+Dimensions+Margins, so width/height are required.
 * The string "automatic" forces OneNote's Automatic size; null leaves the page
 * size untouched. Mirrors the DSH plugin's normalizePageSize.
 */
function normalizePageSize(value) {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "automatic" ? "automatic" : null;
  }
  if (!value || typeof value !== "object") return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const out = { width, height, landscape: Boolean(value.landscape) };
  if (value.margins && typeof value.margins === "object") {
    const margins = {};
    for (const key of ["top", "bottom", "left", "right"]) {
      const n = Number(value.margins[key]);
      if (Number.isFinite(n) && n >= 0) margins[key] = n;
    }
    if (Object.keys(margins).length > 0) out.margins = margins;
  }
  return out;
}

/**
 * Standalone sections (not part of an open notebook) get a fresh OneNote ID
 * after every restart, so the reliable key is the .one file path, not a cached
 * ID. The bridge resolves each path to its current ID per call.
 */
function normalizeExtraSections(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => entry && typeof entry === "object" && (typeof entry.path === "string" || typeof entry.id === "string"))
    .map((entry) => {
      const path = typeof entry.path === "string" ? entry.path.trim() : "";
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      return {
        name: typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : path || id,
        path,
        id,
      };
    })
    .filter((entry) => entry.path !== "" || entry.id !== "");
}

export function readConfig(env = process.env) {
  const powershellPath = (env.ONENOTE_POWERSHELL || "").trim() || DEFAULTS.powershellPath;

  const timeoutRaw = parseIntStrict(env.ONENOTE_TIMEOUT_MS, DEFAULTS.timeoutMs);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULTS.timeoutMs;

  // Unset falls back to the green default; an explicit empty string inherits
  // OneNote's own page color.
  const pageColorRaw = env.ONENOTE_PAGECOLOR;
  const pageColor = (pageColorRaw === undefined ? DEFAULTS.pageColor : pageColorRaw).trim();
  const pageColorSafe =
    /^#[0-9a-f]{6}$/i.test(pageColor) || pageColor === "automatic" || pageColor === "none" ? pageColor : "";

  const pageSize = normalizePageSize(parseJson(env.ONENOTE_PAGESIZE, null));

  // Code-block rendering (JS side): prefix and trailing-comment alignment.
  const codePrefix = env.ONENOTE_CODE_PREFIX === undefined ? DEFAULTS.codePrefix : String(env.ONENOTE_CODE_PREFIX);
  const alignRaw = env.ONENOTE_ALIGN_COMMENT_COLUMN;
  let alignCommentColumn = 0;
  if (alignRaw === "auto" || alignRaw === "true") {
    alignCommentColumn = "auto";
  } else {
    const column = parseIntStrict(alignRaw, 0);
    if (column > 0) alignCommentColumn = column;
  }
  const alignMax = parseIntStrict(env.ONENOTE_ALIGN_COMMENT_MAX, DEFAULTS.alignCommentMax);
  const alignCommentMax = alignMax > 0 ? alignMax : DEFAULTS.alignCommentMax;

  // Bullet glyphs (PowerShell side).
  const bulletRaw = parseIntStrict(env.ONENOTE_BULLET_VALUE, DEFAULTS.bulletValue);
  const bulletValue = bulletRaw >= 0 ? bulletRaw : DEFAULTS.bulletValue;
  const bulletParsed = parseJson(env.ONENOTE_BULLET_VALUES, []);
  const bulletValues = Array.isArray(bulletParsed)
    ? bulletParsed.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];

  const extraSections = normalizeExtraSections(parseJson(env.ONENOTE_EXTRASECTIONS, []));

  return {
    powershellPath,
    timeoutMs,
    pageColor: pageColorSafe,
    pageSize,
    codePrefix,
    alignCommentColumn,
    alignCommentMax,
    bulletValue,
    bulletValues,
    extraSections,
  };
}
