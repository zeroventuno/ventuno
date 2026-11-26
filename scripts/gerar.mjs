// Gera o site em public/ a partir das peças aprovadas e do legado.
//
//   npm run gerar
//
// Escreve public/index.html, public/projetos/<slug>/index.html,
// public/identidade/<slug>/index.html e public/sitemap.xml, e conta o que
// veio de peça, o que veio do legado e o que falta traduzir.
import fs from "node:fs";
import path from "node:path";
import { montarModelo, SITE } from "./portfolio/modelo.mjs";
import { paginaHome, paginaProjeto, paginaMarca, sitemap } from "./portfolio/paginas.mjs";

const M = montarModelo({ modo: "producao" });
const PUB = path.join(SITE, "public");

// Peça aprovada traz imagens-mestre, que precisam de versões web antes de ir ao ar.
const aprovadas = [...M.projetos, ...M.marcas].filter((x) => x.origem === "peca").map((x) => x.slug);
if (aprovadas.length) {
  console.error(`Peças aprovadas: ${aprovadas.join(", ")}.`);
  console.error("O gerador ainda não cria as versões web das imagens-mestre. Implementar antes de publicar.");
  process.exit(1);
}

function gravar(rel, html) {
  const arq = path.join(PUB, rel);
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, html);
}
function limparSobras(dir, validos) {
  const abs = path.join(PUB, dir);
  if (!fs.existsSync(abs)) return [];
  const sobras = fs.readdirSync(abs).filter((s) => !validos.has(s));
  for (const s of sobras) fs.rmSync(path.join(abs, s), { recursive: true, force: true });
  return sobras;
}

gravar("index.html", paginaHome(M));
for (const p of M.projetos) gravar(`projetos/${p.slug}/index.html`, paginaProjeto(M, p));
for (const m of M.marcas) gravar(`identidade/${m.slug}/index.html`, paginaMarca(M, m));
const sobrasP = limparSobras("projetos", new Set(M.projetos.map((p) => p.slug)));
const sobrasM = limparSobras("identidade", new Set(M.marcas.map((m) => m.slug)));
gravar("sitemap.xml", sitemap(M));

console.log("Projetos:");
for (const p of M.projetos) console.log(`  ${p.slug.padEnd(26)} ${p.origem.padEnd(7)} ${p.secao}${M.destaques.includes(p.slug) ? " · destaque" : ""}`);
console.log("Marcas:");
for (const m of M.marcas) console.log(`  ${m.slug.padEnd(26)} ${m.origem}`);
if (sobrasP.length || sobrasM.length) console.log("Páginas removidas:", [...sobrasP, ...sobrasM].join(", "));
if (M.avisos.length) {
  console.log("Avisos:");
  for (const a of [...new Set(M.avisos)]) console.log("  - " + a);
}
