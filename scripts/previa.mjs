// Prévia local do portfólio.
// Lê as peças (_portfolio/<slug>/) em C:\Dev a cada página e mostra os cards,
// a página de cada projeto e a de cada marca, com os rascunhos e o que falta.
// Escuta só em 127.0.0.1. Não vai para o servidor: o Dockerfile não copia scripts/.
//
//   npm run previa            -> http://localhost:4021
//   PORTFOLIO_RAIZ=D:\Outra   -> lê outra pasta
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { lerTudo, lerOrdem, TIPOS, STATUS, RAIZ_PADRAO, PRE } from "./portfolio/pecas.mjs";
import { esc, blocos } from "./portfolio/markdown.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ORDEM = path.join(AQUI, "..", "conteudo", "ordem.yml");
const PORT = Number(process.env.PORT) || 4021;

let cache = null;
let cacheEm = 0;
function dados(forcar) {
  if (forcar || !cache || Date.now() - cacheEm > 3000) {
    cache = lerTudo();
    cache.ordem = lerOrdem(ORDEM);
    cacheEm = Date.now();
  }
  return cache;
}

/* ---------- ajudantes ---------- */

const marcaPre = (html) => html.replace(/\[preencher\]/g, '<span class="pre">[preencher]</span>');
const txt = (v) => marcaPre(esc(v ?? ""));
const md = (s) => marcaPre(blocos(s));
const lista = (v) => (Array.isArray(v) ? v : v !== undefined && v !== null && v !== "" ? [v] : []).filter((x) => x !== null && x !== "");
const etiqueta = (fm) => fm.etiqueta || [TIPOS[fm.tipo], fm.categoria].filter(Boolean).join(" · ");
const url = { projeto: (s) => `/projetos/${encodeURIComponent(s)}`, marca: (s) => `/identidade/${encodeURIComponent(s)}` };
const conta = (probs, nivel) => probs.filter((p) => p.nivel === nivel).length;
const plural = (n, s, p) => `${n} ${n === 1 ? s : p}`;

function ordenar(itens, ordem, chave) {
  const pos = (s) => { const i = ordem.indexOf(s); return i < 0 ? 1e6 : i; };
  return itens.slice().sort((a, b) => pos(chave(a)) - pos(chave(b)) || chave(a).localeCompare(chave(b)));
}

const selo = (estado) => `<span class="selo selo-${esc(estado || "sem")}">${esc(estado || "sem estado")}</span>`;

function prontidao(estado, probs, publicavel, extra) {
  if (publicavel) return '<span class="pronto ok">vai ao ar</span>';
  const partes = [];
  const e = conta(probs, "erro");
  const p = conta(probs, "pendencia");
  if (e) partes.push(plural(e, "erro", "erros"));
  if (p) partes.push(plural(p, "pendência", "pendências"));
  if (extra) partes.push(extra);
  else if (estado !== "aprovado") partes.push(estado === "oculto" ? "oculta" : "falta aprovar");
  return `<span class="pronto">${partes.join(" · ")}</span>`;
}
const prontidaoPeca = (p) => prontidao(p.fm.estado, p.problemas, p.publicavel);
const prontidaoMarca = (id) => prontidao(id.fm.estado, id.problemas, id.publicavel, id.fm.autoria === "aplicacao" ? "autoria aplicacao: fora da seção" : null);

const NIVEL = { erro: "Erro", pendencia: "Pendência", aviso: "Aviso" };
const PESO = { erro: 0, pendencia: 1, aviso: 2 };
function listaProblemas(probs) {
  return `<ul>${probs
    .slice()
    .sort((a, b) => PESO[a.nivel] - PESO[b.nivel])
    .map((q) => `<li><span class="lv lv-${q.nivel}">${NIVEL[q.nivel]}</span>${txt(q.texto)}</li>`)
    .join("")}</ul>`;
}
function caixaProblemas(titulo, probs, publicavel) {
  if (!probs.length) return `<div class="caixa ok"><h4>${titulo}</h4>Nada a corrigir.${publicavel ? "" : " Falta só a aprovação."}</div>`;
  return `<div class="caixa"><h4>${titulo}</h4>${listaProblemas(probs)}</div>`;
}

function logoHtml(id, preferirEscuro = true) {
  const neg = id.logos["logo-negativo"];
  const pri = id.logos["logo-principal"];
  if (preferirEscuro && neg) return `<div class="logo escuro"><img src="${neg}" alt=""></div>`;
  if (pri) return `<div class="logo claro"><img src="${pri}" alt=""></div>`;
  return '<div class="logo vazio">sem logo</div>';
}

