// Acha as peças de portfólio (_portfolio/<slug>/ficha.md) e confere cada uma
// contra o padrão v1 (C:\Dev\master\guias\portfolio-padrao\PADRAO.md).
// Só leitura: nunca escreve na pasta de um projeto.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import * as yaml from "js-yaml";

export const RAIZ_PADRAO =
  process.env.PORTFOLIO_RAIZ || (process.platform === "win32" ? "C:\\Dev" : path.join(os.homedir(), "Dev"));
const IGNORAR = new Set(["node_modules", ".git", ".next", "dist", ".vercel", ".claude", "backups"]);
const PROFUNDIDADE = 4;

export const TIPOS = {
  cliente: "Cliente",
  "produto-proprio": "Produto próprio",
  pessoal: "Pessoal",
  experimento: "Experimento",
};
export const STATUS = {
  "no-ar": "No ar",
  "em-desenvolvimento": "Em desenvolvimento",
  concluido: "Concluído",
  pausado: "Pausado",
  encerrado: "Encerrado",
  conceito: "Conceito",
};
const ESTADOS = ["rascunho", "aprovado", "oculto"];
const AUTORIAS = ["original", "redesenho", "aplicacao"];
const OBRIG_FICHA = ["padrao", "titulo", "slug", "resumo", "tipo", "categoria", "ano", "status", "papel", "capa", "estado", "atualizado"];
const OBRIG_ID = ["padrao", "marca", "conceito", "autoria", "cores", "tipografia", "estado", "atualizado"];
const NOME_ARQUIVO = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.(jpg|jpeg|png|mp4|svg|pdf)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
export const PRE = "[preencher]";

/* ---------- busca ---------- */

export function encontrarPastas(raiz = RAIZ_PADRAO) {
  const achadas = [];
  const fila = [[raiz, 0]];
  while (fila.length) {
    const [dir, nivel] = fila.shift();
    let itens;
    try { itens = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const it of itens) {
      if (!it.isDirectory() || IGNORAR.has(it.name)) continue;
      const p = path.join(dir, it.name);
      if (it.name === "_portfolio") { achadas.push(p); continue; }
      if (nivel + 1 < PROFUNDIDADE) fila.push([p, nivel + 1]);
    }
  }
  return achadas.sort();
}

/* ---------- arquivos ---------- */

const cacheTamanho = new Map();
export function tamanhoImagem(arq) {
  let st;
  try { st = fs.statSync(arq); } catch { return null; }
  const chave = `${arq}|${st.size}|${st.mtimeMs}`;
  if (cacheTamanho.has(chave)) return cacheTamanho.get(chave);
  let r = null;
  try {
    const b = fs.readFileSync(arq);
    if (b[0] === 0x89 && b[1] === 0x50) r = { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
    else if (b[0] === 0xff && b[1] === 0xd8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xff) { i++; continue; }
        const mk = b[i + 1];
        if (mk === 0xd8 || mk === 0x01 || (mk >= 0xd0 && mk <= 0xd7) || mk === 0xff) { i += mk === 0xff ? 1 : 2; continue; }
        const len = b.readUInt16BE(i + 2);
        if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) { r = { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) }; break; }
        i += 2 + len;
      }
    }
  } catch { r = null; }
  if (r) r.kb = Math.round(st.size / 1024);
  cacheTamanho.set(chave, r);
  return r;
}

function lerFrontmatter(arq) {
  let txt;
  try { txt = fs.readFileSync(arq, "utf8").replace(/^\uFEFF/, ""); } catch { return { erro: `não consegui ler ${path.basename(arq)}`, fm: {}, corpo: "" }; }
  const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { erro: "sem frontmatter: o arquivo precisa começar com ---", fm: {}, corpo: txt };
  try {
    const fm = yaml.load(m[1], { schema: yaml.CORE_SCHEMA }) || {};
    return { fm: typeof fm === "object" ? fm : {}, corpo: m[2] };
  } catch (e) {
    return { erro: "YAML inválido no frontmatter: " + String(e.message).split("\n")[0], fm: {}, corpo: m[2] };
  }
}

