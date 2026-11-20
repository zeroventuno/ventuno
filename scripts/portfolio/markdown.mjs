// Markdown mínimo para os textos das peças (ficha, case, identidade).
// Cobre o que o padrão usa: títulos, parágrafos, listas, tabelas, citações,
// blocos de código, negrito, itálico, código e links. Escapa o HTML do texto.

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*\w])\*([^*\n]+?)\*(?![\w*])/g, "$1<em>$2</em>");
  t = t.replace(/(^|[^\w])_([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt, url) =>
    /^(https?:|mailto:|\/|#)/.test(url) ? `<a href="${url}" target="_blank" rel="noopener">${txt}</a>` : txt
  );
  return t;
}

function tabela(linhas) {
  const celulas = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  const temCabecalho = linhas[1] && /^\s*\|?\s*:?-{2,}/.test(linhas[1]);
  const cab = temCabecalho ? celulas(linhas[0]) : null;
  const corpo = (temCabecalho ? linhas.slice(2) : linhas).map(celulas);
  return (
    "<table>" +
    (cab ? `<thead><tr>${cab.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` : "") +
    `<tbody>${corpo.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
  );
}

const INICIO_DE_BLOCO = /^(#{2,4}\s|```|\s*\||\s*[-*]\s+|\s*\d+\.\s+|>)/;

export function blocos(md) {
  const L = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  const lista = (re, tag) => {
    const itens = [];
    while (i < L.length && re.test(L[i])) {
      let item = L[i++].replace(re, "");
      while (i < L.length && /^\s{2,}\S/.test(L[i]) && !re.test(L[i])) item += " " + L[i++].trim();
      itens.push(item);
    }
    out.push(`<${tag}>${itens.map((x) => `<li>${inline(x)}</li>`).join("")}</${tag}>`);
  };
  while (i < L.length) {
    const l = L[i];
    let m;
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const buf = [];
      i++;
      while (i < L.length && !L[i].startsWith("```")) buf.push(L[i++]);
      i++;
      out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      const n = Math.min(m[1].length + 1, 5);
      out.push(`<h${n}>${inline(m[2])}</h${n}>`);
      i++;
      continue;
    }
    if (/^\s*\|/.test(l)) {
      const linhas = [];
      while (i < L.length && /^\s*\|/.test(L[i])) linhas.push(L[i++]);
      out.push(tabela(linhas));
      continue;
    }
    if (/^\s*[-*]\s+/.test(l)) { lista(/^\s*[-*]\s+/, "ul"); continue; }
    if (/^\s*\d+\.\s+/.test(l)) { lista(/^\s*\d+\.\s+/, "ol"); continue; }
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${blocos(buf.join("\n"))}</blockquote>`);
      continue;
    }
    const buf = [];
    while (i < L.length && L[i].trim() && !(buf.length && INICIO_DE_BLOCO.test(L[i]))) buf.push(L[i++].trim());
    out.push(`<p>${inline(buf.join(" "))}</p>`);
  }
  return out.join("\n");
}