function galeriaHtml(itens, titulo = "Galeria") {
  if (!itens.length) return "";
  const figs = itens.map((it) => {
    if (!it.existe) return `<figure class="falta"><div class="midia vazio">arquivo não existe</div><figcaption>${esc(it.arquivo)}</figcaption></figure>`;
    const alta = it.w && it.h / it.w > 1.7;
    let m;
    if (it.tipo === "video") m = `<video src="${it.url}"${it.poster ? ` poster="${it.poster}"` : ""} controls muted loop playsinline preload="metadata"></video>`;
    else if (it.tipo === "pdf") m = `<a class="pdf" href="${it.url}" target="_blank" rel="noopener">abrir o PDF</a>`;
    else m = `<a href="${it.url}" target="_blank" rel="noopener"><img src="${it.url}" alt="${esc(it.legenda || "")}" loading="lazy"></a>`;
    const dim = it.w ? ` <span class="dim">${it.w} × ${it.h}</span>` : it.kb ? ` <span class="dim">${it.kb} KB</span>` : "";
    return `<figure class="${alta ? "alta" : ""}"><div class="midia">${m}</div><figcaption>${txt(it.legenda || "sem legenda")}${dim}</figcaption></figure>`;
  });
  return `<section class="bloco largo"><h2 class="rot">${titulo}</h2><div class="galeria">${figs.join("")}</div></section>`;
}

/* ---------- moldura ---------- */

