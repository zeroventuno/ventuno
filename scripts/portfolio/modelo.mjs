// Monta o conteúdo do site: para cada lugar da ordem (conteudo/ordem.yml),
// usa a peça do projeto se ela puder aparecer e, se não, o conteúdo de legado
// (conteudo/legado/), que é o texto do site anterior. Nada sai do ar por falta
// de peça.
//
// modo "producao": só peças aprovadas e sem pendência.
// modo "previa": também rascunhos (nunca as ocultas).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lerTudo, lerOrdem, TIPOS, STATUS } from "./pecas.mjs";
import { blocos } from "./markdown.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const SITE = path.resolve(AQUI, "..", "..");
const CONTEUDO = path.join(SITE, "conteudo");
export const IDIOMAS = ["pt", "en", "it", "es", "fr", "de"];

const lerJson = (arq) => JSON.parse(fs.readFileSync(arq, "utf8"));
const jsonsDe = (dir) =>
  fs.existsSync(dir)
    ? Object.fromEntries(fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => [f.replace(/\.json$/, ""), lerJson(path.join(dir, f))]))
    : {};

function traducoes(slug) {
  const arq = path.join(CONTEUDO, "traducoes", `${slug}.json`);
  return fs.existsSync(arq) ? lerJson(arq) : null;
}

// Junta o PT da peça com a tradução guardada; o que faltar fica em PT.
function porIdioma(pt, trad, chave, avisos, slug, atualizado) {
  const out = { pt };
  const valida = trad && trad.atualizado === atualizado;
  if (trad && !valida) avisos.push(`${slug}: tradução feita para ${trad.atualizado}, a peça está em ${atualizado}; retraduzir`);
  if (!trad) avisos.push(`${slug}: sem tradução; os outros idiomas mostram o português`);
  for (const l of IDIOMAS.slice(1)) {
    const t = valida ? (chave ? trad[l]?.[chave] : trad[l]) : null;
    out[l] = t ? { ...pt, ...t } : pt;
  }
  return out;
}

function projetoDaPeca(p, avisos) {
  const fm = p.fm;
  const pt = {
    titulo: fm.titulo,
    etiqueta: fm.etiqueta || [TIPOS[fm.tipo], fm.categoria].filter(Boolean).join(" · "),
    resumo: fm.resumo,
    descricao: blocos(p.partes.descricao),
    pontos: p.partes.pontos.map((x) => ({ rotulo: x.rotulo, texto: blocos(x.texto) })),
    destaque: p.partes.destaque ? { etiqueta: p.partes.destaque.etiqueta, titulo: p.partes.destaque.titulo, texto: blocos(p.partes.destaque.texto) } : null,
    numeros: (fm.numeros || []).map((n) => ({ valor: String(n.valor), rotulo: n.rotulo })),
    legendas: p.galeria.map((g) => g.legenda || ""),
    caseHtml: p.caseMd ? blocos(p.caseMd) : null,
    estado: STATUS[fm.status] || fm.status,
    papel: (fm.papel || []).join(", "),
  };
  return {
    slug: p.slug,
    origem: "peca",
    estado: fm.estado,
    capa: p.capa?.existe ? { src: p.capa.url, w: p.capa.w, h: p.capa.h } : null,
    galeria: p.galeria.filter((g) => g.existe).map((g) => ({ src: g.url, video: g.tipo === "video", poster: g.poster || null, alta: !!(g.w && g.h / g.w > 1.7), w: g.w, h: g.h })),
    tecnologias: fm.tecnologias || [],
    ano: fm.ano ? String(fm.ano) : null,
    links: fm.links || {},
    familia: fm.familia || null,
    identidade: p.identidade ? p.slug : null,
    peca: p,
    t: porIdioma(pt, traducoes(p.slug), null, avisos, p.slug, String(fm.atualizado)),
  };
}