function caminhosComPreencher(v, p = "", out = []) {
  if (typeof v === "string") { if (v.includes(PRE)) out.push(p || "(valor)"); }
  else if (Array.isArray(v)) v.forEach((x, i) => caminhosComPreencher(x, `${p}[${i + 1}]`, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) caminhosComPreencher(x, p ? `${p}.${k}` : k, out);
  return out;
}

const vazio = (v) => v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length);

// Resolve um caminho relativo dentro da peça. Fora dela, devolve null.
function dentro(base, limite, rel) {
  if (typeof rel !== "string" || !rel || rel.includes(PRE)) return null;
  const abs = path.resolve(base, rel);
  return abs === limite || abs.startsWith(limite + path.sep) ? abs : null;
}

function branchDoRepositorio(repo) {
  try {
    const head = fs.readFileSync(path.join(repo, ".git", "HEAD"), "utf8").trim();
    const m = head.match(/^ref: refs\/heads\/(.+)$/);
    return m ? m[1] : "(commit solto)";
  } catch { return null; }
}

/* ---------- corpo da ficha ---------- */

export function partesDoCorpo(md) {
  const secoes = [{ titulo: null, linhas: [] }];
  for (const l of String(md).replace(/\r\n/g, "\n").split("\n")) {
    const m = l.match(/^##\s+(.+?)\s*$/);
    if (m) secoes.push({ titulo: m[1], linhas: [] });
    else secoes[secoes.length - 1].linhas.push(l);
  }
  const descricao = secoes[0].linhas.join("\n").trim();
  const pontos = [];
  const destaques = [];
  for (const s of secoes.slice(1)) {
    const texto = s.linhas.join("\n").trim();
    const d = s.titulo.match(/^Destaque:\s*(.+)$/i);
    if (d) {
      const e = texto.match(/^(?:\*([^*\n]+)\*|_([^_\n]+)_)[ \t]*(?:\n|$)/);
      destaques.push({ titulo: d[1].trim(), etiqueta: e ? (e[1] || e[2]).trim() : null, texto: e ? texto.slice(e[0].length).trim() : texto });
    } else pontos.push({ rotulo: s.titulo.trim(), texto });
  }
  return { descricao, pontos, destaques, destaque: destaques[0] || null };
}

/* ---------- mídia ---------- */

function midia(dirPeca, baseRel, arquivo, urlBase, add, onde) {
  const base = path.join(dirPeca, baseRel);
  const abs = dentro(base, dirPeca, arquivo);
  const item = { arquivo, existe: false, url: null, tipo: /\.mp4$/i.test(arquivo || "") ? "video" : /\.pdf$/i.test(arquivo || "") ? "pdf" : "imagem" };
  if (!abs) { add("erro", onde, `caminho inválido ou fora da peça: ${arquivo}`); return item; }
  item.rel = path.relative(dirPeca, abs).split(path.sep).join("/");
  item.url = urlBase + item.rel.split("/").map(encodeURIComponent).join("/");
  item.existe = fs.existsSync(abs);
  if (!item.existe) { add("erro", onde, `arquivo não existe: ${item.rel}`); return item; }
  const kb = Math.round(fs.statSync(abs).size / 1024);
  item.kb = kb;
  if (item.tipo === "video") {
    const poster = abs.replace(/\.mp4$/i, ".jpg");
    if (fs.existsSync(poster)) item.poster = item.url.replace(/\.mp4$/i, ".jpg");
    else add("erro", onde, `vídeo sem pôster com o mesmo nome: ${item.rel}`);
    if (kb > 10240) add("aviso", onde, `${item.rel} tem ${(kb / 1024).toFixed(1)} MB; o máximo para vídeo é 10 MB`);
  } else if (item.tipo === "imagem") {
    const t = tamanhoImagem(abs);
    if (t) Object.assign(item, { w: t.w, h: t.h });
    const png = /\.png$/i.test(abs);
    const limite = png ? 3072 : 2560;
    if (kb > limite) add("aviso", onde, `${item.rel} tem ${(kb / 1024).toFixed(1)} MB; o máximo é ${png ? "3" : "2,5"} MB`);
  }
  return item;
}

/* ---------- identidade ---------- */

function lerIdentidade(dirPeca, fm, urlBase, addFicha) {
  let rel = typeof fm.identidade === "string" && fm.identidade && !fm.identidade.includes(PRE) ? fm.identidade : null;
  if (!rel && fs.existsSync(path.join(dirPeca, "identidade", "identidade.md"))) {
    rel = "identidade/identidade.md";
    addFicha("aviso", "ficha", "existe a pasta identidade/, mas a ficha não tem o campo identidade");
  }
  if (!rel) return null;
  const arq = dentro(dirPeca, dirPeca, rel);
  if (!arq || !fs.existsSync(arq)) { addFicha("erro", "ficha", `o campo identidade aponta para ${rel}, que não existe`); return null; }

  const problemas = [];
  const add = (nivel, onde, texto) => problemas.push({ nivel, onde, texto });
  const dirId = path.dirname(arq);
  const relId = path.relative(dirPeca, dirId).split(path.sep).join("/");
  const { fm: id, corpo, erro } = lerFrontmatter(arq);
  if (erro) add("erro", "identidade", erro);

  for (const k of OBRIG_ID) if (vazio(id[k])) add("erro", "identidade", `falta o campo ${k}`);
  if (id.padrao !== undefined && Number(id.padrao) !== 1) add("aviso", "identidade", `padrão ${id.padrao}; esta prévia conhece o 1`);
  if (id.autoria && !AUTORIAS.includes(id.autoria)) add("erro", "identidade", `autoria "${id.autoria}" não existe (original, redesenho ou aplicacao)`);
  if (id.autoria === "aplicacao") add("aviso", "identidade", "autoria aplicacao: a marca não entra na seção Identidade");
  if (id.estado && !ESTADOS.includes(id.estado)) add("erro", "identidade", `estado "${id.estado}" não existe`);
  if (id.atualizado && !DATA.test(String(id.atualizado))) add("erro", "identidade", "atualizado precisa ser AAAA-MM-DD");
  if (typeof id.conceito === "string" && id.conceito.length > 140) add("aviso", "identidade", `conceito com ${id.conceito.length} caracteres (até 140)`);
  for (const c of Array.isArray(id.cores) ? id.cores : []) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(String(c?.hex ?? ""))) add("erro", "identidade", `cor ${c?.nome ?? "?"}: hex inválido (${c?.hex})`);
  }
  for (const t of Array.isArray(id.tipografia) ? id.tipografia : []) {
    for (const k of ["familia", "pesos", "uso", "origem"]) if (vazio(t?.[k])) add("aviso", "identidade", `tipografia ${t?.familia ?? "?"}: falta ${k}`);
  }

  const logos = {};
  for (const nome of ["logo-principal", "logo-negativo", "simbolo"]) {
    const svg = path.join(dirId, nome + ".svg");
    const png = path.join(dirId, nome + ".png");
    const f = fs.existsSync(svg) ? svg : fs.existsSync(png) ? png : null;
    if (!f) continue;
    logos[nome] = urlBase + path.relative(dirPeca, f).split(path.sep).map(encodeURIComponent).join("/");
    if (f.endsWith(".svg")) {
      const s = fs.readFileSync(f, "utf8");
      if (!/viewBox\s*=/.test(s)) add("erro", "identidade", `${nome}.svg sem viewBox`);
      if (/<text[\s>]|<image[\s>]|<font[\s>]|@font-face/.test(s)) add("erro", "identidade", `${nome}.svg tem texto vivo, fonte ou imagem embutida`);
    }
  }
  if (!logos["logo-principal"]) add("erro", "identidade", "falta logo-principal.svg (ou .png sem vetor)");
  if (!logos["logo-negativo"]) add("aviso", "identidade", "sem logo-negativo.svg: o site é escuro, então a principal vai num quadro claro");

  const galeria = (Array.isArray(id.galeria) ? id.galeria : []).map((g) => {
    const it = midia(dirPeca, relId, g?.arquivo, urlBase, add, "identidade");
    it.legenda = g?.legenda;
    if (vazio(g?.legenda)) add("erro", "identidade", `${g?.arquivo}: sem legenda`);
    else if (String(g.legenda).length > 90) add("aviso", "identidade", `${g.arquivo}: legenda com ${g.legenda.length} caracteres (até 90)`);
    if (g?.arquivo && !NOME_ARQUIVO.test(path.basename(g.arquivo))) add("aviso", "identidade", `nome fora do padrão NN-descricao: ${g.arquivo}`);
    return it;
  });

  let manual = null;
  if (typeof id.manual === "string" && id.manual && !id.manual.includes(PRE)) {
    if (/^https?:\/\//.test(id.manual)) manual = { url: id.manual, externo: true };
    else {
      const m = midia(dirPeca, relId, id.manual, urlBase, add, "identidade");
      if (m.existe) manual = { url: m.url, externo: false };
    }
  }

  for (const c of caminhosComPreencher(id)) add("pendencia", "identidade", `[preencher] em ${c}`);
  const nCorpo = (corpo.match(/\[preencher\]/g) || []).length;
  if (nCorpo) add("pendencia", "identidade", `[preencher] no texto (${nCorpo}x)`);

  const bloqueia = problemas.some((p) => p.nivel !== "aviso");
  return {
    fm: id, corpo, dir: dirId, rel: relId, logos, galeria, manual, problemas,
    entraNaSecao: id.autoria !== "aplicacao",
    publicavel: id.estado === "aprovado" && !bloqueia && id.autoria !== "aplicacao",
  };
}