const CSS = `
:root{--noite:#0A0A0B;--txt:#EDEDEA;--mudo:#8E8E89;--linha:rgba(237,237,234,.12);--acc:#C8FF00;--erro:#FF6A5C;--pend:#FFD400;--ok:#7CFFB2;--card:#121214}
*{box-sizing:border-box}
html{background:var(--noite);color:var(--txt);-webkit-text-size-adjust:100%}
body{margin:0;font:16px/1.6 "Space Grotesk",system-ui,sans-serif;background:var(--noite);overflow-x:hidden}
a{color:inherit}
img,video{max-width:100%}
code{font-family:"JetBrains Mono",monospace;font-size:.88em}
.faixa{position:sticky;top:0;z-index:5;background:var(--pend);color:#0A0A0B;font:11px/1.3 "JetBrains Mono",monospace;letter-spacing:.12em;text-align:center;padding:7px 16px;text-transform:uppercase}
.wrap{max-width:1240px;margin:0 auto;padding:0 24px}
h1,h2,h3{font-family:"Clash Display",sans-serif;font-weight:600;line-height:1.05;margin:0}
h1{font-size:clamp(40px,7vw,88px);letter-spacing:-.02em}
.rot{font:11px/1.2 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.14em;color:var(--mudo);margin:0 0 18px;font-weight:400}
.cab{padding-top:48px}
.lead{max-width:760px;color:#cfcfca;font-size:17px;margin:18px 0 0}
.placar{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
.placar span{font:12px "JetBrains Mono",monospace;border:1px solid var(--linha);border-radius:99px;padding:7px 12px;color:#cfcfca}
.placar b{color:var(--txt);font-weight:400}
.sec{margin-top:72px}
.sec-head{display:flex;align-items:baseline;justify-content:space-between;gap:16px;border-bottom:1px solid var(--linha);padding-bottom:12px;margin-bottom:24px;flex-wrap:wrap}
.sec-head h2{font-size:32px}
.sec-head .nota{margin:0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:24px}
.card,.card-marca{background:var(--card);border:1px solid var(--linha);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.card-marca{text-decoration:none}
.card-marca:hover,.card:hover{border-color:rgba(200,255,0,.45)}
.card-capa{display:block;aspect-ratio:16/10;background:#1a1a1d;overflow:hidden;text-decoration:none}
.card-capa img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .5s}
.card:hover .card-capa img{transform:scale(1.03)}
.sem-capa{height:100%;display:grid;place-items:center;font:12px "JetBrains Mono",monospace;color:var(--mudo);background:repeating-linear-gradient(135deg,#151517 0 12px,#18181b 12px 24px)}
.card-corpo{padding:18px 20px 22px;display:flex;flex-direction:column;gap:10px}
.card h3,.card-marca h3{font-size:26px}
.card h3 a{text-decoration:none}
.card h3 a:hover{color:var(--acc)}
.card h3 .sep{color:var(--mudo)}
.card p,.card-marca p{margin:0;color:#c9c9c4;font-size:15px}
.etq{font:11px/1.35 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--acc)}
.selos{display:flex;flex-direction:column;gap:6px}
.linha-selo{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13px}
.selo{font:10px/1 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;padding:5px 7px;border-radius:3px;border:1px solid}
.selo-rascunho{background:var(--pend);color:#0A0A0B;border-color:var(--pend)}
.selo-aprovado{color:var(--ok);border-color:var(--ok)}
.selo-oculto,.selo-sem{color:var(--mudo);border-color:var(--mudo)}
.pronto{font:11px/1.3 "JetBrains Mono",monospace;color:var(--mudo)}
.pronto.ok{color:var(--ok)}
.tag{align-self:flex-start;font:10px/1 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;padding:5px 7px;border-radius:3px;border:1px dashed var(--mudo);color:var(--mudo)}
.tag.destaque{border-color:var(--acc);color:var(--acc)}
.nums{display:grid;grid-template-columns:repeat(auto-fit,minmax(70px,1fr));gap:10px;border-top:1px solid var(--linha);padding-top:12px}
.nums b{display:block;font:600 20px/1.1 "Clash Display",sans-serif;color:var(--acc)}
.nums span{font-size:11px;color:var(--mudo);line-height:1.25;display:block;margin-top:4px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:11px/1 "JetBrains Mono",monospace;border:1px solid var(--linha);border-radius:99px;padding:6px 9px;color:#cfcfca}
.pre{background:rgba(255,212,0,.16);color:var(--pend);border-radius:3px;padding:0 3px;font-family:"JetBrains Mono",monospace;font-size:.88em}
.logo{aspect-ratio:16/9;display:grid;place-items:center;padding:9% 24%}
.logo img{width:100%;height:100%;object-fit:contain}
.logo.escuro{background:#0A0A0B;border-bottom:1px solid var(--linha)}
.logo.claro{background:#F6F5F2}
.logo.vazio{font:12px "JetBrains Mono",monospace;color:var(--mudo)}
.vazias{display:flex;flex-wrap:wrap;gap:8px}
.vazias span{font:12px "JetBrains Mono",monospace;border:1px dashed var(--linha);border-radius:4px;padding:6px 10px;color:var(--mudo)}
.tabela{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--linha)}
th{font:11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--mudo);font-weight:400}
td a{text-decoration:none}
td a:hover{color:var(--acc)}
td .lugar{display:block;font:11px "JetBrains Mono",monospace;color:var(--mudo)}
td ul,.caixa ul{margin:0;padding:0;list-style:none}
td li,.caixa li{padding:2px 0}
.lv{display:inline-block;min-width:78px;font:10px/1.6 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.1em}
.lv-erro{color:var(--erro)}
.lv-pendencia{color:var(--pend)}
.lv-aviso{color:var(--mudo)}
.topo{display:flex;justify-content:space-between;gap:16px;align-items:center;font:12px "JetBrains Mono",monospace;color:var(--mudo);padding:16px 24px;border-bottom:1px solid var(--linha);flex-wrap:wrap}
.topo a{text-decoration:none;color:var(--txt)}
.topo a:hover{color:var(--acc)}
.pagina{padding-bottom:120px}
.hero{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.25fr);gap:44px;align-items:center;margin-top:36px}
@media(max-width:860px){.hero{grid-template-columns:1fr}}
.hero h1{margin-top:12px}
.hero .resumo{font-size:20px;color:#d6d6d1;margin:18px 0 0}
.capa-g img{width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px;display:block;border:1px solid var(--linha)}
.capa-g .sem-capa{aspect-ratio:16/10;border-radius:8px}
.meta{display:grid;grid-template-columns:auto 1fr;gap:6px 18px;margin:26px 0 0;font-size:14px}
.meta dt{font:11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--mudo);padding-top:3px}
.meta dd{margin:0}
.nums-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:1px;background:var(--linha);border:1px solid var(--linha);border-radius:8px;overflow:hidden;margin-top:44px}
.nums-g div{background:var(--noite);padding:20px}
.nums-g b{display:block;font:600 34px/1 "Clash Display",sans-serif;color:var(--acc)}
.nums-g span{display:block;margin-top:8px;font-size:13px;color:var(--mudo)}
.grupo-chips{display:flex;flex-wrap:wrap;gap:22px;margin-top:28px}
.grupo-chips>div{display:flex;flex-direction:column;gap:8px}
.bloco{margin-top:56px;max-width:860px}
.bloco.largo{max-width:none}
.texto p{margin:0 0 1em;font-size:18px;color:#dcdcd7}
.texto h3{font-size:26px;margin:40px 0 12px}
.texto h4{font-size:20px;margin:28px 0 10px;font-family:"Clash Display",sans-serif}
.pontos{border-top:1px solid var(--linha)}
.ponto{display:grid;grid-template-columns:190px 1fr;gap:24px;padding:18px 0;border-bottom:1px solid var(--linha)}
@media(max-width:640px){.ponto{grid-template-columns:1fr;gap:6px}}
.ponto .k{font:11px/1.4 "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--acc);padding-top:5px}
.ponto .v p{margin:0 0 .6em;color:#dcdcd7}
.ponto .v p:last-child{margin:0}
.destaque{border:1px solid var(--linha);border-left:3px solid var(--acc);border-radius:8px;padding:28px;background:var(--card)}
.destaque h3{font-size:28px;margin:10px 0 14px}
.destaque p{color:#dcdcd7}
.galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:22px;align-items:start}
figure{margin:0}
.midia{border:1px solid var(--linha);border-radius:6px;overflow:hidden;background:#141416}
.midia img,.midia video{display:block;width:100%;height:auto}
.midia.vazio{aspect-ratio:4/3;display:grid;place-items:center;font:12px "JetBrains Mono",monospace;color:var(--erro)}
.midia .pdf{display:block;padding:40px;text-align:center;font:12px "JetBrains Mono",monospace}
figure.alta .midia{max-height:520px;overflow:hidden;position:relative}
figure.alta .midia::after{content:"recortada aqui · clique para ver inteira";position:absolute;left:0;right:0;bottom:0;padding:48px 12px 10px;background:linear-gradient(transparent,rgba(10,10,11,.92));font:11px "JetBrains Mono",monospace;color:#cfcfca;text-align:center;pointer-events:none}
figcaption{font-size:13px;color:#bdbdb8;margin-top:8px}
.dim{font:11px "JetBrains Mono",monospace;color:var(--mudo);white-space:nowrap}
.case h3{font-size:26px;margin:40px 0 12px}
.case h4{font-size:20px;margin:28px 0 10px;font-family:"Clash Display",sans-serif}
.case p,.case li{font-size:16px;color:#d4d4cf}
.case table{margin:18px 0}
blockquote{border-left:2px solid var(--acc);margin:0;padding-left:16px;color:#cfcfca}
.caixa{border:1px solid var(--linha);border-radius:8px;padding:16px 20px;background:var(--card);margin-top:22px;font-size:14px;max-width:860px}
.caixa.ok{color:var(--ok)}
.caixa h4{margin:0 0 8px;font:11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--mudo);font-weight:400}
.ligacao{display:flex;gap:18px;align-items:center;border:1px solid var(--linha);border-radius:8px;padding:14px 18px;text-decoration:none;max-width:620px;background:var(--card)}
.ligacao:hover{border-color:var(--acc)}
.ligacao .logo{width:120px;aspect-ratio:16/10;padding:10px;border-radius:4px;flex:none}
.ligacao .k{display:block;font:11px "JetBrains Mono",monospace;text-transform:uppercase;letter-spacing:.12em;color:var(--acc)}
.ligacao b{font-family:"Clash Display",sans-serif;font-size:22px;font-weight:600}
.nota{font-size:13px;color:var(--mudo);margin:10px 0 0}
.logos{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;margin-top:8px}
.logos figure .logo{border-radius:8px;border:1px solid var(--linha);aspect-ratio:16/10}
.cores{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));gap:18px}
.cor .amostra{height:96px;border-radius:6px;border:1px solid var(--linha)}
.cor b{display:block;margin-top:10px}
.cor code{color:var(--mudo)}
.cor p{margin:4px 0 0;font-size:13px;color:#bdbdb8}
.links{display:flex;flex-wrap:wrap;gap:10px}
.links a{font:12px "JetBrains Mono",monospace;border:1px solid var(--linha);border-radius:99px;padding:8px 12px;text-decoration:none}
.links a:hover{border-color:var(--acc);color:var(--acc)}
.depo{font-family:"Clash Display",sans-serif;font-size:26px;line-height:1.25;margin:0}
.pe{font:12px/1.6 "JetBrains Mono",monospace;color:var(--mudo);margin-top:80px;border-top:1px solid var(--linha);padding-top:16px;word-break:break-all}
@media(max-width:600px){.wrap{padding:0 16px}.topo{padding:14px 16px}.ligacao .logo{width:88px}}
`;