function marcaDaPeca(p, avisos) {
  const id = p.identidade;
  const f = id.fm;
  const pt = {
    conceito: f.conceito,
    historia: blocos(id.corpo),
    legendas: id.galeria.map((g) => g.legenda || ""),
    cores: (f.cores || []).map((c) => ({ nome: c.nome, hex: c.hex, uso: c.uso })),
    tipografia: (f.tipografia || []).map((t) => ({ familia: t.familia, pesos: t.pesos, uso: t.uso, origem: t.origem })),
  };
  const trad = traducoes(p.slug);
  return {
    slug: p.slug,
    origem: "peca",
    estado: f.estado,
    marca: f.marca,
    logo: { claro: id.logos["logo-principal"] || null, escuro: id.logos["logo-negativo"] || null },
    galeria: id.galeria.filter((g) => g.existe).map((g) => ({ src: g.url })),
    manual: id.manual?.url || null,
    projeto: p.emProjetos ? p.slug : null,
    t: porIdioma(pt, trad && trad.identidade ? { atualizado: trad.atualizado, ...trad.identidade } : null, null, avisos, `${p.slug} (identidade)`, String(f.atualizado)),
  };
}

const pode = (estado, publicavel, modo) => (modo === "producao" ? publicavel : estado !== "oculto");

export function montarModelo({ modo = "producao" } = {}) {
  const avisos = [];
  const lidas = lerTudo();
  const ordem = lerOrdem(path.join(CONTEUDO, "ordem.yml"));
  const textos = lerJson(path.join(CONTEUDO, "textos.json"));
  const legP = jsonsDe(path.join(CONTEUDO, "legado", "projetos"));
  const legM = jsonsDe(path.join(CONTEUDO, "legado", "marcas"));

  const projetos = [];
  const usados = new Set();
  const colocar = (slug, secao) => {
    if (usados.has(slug)) return;
    const p = lidas.porSlug.get(slug);
    const ocultaPeloDono = p && p.fm.estado === "oculto";
    if (p && p.emProjetos && pode(p.fm.estado, p.publicavel, modo)) {
      projetos.push({ ...projetoDaPeca(p, avisos), secao });
      usados.add(slug);
    } else if (!ocultaPeloDono && legP[slug]) {
      projetos.push({ ...legP[slug], origem: "legado", secao });
      usados.add(slug);
      if (p) avisos.push(`${slug}: a peça existe (${p.fm.estado}) mas ainda não pode ir ao ar; usando o legado`);
    }
  };
  ordem.projetos.forEach((s) => colocar(s, "projetos"));
  ordem.estudos.forEach((s) => colocar(s, "estudos"));
  for (const p of lidas.pecas) if (!usados.has(p.slug)) colocar(p.slug, "projetos");

  const marcas = [];
  const marcasUsadas = new Set();
  const colocarMarca = (slug) => {
    if (marcasUsadas.has(slug)) return;
    const p = lidas.porSlug.get(slug);
    const id = p?.identidade;
    if (id && id.entraNaSecao && pode(id.fm.estado, id.publicavel, modo) && p.fm.estado !== "oculto") {
      marcas.push(marcaDaPeca(p, avisos));
      marcasUsadas.add(slug);
    } else if (legM[slug]) {
      marcas.push({ ...legM[slug], origem: "legado" });
      marcasUsadas.add(slug);
    }
  };
  ordem.identidade.forEach(colocarMarca);
  for (const p of lidas.pecas) if (p.identidade) colocarMarca(p.slug);

  // a marca só liga ao projeto se o projeto está no site, e vice-versa
  const slugsProj = new Set(projetos.map((p) => p.slug));
  const slugsMarca = new Set(marcas.map((m) => m.slug));
  for (const m of marcas) if (m.projeto && !slugsProj.has(m.projeto)) m.projeto = null;
  for (const p of projetos) if (p.identidade && !slugsMarca.has(p.identidade)) p.identidade = null;

  const destaques = ordem.destaques.filter((s) => slugsProj.has(s) && projetos.find((p) => p.slug === s).secao === "projetos");
  return { modo, textos, projetos, marcas, destaques, avisos, lidas };
}