/* ---------- peça ---------- */

export function lerPeca(dir) {
  const slugPasta = path.basename(dir);
  const pastaPortfolio = path.dirname(dir);
  const repo = path.dirname(pastaPortfolio);
  const problemas = [];
  const add = (nivel, onde, texto) => problemas.push({ nivel, onde, texto });

  const { fm, corpo, erro } = lerFrontmatter(path.join(dir, "ficha.md"));
  if (erro) add("erro", "ficha", erro);
  const slug = typeof fm.slug === "string" && SLUG.test(fm.slug) ? fm.slug : slugPasta;
  const urlBase = `/arquivos/${encodeURIComponent(slug)}/`;

  for (const k of OBRIG_FICHA) if (vazio(fm[k])) add("erro", "ficha", `falta o campo ${k}`);
  if (fm.padrao !== undefined && Number(fm.padrao) !== 1) add("aviso", "ficha", `padrão ${fm.padrao}; esta prévia conhece o 1`);
  if (fm.slug && fm.slug !== slugPasta) add("erro", "ficha", `slug "${fm.slug}" diferente do nome da pasta "${slugPasta}"`);
  if (!SLUG.test(slugPasta)) add("erro", "ficha", `nome da pasta fora do padrão de slug: ${slugPasta}`);
  if (typeof fm.titulo === "string" && fm.titulo.length > 40) add("aviso", "ficha", `título com ${fm.titulo.length} caracteres (até 40)`);
  if (typeof fm.resumo === "string" && fm.resumo.length > 140) add("aviso", "ficha", `resumo com ${fm.resumo.length} caracteres (até 140)`);
  if (fm.tipo && !TIPOS[fm.tipo]) add("erro", "ficha", `tipo "${fm.tipo}" não existe`);
  if (fm.status && !STATUS[fm.status]) add("erro", "ficha", `status "${fm.status}" não existe`);
  if (fm.estado && !ESTADOS.includes(fm.estado)) add("erro", "ficha", `estado "${fm.estado}" não existe`);
  if (fm.atualizado && !DATA.test(String(fm.atualizado))) add("erro", "ficha", "atualizado precisa ser AAAA-MM-DD");
  if (fm.tipo === "cliente" && vazio(fm.cliente)) add("erro", "ficha", "tipo cliente pede o campo cliente");
  if (fm.papel !== undefined && !Array.isArray(fm.papel)) add("aviso", "ficha", "papel deveria ser uma lista");
  if (Array.isArray(fm.numeros) && fm.numeros.length > 4) add("aviso", "ficha", `${fm.numeros.length} números (até 4)`);
  for (const n of Array.isArray(fm.numeros) ? fm.numeros : []) if (vazio(n?.valor) || vazio(n?.rotulo)) add("erro", "ficha", "número sem valor ou sem rótulo");
  if (fm.depoimento && fm.depoimento.autorizado !== true && !vazio(fm.depoimento.texto)) add("aviso", "ficha", "depoimento sem autorizado: true não aparece");
  for (const [k, v] of Object.entries(fm.links && typeof fm.links === "object" ? fm.links : {})) {
    if (typeof v === "string" && v && !v.includes(PRE) && !/^https?:\/\//.test(v)) add("aviso", "ficha", `link ${k} não começa com http`);
  }

  const temIdentidadeDir = fs.existsSync(path.join(dir, "identidade"));
  const mostrarEm = Array.isArray(fm.mostrar_em) ? fm.mostrar_em : temIdentidadeDir ? ["projetos", "identidade"] : ["projetos"];
  for (const m of mostrarEm) if (!["projetos", "identidade"].includes(m)) add("erro", "ficha", `mostrar_em com valor desconhecido: ${m}`);
  const emProjetos = mostrarEm.includes("projetos");

  // capa
  let capa = null;
  if (typeof fm.capa === "string" && fm.capa && !fm.capa.includes(PRE)) {
    capa = midia(dir, ".", fm.capa, urlBase, add, "capa");
    if (capa.existe && capa.w) {
      const r = capa.w / capa.h;
      if (Math.abs(r - 1.6) > 0.02) add("erro", "capa", `a capa não está em 16:10 (${capa.w} × ${capa.h})`);
      if (capa.w < 1600) add("erro", "capa", `capa com ${capa.w} px de largura; o mínimo é 1600`);
      else if (capa.w < 2400) add("aviso", "capa", `capa com ${capa.w} px; o padrão pede 2400 × 1500`);
    }
  }

  // galeria
  const listaGaleria = Array.isArray(fm.galeria) ? fm.galeria : [];
  const galeria = listaGaleria.map((g) => {
    const it = midia(dir, ".", g?.arquivo, urlBase, add, "galeria");
    it.legenda = g?.legenda;
    if (vazio(g?.legenda)) add("erro", "galeria", `${g?.arquivo}: sem legenda`);
    else if (String(g.legenda).length > 90) add("aviso", "galeria", `${g.arquivo}: legenda com ${g.legenda.length} caracteres (até 90)`);
    if (g?.arquivo && !NOME_ARQUIVO.test(path.basename(g.arquivo))) add("aviso", "galeria", `nome fora do padrão NN-descricao: ${g.arquivo}`);
    if (it.w && Math.max(it.w, it.h) < 1600) add("aviso", "galeria", `${it.rel} é pequena (${it.w} × ${it.h})`);
    return it;
  });
  if (emProjetos && !galeria.length) add("aviso", "galeria", "sem galeria (o padrão recomenda de 3 a 12 imagens)");
  if (galeria.length > 12) add("aviso", "galeria", `${galeria.length} imagens (recomendado até 12)`);

  // corpo
  const partes = partesDoCorpo(corpo);
  if (!partes.descricao) add("erro", "texto", "falta a descrição (o texto antes do primeiro ##)");
  else if (partes.descricao.length > 700) add("aviso", "texto", `descrição com ${partes.descricao.length} caracteres (até ~700)`);
  if (emProjetos && (partes.pontos.length < 2 || partes.pontos.length > 6)) add("erro", "texto", `${partes.pontos.length} pontos ## (de 2 a 6)`);
  for (const p of partes.pontos) if (p.texto.length > 400) add("aviso", "texto", `ponto "${p.rotulo}" com ${p.texto.length} caracteres (até ~400)`);
  if (partes.destaques.length > 1) add("aviso", "texto", `${partes.destaques.length} blocos Destaque; só o primeiro aparece`);

  // case e traduções
  const caseArq = path.join(dir, "case.md");
  const caseMd = fs.existsSync(caseArq) ? fs.readFileSync(caseArq, "utf8") : null;
  const dirTrad = path.join(dir, "traducoes");
  const traducoes = fs.existsSync(dirTrad) ? fs.readdirSync(dirTrad).filter((f) => f.endsWith(".md")) : [];

  // [preencher]
  for (const c of caminhosComPreencher(fm)) add("pendencia", "ficha", `[preencher] em ${c}`);
  const nCorpo = ((corpo || "").match(/\[preencher\]/g) || []).length;
  if (nCorpo) add("pendencia", "texto", `[preencher] no texto (${nCorpo}x)`);
  if (caseMd && caseMd.includes(PRE)) add("pendencia", "case", "[preencher] no case.md");

  // onde mora
  const branch = branchDoRepositorio(repo);
  if (branch && !["main", "master"].includes(branch)) add("aviso", "git", `o repositório está na branch ${branch}; a peça some do disco se ele voltar para a main antes do merge`);

  const identidade = lerIdentidade(dir, fm, urlBase, add);

  return {
    slug, slugPasta, dir, repo, branch, fm, partes, caseMd, traducoes, capa, galeria, identidade,
    mostrarEm, emProjetos, emIdentidade: mostrarEm.includes("identidade") && !!identidade,
    problemas, publicavel: false,
  };
}

export function recalcular(peca) {
  const bloqueia = peca.problemas.some((p) => p.nivel !== "aviso");
  peca.publicavel = peca.fm.estado === "aprovado" && !bloqueia;
  return peca;
}

export function lerTudo(raiz = RAIZ_PADRAO) {
  const t0 = Date.now();
  const pastas = encontrarPastas(raiz);
  const pecas = [];
  const semFicha = [];
  for (const p of pastas) {
    for (const it of fs.readdirSync(p, { withFileTypes: true })) {
      if (!it.isDirectory()) continue;
      const d = path.join(p, it.name);
      if (fs.existsSync(path.join(d, "ficha.md"))) pecas.push(lerPeca(d));
      else semFicha.push(d);
    }
  }
  const porSlug = new Map();
  for (const pc of pecas) {
    if (porSlug.has(pc.slug)) {
      const outra = porSlug.get(pc.slug);
      pc.problemas.push({ nivel: "erro", onde: "ficha", texto: `slug repetido: também em ${outra.dir}` });
      outra.problemas.push({ nivel: "erro", onde: "ficha", texto: `slug repetido: também em ${pc.dir}` });
    } else porSlug.set(pc.slug, pc);
  }
  pecas.forEach(recalcular);
  return { raiz, pastas, pecas, porSlug, semFicha, ms: Date.now() - t0 };
}

export function lerOrdem(arq) {
  try {
    const o = yaml.load(fs.readFileSync(arq, "utf8"), { schema: yaml.CORE_SCHEMA }) || {};
    const destaques = Array.isArray(o.destaques) ? o.destaques : o.destaque ? [o.destaque] : [];
    return { destaques, projetos: o.projetos || [], identidade: o.identidade || [] };
  } catch {
    return { destaques: [], projetos: [], identidade: [] };
  }
}
