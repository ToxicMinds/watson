// Static inventory, not a replacement for rendered-screen review or an i18n runtime.
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/web/package.json"));
const ts = require(process.env.UI_COPY_TYPESCRIPT || "typescript");
const visibleAttributes = new Set(["title", "placeholder", "alt", "aria-label", "aria-description", "label", "description", "waiting"]);
const entities = { amp: "&", apos: "'", quot: '"', lt: "<", gt: ">", nbsp: "\u00a0", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", ndash: "–", mdash: "—", hellip: "…", middot: "·" };
const decode = (text) => text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (all, entity) => {
  if (entity.startsWith("#")) return String.fromCodePoint(parseInt(entity.slice(entity[1] === "x" ? 2 : 1), entity[1] === "x" ? 16 : 10));
  return entities[entity] ?? all;
});
const normalize = (text) => text.replace(/\s+/g, " ").trim();

/** Extract source-backed candidates. All require human review before runtime integration. */
export function extractCopy(file, source) {
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  if (ast.parseDiagnostics.length) throw new Error(`Cannot parse ${file}`);
  const found = [];
  const consumed = new Set();
  const add = (node, text, kind, placeholders = {}) => {
    text = normalize(text);
    if (!/[a-zA-Z]/.test(text.replace(/\{value\d+\}/g, ""))) return;
    const position = ast.getLineAndCharacterOfPosition(node.getStart(ast));
    if (ts.isPropertyAssignment(node.parent) && node.parent.initializer === node) kind = `property:${node.parent.name.getText(ast)}`;
    found.push({ text, kind, line: position.line + 1, column: position.character + 1, placeholders });
  };
  const technical = (node) => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) return true;
      if (ts.isPropertyAssignment(parent) && ["sk", "de"].includes(parent.name.getText(ast))) {
        // Language-label maps are English copy too; only exclude actual multilingual prose.
        if (!["Slovak", "German"].includes(node.text)) return true;
      }
      if (ts.isJsxAttribute(parent)) return !visibleAttributes.has(parent.name.getText(ast));
      if (ts.isBinaryExpression(parent) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(parent.operatorToken.kind)) return true;
      if (ts.isCallExpression(parent) && /\.(?:from|select|eq|neq|order|includes|join|split|replace|replaceAll|register|subscribe|on|rpc)$/.test(parent.expression.getText(ast))) return true;
    }
    return false;
  };
  const readable = (text) => {
    text = text.trim();
    if (["use client", "use server", "SHA-256"].includes(text)) return false;
    if (/^(?:answer|answers|it|them|sent|page|pages|turn|turns|overlap|overlaps|free|paid)$/.test(text)) return true;
    if (!/[a-zA-Z]/.test(text) || /^(?:https?:|stun:|\/|@|wa-|var\(|VALUE\/|[A-Z][A-Z_\d]+$)/.test(text)) return false;
    if (/[{}_]/.test(text) || /^[-\w]+\/[-\w/*]+$/.test(text)) return false;
    return /^[A-Z]/.test(text) || /[a-zA-Z][ .,…:!?][a-zA-Z]|[a-zA-Z][…!?]$/.test(text) || text.startsWith("%s");
  };
  const visit = (node) => {
    if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
      // Keep adjacent text + values together: translators must be able to reorder values.
      let run = [];
      const flush = () => {
        if (!run.some((child) => ts.isJsxText(child) && /[a-zA-Z]/.test(child.text))) { run = []; return; }
        const placeholders = {};
        let text = "";
        for (const child of run) {
          if (ts.isJsxText(child)) { text += decode(child.text); consumed.add(child); }
          else if (child.expression) {
            if (ts.isStringLiteral(child.expression)) { text += child.expression.text; consumed.add(child.expression); }
            else {
              const key = `value${Object.keys(placeholders).length + 1}`;
              placeholders[key] = child.expression.getText(ast);
              text += `{${key}}`;
            }
          }
        }
        add(run[0], text, "jsx-message", placeholders);
        run = [];
      };
      for (const child of node.children) {
        if (ts.isJsxText(child) || ts.isJsxExpression(child)) run.push(child);
        else { flush(); }
      }
      flush();
    }
    if (!consumed.has(node) && !technical(node)) {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        if (!(ts.isPropertyAssignment(node.parent) && node.parent.name === node) && readable(node.text)) {
          const attribute = ts.isJsxAttribute(node.parent);
          add(node, attribute ? decode(node.text) : node.text, attribute ? `attribute:${node.parent.name.getText(ast)}` : "literal");
        }
      } else if (ts.isTemplateExpression(node)) {
        let text = node.head.text;
        const placeholders = {};
        for (const [index, span] of node.templateSpans.entries()) {
          const key = `value${index + 1}`;
          placeholders[key] = span.expression.getText(ast);
          text += `{${key}}${span.literal.text}`;
        }
        if (readable(text.replace(/\{value\d+\}/g, "VALUE"))) add(node, text, "template", placeholders);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return found;
}

function filesIn(directory) {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en")).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function generate() {
  const files = filesIn("apps/web/src").filter((file) => /\.tsx?$/.test(file) && !/\.test\.|database\.types\.ts$/.test(file));
  files.push("supabase/functions/whatsapp/messages.ts");
  const providerFiles = ["supabase/functions/payment/index.ts", "supabase/functions/google/index.ts", "supabase/functions/_shared/google.ts"];
  files.push(...providerFiles);
  const target = resolve(root, "docs/localization/ui-copy.json");
  const previous = existsSync(target) ? JSON.parse(readFileSync(target, "utf8")).messages : {};
  const messages = {};
  for (const file of files) {
    for (const item of extractCopy(file, readFileSync(resolve(root, file), "utf8"))) {
      // Only product/event presentation fields: do not hand HTTP headers or logs to translators.
      if (providerFiles.includes(file) && !["property:name", "property:summary", "property:description"].includes(item.kind)) continue;
      const scope = file.replace(/^apps\/web\/src\//, "").replace(/\.tsx?$/, "").replace(/[^a-zA-Z0-9]+/g, "_");
      const slug = item.text.toLowerCase().replace(/\{value\d+\}/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").split("_").slice(0, 7).join("_");
      const hash = createHash("sha256").update(item.text).digest("hex").slice(0, 8);
      const key = `${scope}__${slug}_${hash}`;
      messages[key] ??= {
        en: item.text, sk: previous[key]?.sk ?? "", de: previous[key]?.de ?? "",
        review: previous[key]?.review ?? "needs_review",
        notes: "",
        occurrences: [],
      };
      if (previous[key]?.notes) messages[key].notes = previous[key].notes;
      messages[key].occurrences.push({ file, line: item.line, column: item.column, kind: item.kind, placeholders: item.placeholders });
    }
  }
  // Retain translated entries when source moves or disappears. Never silently discard translator work.
  for (const [key, entry] of Object.entries(previous)) {
    if (!messages[key]) messages[key] = { ...entry, review: "obsolete_check_before_removing" };
  }
  const catalog = {
    sourceLocale: "en", targetLocales: ["sk", "de"],
    status: "Static source inventory; candidates require contextual review, not a verified runtime catalog.",
    instructions: "Translate sk and de only. Keep keys, en, and placeholder tokens unchanged. Read occurrences/placeholders for context. See README.md for fragments and dynamic content limitations.",
    scannedFiles: files, messageCount: Object.keys(messages).length, messages,
  };
  writeFileSync(target, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`Wrote ${catalog.messageCount} candidates from ${files.length} files to ${relative(root, target)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) generate();