function moldura(titulo, corpo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · prévia do portfólio</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500&family=JetBrains+Mono:wght@400&display=swap">
<style>${CSS}</style></head><body>
<div class="faixa">Prévia local · mostra rascunhos · nada daqui está no ar</div>
${corpo}
</body></html>`;
}

const topo = (onde) => `<nav class="topo"><a href="/">← todas as peças</a><span>${onde}</span></nav>`;
const ondeMora = (p, d) => `${esc(path.relative(d.raiz, p.repo) || p.repo)}${p.branch ? ` · branch ${esc(p.branch)}` : ""}`;

/* ---------- índice ---------- */

function cardProjeto(grupo, d) {
  const p = grupo[0];
  const titulos = grupo.map((x) => `<a href="${url.projeto(x.slug)}">${txt(x.fm.titulo)}</a>`).join('<span class="sep"> · </span>');
  const capa = p.capa?.existe ? `<img src="${p.capa.url}" alt="" loading="lazy">` : '<div class="sem-capa">sem capa</div>';
  const selos = grupo
    .map((x) => `<div class="linha-selo">${grupo.length > 1 ? `<b>${txt(x.fm.titulo)}</b>` : ""}${selo(x.fm.estado)}${prontidaoPeca(x)}</div>`)
    .join("");
  const tags = [];
  const posDestaque = grupo.map((x) => d.ordem.destaques.indexOf(x.slug)).filter((i) => i >= 0);
  if (posDestaque.length) tags.push(`<span class="tag destaque">case em destaque · ${Math.min(...posDestaque) + 1} de ${d.ordem.destaques.length}</span>`);
  else if (grupo.some((x) => x.fm.destaque === true)) tags.push('<span class="tag">candidata a destaque</span>');
  if (grupo.length > 1) tags.push(`<span class="tag">família ${esc(p.fm.familia)}</span>`);
  const nums = lista(p.fm.numeros).slice(0, 4).map((n) => `<div><b>${txt(n.valor)}</b><span>${txt(n.rotulo)}</span></div>`).join("");
  const tecs = lista(p.fm.tecnologias).slice(0, 6).map((t) => `<span class="chip">${txt(t)}</span>`).join("");
  return `<article class="card"><a class="card-capa" href="${url.projeto(p.slug)}">${capa}</a><div class="card-corpo">
<div class="selos">${selos}</div>${tags.join("")}
<span class="etq">${txt(etiqueta(p.fm))}</span><h3>${titulos}</h3><p>${txt(p.fm.resumo)}</p>
${nums ? `<div class="nums">${nums}</div>` : ""}${tecs ? `<div class="chips">${tecs}</div>` : ""}</div></article>`;
}

function cardMarca(grupo) {
  const p = grupo[0];
  const id = p.identidade;
  const nomes = grupo.map((x) => txt(x.identidade.fm.marca)).join(" · ");
  const selos = grupo.map((x) => `<div class="linha-selo">${selo(x.identidade.fm.estado)}${prontidaoMarca(x.identidade)}</div>`).join("");
  return `<a class="card-marca" href="${url.marca(p.slug)}">${logoHtml(id)}<div class="card-corpo"><div class="selos">${selos}</div><h3>${nomes}</h3><p>${txt(id.fm.conceito)}</p></div></a>`;
}

function agrupar(itens, chaveFamilia) {
  const grupos = [];
  const porFamilia = new Map();
  for (const it of itens) {
    const f = chaveFamilia(it);
    if (f && porFamilia.has(f)) porFamilia.get(f).push(it);
    else { const g = [it]; grupos.push(g); if (f) porFamilia.set(f, g); }
  }
  return grupos;
}

function paginaIndice(d) {
  const ordemProj = d.ordem.projetos;
  const ordemId = d.ordem.identidade;
  const visiveis = d.pecas.filter((p) => p.fm.estado !== "oculto");
  const projetos = agrupar(ordenar(visiveis.filter((p) => p.emProjetos), ordemProj, (p) => p.slug), (p) => p.fm.familia);
  const marcas = agrupar(
    ordenar(visiveis.filter((p) => p.emIdentidade && p.identidade.entraNaSecao && p.identidade.fm.estado !== "oculto"), ordemId, (p) => p.slug),
    (p) => p.identidade.fm.familia
  );
  const ocultas = d.pecas.filter((p) => p.fm.estado === "oculto");
  const achados = new Set(d.pecas.map((p) => p.slug));
  const semPeca = [...new Set([...ordemProj, ...ordemId])].filter((s) => !achados.has(s));
  const todas = ordenar(d.pecas, [...ordemProj, ...ordemId], (p) => p.slug);
  const nEst = (e) => d.pecas.filter((p) => p.fm.estado === e).length;
  const vaoAoAr = d.pecas.filter((p) => p.publicavel).length;

  const linhas = todas.map((p) => {
    const id = p.identidade;
    return `<tr><td><a href="${url.projeto(p.slug)}"><b>${txt(p.fm.titulo || p.slug)}</b></a><span class="lugar">${ondeMora(p, d)}</span></td>
<td>${selo(p.fm.estado)}<br>${prontidaoPeca(p)}</td>
<td>${id ? `<a href="${url.marca(p.slug)}">${selo(id.fm.estado)}</a><br>${prontidaoMarca(id)}` : '<span class="pronto">—</span>'}</td>
<td>${p.problemas.length || id?.problemas.length ? listaProblemas([...p.problemas, ...(id ? id.problemas.map((q) => ({ ...q, texto: "identidade: " + q.texto })) : [])]) : '<span class="pronto ok">nada a corrigir</span>'}</td></tr>`;
  });

  return moldura(
    "Prévia",
    `<header class="wrap cab"><p class="rot">VENTUNO · portfólio montado a partir das peças</p><h1>Prévia</h1>
<p class="lead">Lida agora das pastas <code>_portfolio</code> em <code>${esc(d.raiz)}</code>: ${plural(d.pecas.length, "peça", "peças")} em ${plural(d.pastas.length, "projeto", "projetos")}. Aqui aparecem também os rascunhos, que nunca vão ao ar. Por enquanto só em português; as traduções entram na montagem do site.</p>
<div class="placar"><span><b>${nEst("rascunho")}</b> em rascunho</span><span><b>${nEst("aprovado")}</b> aprovadas</span><span><b>${nEst("oculto")}</b> ocultas</span><span><b>${vaoAoAr}</b> prontas para ir ao ar</span><span><b>${semPeca.length}</b> previstas ainda sem peça</span></div></header>
<main class="wrap">
<section class="sec"><div class="sec-head"><h2>Projetos</h2><p class="nota">na ordem de <code>conteudo/ordem.yml</code></p></div>
<div class="grid">${projetos.map((g) => cardProjeto(g, d)).join("") || '<p class="nota">Nenhuma peça de projeto ainda.</p>'}</div></section>
<section class="sec"><div class="sec-head"><h2>Identidade</h2><p class="nota">uma marca por card; a família vira um card só</p></div>
<div class="grid">${marcas.map(cardMarca).join("") || '<p class="nota">Nenhuma marca ainda.</p>'}</div></section>
${ocultas.length ? `<section class="sec"><div class="sec-head"><h2>Ocultas</h2><p class="nota">completas, mas fora do site</p></div><div class="vazias">${ocultas.map((p) => `<span>${esc(p.fm.titulo || p.slug)}</span>`).join("")}</div></section>` : ""}
<section class="sec"><div class="sec-head"><h2>Previstas, ainda sem peça</h2><p class="nota">enquanto não houver peça aprovada, o site mantém o conteúdo de hoje</p></div>
<div class="vazias">${semPeca.map((s) => `<span>${esc(s)}</span>`).join("") || '<p class="nota">Todas as previstas já têm peça.</p>'}</div></section>
<section class="sec"><div class="sec-head"><h2>O que falta em cada peça</h2><p class="nota">erro e pendência impedem a publicação; aviso não</p></div>
<div class="tabela"><table><thead><tr><th>Peça</th><th>Ficha</th><th>Identidade</th><th>O que falta</th></tr></thead><tbody>${linhas.join("")}</tbody></table></div></section>
${d.semFicha.length ? `<section class="sec"><div class="sec-head"><h2>Pastas sem ficha.md</h2></div><ul>${d.semFicha.map((s) => `<li><code>${esc(s)}</code></li>`).join("")}</ul></section>` : ""}
<p class="pe">Lido em ${d.ms} ms · ${d.pastas.map(esc).join(" · ")}</p>
</main>`
  );
}

/* ---------- página do projeto ---------- */

function paginaProjeto(p, d) {
  const fm = p.fm;
  const pt = p.partes;
  const ocultarCliente = fm.mostrar_cliente === false;
  const meta = [
    ["Ano", fm.ano],
    ["Status", STATUS[fm.status] || fm.status],
    ["Papel", lista(fm.papel).join(", ")],
    fm.tipo === "cliente" ? ["Cliente", ocultarCliente ? fm.setor || "(nome escondido)" : fm.cliente] : null,
    fm.setor && !ocultarCliente ? ["Setor", fm.setor] : null,
    fm.local ? ["Local", fm.local] : null,
  ].filter((x) => x && x[1] !== undefined && x[1] !== "");
  const capa = p.capa?.existe ? `<img src="${p.capa.url}" alt="">` : `<div class="sem-capa">${fm.capa && String(fm.capa).includes(PRE) ? "capa: [preencher]" : "sem capa"}</div>`;
  const nums = lista(fm.numeros).slice(0, 4).map((n) => `<div><b>${txt(n.valor)}</b><span>${txt(n.rotulo)}</span></div>`).join("");
  const grupoChips = [
    ["Tecnologias", fm.tecnologias],
    ["Ferramentas", fm.ferramentas],
    ["Serviços", fm.servicos],
  ]
    .filter(([, v]) => lista(v).length)
    .map(([k, v]) => `<div><span class="rot" style="margin:0">${k}</span><div class="chips">${lista(v).map((t) => `<span class="chip">${txt(t)}</span>`).join("")}</div></div>`)
    .join("");
  const pontos = pt.pontos.map((x) => `<div class="ponto"><span class="k">${txt(x.rotulo)}</span><div class="v">${md(x.texto)}</div></div>`).join("");
  const destaque = pt.destaque
    ? `<section class="bloco"><div class="destaque">${pt.destaque.etiqueta ? `<span class="etq">${txt(pt.destaque.etiqueta)}</span>` : ""}<h3>${txt(pt.destaque.titulo)}</h3>${md(pt.destaque.texto)}</div></section>`
    : "";
  const links = Object.entries(fm.links && typeof fm.links === "object" ? fm.links : {}).filter(([, v]) => v);
  const linksHtml = links.length
    ? `<section class="bloco"><h2 class="rot">Links</h2><div class="links">${links
        .map(([k, v]) => (String(v).includes(PRE) ? `<span class="chip">${esc(k)}: ${txt(v)}</span>` : `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)} ↗</a>`))
        .join("")}</div></section>`
    : "";
  const depo =
    fm.depoimento && fm.depoimento.texto
      ? `<section class="bloco"><h2 class="rot">Depoimento${fm.depoimento.autorizado === true ? "" : " · sem autorização, não aparece no site"}</h2><p class="depo">“${txt(fm.depoimento.texto)}”</p><p class="nota">${txt(fm.depoimento.autor)}${fm.depoimento.cargo ? ", " + txt(fm.depoimento.cargo) : ""}</p></section>`
      : "";
  const equipe = lista(fm.equipe).length
    ? `<section class="bloco"><h2 class="rot">Equipe</h2><ul>${lista(fm.equipe).map((e) => `<li>${txt(e.nome)} · ${txt(e.papel)}</li>`).join("")}</ul></section>`
    : "";
  const irmas = fm.familia ? d.pecas.filter((x) => x !== p && x.fm.familia === fm.familia && x.fm.estado !== "oculto") : [];
  const irmasHtml = irmas.length
    ? `<section class="bloco"><h2 class="rot">Da mesma família</h2>${irmas
        .map((x) => `<a class="ligacao" href="${url.projeto(x.slug)}"><span><span class="k">${txt(etiqueta(x.fm))}</span><b>${txt(x.fm.titulo)}</b></span></a>`)
        .join("")}</section>`
    : "";
  const id = p.identidade;
  const idHtml = id
    ? `<section class="bloco"><h2 class="rot">Identidade visual</h2><a class="ligacao" href="${url.marca(p.slug)}">${logoHtml(id)}<span><span class="k">ver a identidade</span><b>${txt(id.fm.marca)}</b><br>${selo(id.fm.estado)}</span></a>
<p class="nota">No site, este link só aparece quando a ficha e a identidade estiverem aprovadas.</p></section>`
    : "";

  return moldura(
    fm.titulo || p.slug,
    `${topo(ondeMora(p, d))}<main class="wrap pagina">
${caixaProblemas(`Ficha · ${esc(fm.estado || "sem estado")}`, p.problemas, p.publicavel)}
<section class="hero"><div><span class="etq">${txt(etiqueta(fm))}</span><h1>${txt(fm.titulo)}</h1><p class="resumo">${txt(fm.resumo)}</p>
<dl class="meta">${meta.map(([k, v]) => `<dt>${k}</dt><dd>${txt(v)}</dd>`).join("")}</dl></div>
<figure class="capa-g">${capa}</figure></section>
${nums ? `<div class="nums-g">${nums}</div>` : ""}
${grupoChips ? `<div class="grupo-chips">${grupoChips}</div>` : ""}
<section class="bloco texto">${md(pt.descricao)}</section>
${pontos ? `<section class="bloco"><div class="pontos">${pontos}</div></section>` : ""}
${destaque}
${galeriaHtml(p.galeria)}
${p.caseMd ? `<section class="bloco case"><h2 class="rot">Case</h2>${md(p.caseMd)}</section>` : ""}
${depo}${equipe}${linksHtml}${idHtml}${irmasHtml}
<p class="pe">${esc(p.dir)}<br>atualizado ${txt(fm.atualizado)} · padrão ${txt(fm.padrao)}${p.traducoes.length ? ` · traduções à mão: ${p.traducoes.map(esc).join(", ")}` : ""}</p>
</main>`
  );
}

/* ---------- página da marca ---------- */

function paginaMarca(p, d) {
  const id = p.identidade;
  const f = id.fm;
  const logos = [
    id.logos["logo-principal"] ? `<figure><div class="logo claro"><img src="${id.logos["logo-principal"]}" alt=""></div><figcaption>logo-principal, sobre fundo claro</figcaption></figure>` : "",
    id.logos["logo-negativo"] ? `<figure><div class="logo escuro"><img src="${id.logos["logo-negativo"]}" alt=""></div><figcaption>logo-negativo, sobre fundo escuro</figcaption></figure>` : "",
    id.logos.simbolo ? `<figure><div class="logo claro"><img src="${id.logos.simbolo}" alt=""></div><figcaption>símbolo</figcaption></figure>` : "",
  ].join("");
  const cores = lista(f.cores)
    .map((c) => `<div class="cor"><div class="amostra" style="background:${/^#[0-9A-Fa-f]{6}$/.test(String(c.hex)) ? c.hex : "transparent"}"></div><b>${txt(c.nome)}</b><code>${txt(c.hex)}</code><p>${txt(c.uso)}</p></div>`)
    .join("");
  const tipos = lista(f.tipografia)
    .map((t) => `<tr><td><b>${txt(t.familia)}</b></td><td>${txt(t.pesos)}</td><td>${txt(t.uso)}</td><td>${txt(t.origem)}</td></tr>`)
    .join("");
  const autoria = { original: "criada do zero", redesenho: "redesenho de uma marca existente", aplicacao: "aplicação de uma marca de outra pessoa" }[f.autoria] || f.autoria;
  const projeto = p.emProjetos
    ? `<a class="ligacao" href="${url.projeto(p.slug)}"><span><span class="k">ver o projeto</span><b>${txt(p.fm.titulo)}</b><br>${selo(p.fm.estado)}</span></a><p class="nota">No site, este link só aparece quando a ficha e a identidade estiverem aprovadas.</p>`
    : '<p class="nota">Peça só de marca (<code>mostrar_em: [identidade]</code>): não tem página de projeto, então não há "ver o projeto".</p>';

  return moldura(
    f.marca || p.slug,
    `${topo(ondeMora(p, d) + " · identidade")}<main class="wrap pagina">
${caixaProblemas(`Identidade · ${esc(f.estado || "sem estado")}`, id.problemas, id.publicavel)}
<section style="margin-top:36px"><span class="etq">Identidade visual${f.ano ? " · " + txt(f.ano) : ""} · ${txt(autoria)}</span><h1 style="margin-top:12px">${txt(f.marca)}</h1><p class="lead" style="font-size:20px">${txt(f.conceito)}</p></section>
<section class="bloco largo"><div class="logos">${logos}</div></section>
<section class="bloco texto">${md(id.corpo)}</section>
${cores ? `<section class="bloco largo"><h2 class="rot">Cores</h2><div class="cores">${cores}</div></section>` : ""}
${tipos ? `<section class="bloco"><h2 class="rot">Tipografia</h2><div class="tabela"><table><thead><tr><th>Família</th><th>Pesos</th><th>Uso</th><th>Origem</th></tr></thead><tbody>${tipos}</tbody></table></div></section>` : ""}
${galeriaHtml(id.galeria)}
${id.manual ? `<section class="bloco"><h2 class="rot">Manual</h2><div class="links"><a href="${esc(id.manual.url)}" target="_blank" rel="noopener">abrir o manual ↗</a></div></section>` : ""}
<section class="bloco"><h2 class="rot">Projeto</h2>${projeto}</section>
<p class="pe">${esc(id.dir)}<br>atualizado ${txt(f.atualizado)} · padrão ${txt(f.padrao)}</p>
</main>`
  );
}

const pagina404 = (o) =>
  moldura("Não encontrado", `${topo("")}<main class="wrap pagina"><h1 style="margin-top:40px">Não encontrado</h1><p class="lead">Nenhuma peça com ${esc(o)}.</p></main>`);

/* ---------- rotas ---------- */

const app = express();
app.disable("x-powered-by");

app.get("/", (_req, res) => res.type("html").send(paginaIndice(dados(true))));

app.get("/projetos/:slug", (req, res) => {
  const d = dados(true);
  const p = d.porSlug.get(req.params.slug);
  if (!p) return res.status(404).type("html").send(pagina404(`o slug ${req.params.slug}`));
  res.type("html").send(paginaProjeto(p, d));
});

app.get("/identidade/:slug", (req, res) => {
  const d = dados(true);
  const p = d.porSlug.get(req.params.slug);
  if (!p || !p.identidade) return res.status(404).type("html").send(pagina404(`identidade em ${req.params.slug}`));
  res.type("html").send(paginaMarca(p, d));
});

// Arquivos da peça, servidos direto da pasta do projeto (só dentro dela).
app.get("/arquivos/:slug/*", (req, res) => {
  const p = dados(false).porSlug.get(req.params.slug);
  if (!p) return res.sendStatus(404);
  const abs = path.resolve(p.dir, req.params[0] || "");
  if (!abs.startsWith(p.dir + path.sep)) return res.sendStatus(403);
  res.sendFile(abs, { dotfiles: "deny" }, (err) => {
    if (err && !res.headersSent) res.sendStatus(err.status || 404);
  });
});

app.get("/api/pecas", (_req, res) => {
  const d = dados(true);
  res.json({
    raiz: d.raiz,
    ms: d.ms,
    pastas: d.pastas,
    pecas: d.pecas.map((p) => ({
      slug: p.slug,
      estado: p.fm.estado,
      publicavel: p.publicavel,
      problemas: p.problemas,
      identidade: p.identidade ? { estado: p.identidade.fm.estado, publicavel: p.identidade.publicavel, problemas: p.identidade.problemas } : null,
    })),
  });
});

app.listen(PORT, "127.0.0.1", () => console.log(`Prévia do portfólio em http://localhost:${PORT} (lendo ${RAIZ_PADRAO})`));
