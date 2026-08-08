// Minimal, dependency-free markdown → HTML for the email digest. Handles the subset
// the digest renderer emits: h1-h3, bold, italics, links, bullet lists, hr, blank-line
// paragraphs. Inline styles keep it readable in email clients (no external CSS).

function inline(s: string): string {
  return escapeHtml(s)
    // links [text](url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" style="color:#2563eb;text-decoration:none">$1</a>')
    // bold **text**
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // italics _text_ (conservative: bounded by whitespace/edges/punctuation)
    .replace(/(^|\s)_([^_\n]+)_(?=\s|$|[.,;:])/g, '$1<em>$2</em>');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { out.push('<ul style="margin:6px 0 6px 18px;padding:0">'); inList = true; }
      out.push(`<li style="margin:3px 0">${inline(line.replace(/^\s*-\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    if (line === "") { continue; }
    if (line === "---") { out.push('<hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">'); continue; }
    if (line.startsWith("### ")) { out.push(`<h3 style="margin:14px 0 4px;font-size:16px">${inline(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## ")) { out.push(`<h2 style="margin:20px 0 6px;font-size:19px;border-bottom:1px solid #eee;padding-bottom:3px">${inline(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# ")) { out.push(`<h1 style="margin:0 0 4px;font-size:23px">${inline(line.slice(2))}</h1>`); continue; }
    out.push(`<p style="margin:6px 0;line-height:1.45">${inline(line)}</p>`);
  }
  closeList();

  return [
    '<div style="max-width:720px;margin:0 auto;padding:20px;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:14px">',
    out.join("\n"),
    "</div>",
  ].join("\n");
}
