/**
 * VENTUNO — serves the static site and handles the contact form.
 * Mail goes out over SMTP (Hostinger mailbox); nothing is stored.
 */
const path = require("path");
const express = require("express");
const compression = require("compression");
const nodemailer = require("nodemailer");
const Busboy = require("busboy");

const app = express();
const PORT = process.env.PORT || 80;

const SMTP_HOST = process.env.SMTP_HOST || "smtp.hostinger.com";
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const CONTACT_TO = process.env.CONTACT_TO || SMTP_USER;

app.set("trust proxy", 1); // behind Easypanel's proxy
app.use(compression());
app.use(express.json({ limit: "32kb" }));

/* ---------- rate limit: 5 sends per IP per 15 min ---------- */
const hits = new Map();
const WINDOW = 15 * 60 * 1000;
const MAX = 5;
setInterval(() => {
  const cutoff = Date.now() - WINDOW;
  for (const [ip, times] of hits) {
    const kept = times.filter((t) => t > cutoff);
    if (kept.length) hits.set(ip, kept);
    else hits.delete(ip);
  }
}, WINDOW).unref();

function rateLimited(ip) {
  const now = Date.now();
  const times = (hits.get(ip) || []).filter((t) => t > now - WINDOW);
  if (times.length >= MAX) return true;
  times.push(now);
  hits.set(ip, times);
  return false;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function buildHtml({ name, email, message, lang, when }) {
  return `<!DOCTYPE html><html lang="pt"><body style="margin:0;background:#0A0A0B;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0B;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border:1px solid #26262b;border-radius:16px;overflow:hidden;">
<tr><td style="padding:26px 30px;border-bottom:1px solid #26262b;">
<div style="color:#C8FF00;font-size:12px;letter-spacing:.18em;font-weight:700;">VENTUNO — NOVO CONTATO</div>
<div style="color:#8b8b85;font-size:12px;margin-top:6px;">Recebido em ${esc(when)} · idioma do visitante: ${esc(lang || "—")}</div>
</td></tr>
<tr><td style="padding:26px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
<tr><td style="padding:9px 0;border-bottom:1px solid #1e1e22;color:#6f6f68;font-size:11px;letter-spacing:.12em;text-transform:uppercase;width:90px;vertical-align:top;">Nome</td>
<td style="padding:9px 0;border-bottom:1px solid #1e1e22;color:#EDEDEA;font-size:15px;">${esc(name)}</td></tr>
<tr><td style="padding:9px 0;border-bottom:1px solid #1e1e22;color:#6f6f68;font-size:11px;letter-spacing:.12em;text-transform:uppercase;vertical-align:top;">Email</td>
<td style="padding:9px 0;border-bottom:1px solid #1e1e22;font-size:15px;"><a href="mailto:${esc(email)}" style="color:#C8FF00;text-decoration:none;">${esc(email)}</a></td></tr>
</table>
<div style="margin-top:20px;color:#6f6f68;font-size:11px;letter-spacing:.12em;text-transform:uppercase;">Mensagem</div>
<div style="margin-top:8px;background:#0A0A0B;border:1px solid #1e1e22;border-radius:10px;padding:16px 18px;color:#EDEDEA;font-size:15px;line-height:1.6;">${esc(message).replace(/\n/g, "<br>")}</div>
<div style="margin-top:24px;"><a href="mailto:${esc(email)}" style="display:inline-block;background:#C8FF00;color:#0A0A0B;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:100px;">Responder a ${esc(name)}</a></div>
</td></tr>
<tr><td style="padding:16px 30px;background:#0d0d0f;border-top:1px solid #26262b;color:#6f6f68;font-size:11px;">Enviado pelo formulário de zeroventuno.com</td></tr>
</table></td></tr></table></body></html>`;
}

let transporter = null;
if (SMTP_USER && SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
} else {
  console.warn("[contato] SMTP_USER/SMTP_PASS ausentes — o formulário responderá 503.");
}

app.post("/api/contact", async (req, res) => {
  const { name = "", email = "", message = "", website = "", lang = "" } = req.body || {};

  // honeypot: bots fill hidden fields — pretend success and drop it
  if (String(website).trim() !== "") return res.json({ ok: true });

  if (!String(name).trim() || !String(email).trim() || !String(message).trim()) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }
  if (!EMAIL_RE.test(String(email).trim())) {
    return res.status(400).json({ ok: false, error: "invalid_email" });
  }
  if (String(message).length > 5000) {
    return res.status(400).json({ ok: false, error: "too_long" });
  }
  if (rateLimited(req.ip)) {
    return res.status(429).json({ ok: false, error: "rate_limited" });
  }
  if (!transporter) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }

  const clean = {
    name: String(name).trim().slice(0, 120),
    email: String(email).trim().slice(0, 200),
    message: String(message).trim(),
    lang: String(lang).slice(0, 5),
    when: new Date().toLocaleString("pt-BR", { timeZone: "Europe/Rome" }),
  };

  try {
    await transporter.sendMail({
      from: `"VENTUNO — site" <${SMTP_USER}>`, // must be the authenticated mailbox (SPF/DMARC)
      to: CONTACT_TO,
      // forma estruturada, não string montada à mão: o nome vem do visitante e
      // uma aspa dentro dele quebraria a string, injetando um segundo endereço
      // no replyTo. Passando {name, address} quem escapa é o nodemailer.
      replyTo: { name: clean.name, address: clean.email },
      subject: `Novo contato pelo site — ${clean.name}`,
      text: `Nome: ${clean.name}\nEmail: ${clean.email}\nIdioma: ${clean.lang}\nRecebido: ${clean.when}\n\n${clean.message}`,
      html: buildHtml(clean),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[contato] falha no envio:", err.message);
    res.status(502).json({ ok: false, error: "send_failed" });
  }
});

/* ---------- pedido de cartão digital (multipart, com foto opcional) ----------
 * Rota separada da /api/contact de propósito: aquela funciona e manda só texto;
 * esta aceita arquivo, e arquivo é a parte do servidor que mais dá errado.
 */


const FOTO_MAX = 10 * 1024 * 1024; // 10 MB — o briefing pediu ~10
const CAMPO_MAX = 4 * 1024;
const CAMPOS_MAX = 20;
// base64 infla ~33%: 10 MB de foto viram ~13,3 MB de e-mail. Cabe no limite da
// Hostinger, mas cada pedido em voo segura esses bytes na memória do contêiner,
// então limito quantos podem estar subindo ao mesmo tempo.
const EM_VOO_MAX = 3;
let emVoo = 0;

/* O tipo vem dos bytes, nunca do Content-Type que o cliente declarou: aquele
 * campo é texto livre e um .exe pode se anunciar como image/png. Sem isto o
 * formulário vira um jeito de mandar binário arbitrário para a caixa dele. */
function tipoDaImagem(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return { mime: "image/png", ext: "png" };
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP")
    return { mime: "image/webp", ext: "webp" };
  if (buf.subarray(4, 8).toString("latin1") === "ftyp") {
    const marca = buf.subarray(8, 12).toString("latin1");
    if (["heic", "heix", "hevc", "heim", "heis", "hevm", "hevs", "mif1", "msf1"].includes(marca))
      return { mime: "image/heic", ext: "heic" };
  }
  return null;
}

function lerMultipart(req) {
  return new Promise((resolve, reject) => {
    let bb;
    try {
      bb = Busboy({
        headers: req.headers,
        limits: { fileSize: FOTO_MAX, files: 1, fields: CAMPOS_MAX, fieldSize: CAMPO_MAX },
      });
    } catch (e) {
      return reject(Object.assign(new Error("not_multipart"), { codigo: 415 }));
    }

    const campos = {};
    let foto = null;
    let grande = false;
    let demais = false;

    bb.on("field", (nome, valor) => { campos[nome] = valor; });
    bb.on("filesLimit", () => { demais = true; });

    bb.on("file", (_nome, stream, info) => {
      const pedacos = [];
      let total = 0;
      stream.on("data", (d) => { pedacos.push(d); total += d.length; });
      stream.on("limit", () => { grande = true; });
      stream.on("end", () => {
        if (!grande && total > 0) {
          foto = { buffer: Buffer.concat(pedacos), nomeOriginal: String(info.filename || "") };
        }
      });
    });

    bb.on("error", (e) => reject(e));
    bb.on("close", () => {
      if (grande) return reject(Object.assign(new Error("too_large"), { codigo: 413 }));
      if (demais) return reject(Object.assign(new Error("too_many_files"), { codigo: 400 }));
      resolve({ campos, foto });
    });

    req.pipe(bb);
  });
}

function htmlPedido(d) {
  const linha = (rotulo, valor) =>
    !valor ? "" :
    `<tr><td style="padding:9px 0;border-bottom:1px solid #1e1e22;color:#6f6f68;font-size:11px;letter-spacing:.12em;text-transform:uppercase;width:130px;vertical-align:top;">${esc(rotulo)}</td>
<td style="padding:9px 0;border-bottom:1px solid #1e1e22;color:#EDEDEA;font-size:15px;">${esc(valor)}</td></tr>`;
  return `<!DOCTYPE html><html lang="pt"><body style="margin:0;background:#0A0A0B;font-family:Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0A0A0B;padding:32px 16px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#111113;border:1px solid #26262b;border-radius:16px;overflow:hidden;">
<tr><td style="padding:26px 30px;border-bottom:1px solid #26262b;">
<div style="color:#C8FF00;font-size:12px;letter-spacing:.18em;font-weight:700;">VENTUNO — PEDIDO DE CARTÃO</div>
<div style="color:#8b8b85;font-size:12px;margin-top:6px;">Recebido em ${esc(d.when)} · idioma do visitante: ${esc(d.lang || "—")}</div>
</td></tr>
<tr><td style="padding:26px 30px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${linha("Nome", d.nome + " " + d.sobrenome)}
${linha("E-mail", d.email)}
${linha("Telefone", d.telefone)}
${linha("Empresa", d.empresa)}
${linha("Cargo", d.cargo)}
${linha("Site", d.site)}
${linha("Plano", d.plano)}
${linha("Foto", d.temFoto ? "em anexo" : "não enviada")}
</table>
${d.mensagem ? `<div style="margin-top:20px;color:#6f6f68;font-size:11px;letter-spacing:.12em;text-transform:uppercase;">Mensagem</div>
<div style="margin-top:8px;background:#0A0A0B;border:1px solid #1e1e22;border-radius:10px;padding:16px 18px;color:#EDEDEA;font-size:15px;line-height:1.6;">${esc(d.mensagem).replace(/\n/g, "<br>")}</div>` : ""}
<div style="margin-top:24px;"><a href="mailto:${esc(d.email)}" style="display:inline-block;background:#C8FF00;color:#0A0A0B;font-size:14px;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:100px;">Responder a ${esc(d.nome)}</a></div>
</td></tr>
<tr><td style="padding:16px 30px;background:#0d0d0f;border-top:1px solid #26262b;color:#6f6f68;font-size:11px;">Enviado pela página de cartões de zeroventuno.com · consentimento de dados aceito</td></tr>
</table></td></tr></table></body></html>`;
}

app.post("/api/cartoes", async (req, res) => {
  if (!String(req.headers["content-type"] || "").startsWith("multipart/form-data")) {
    return res.status(415).json({ ok: false, error: "not_multipart" });
  }
  if (rateLimited(req.ip)) return res.status(429).json({ ok: false, error: "rate_limited" });
  if (emVoo >= EM_VOO_MAX) return res.status(503).json({ ok: false, error: "busy" });

  emVoo++;
  let dados;
  try {
    dados = await lerMultipart(req);
  } catch (err) {
    return res.status(err.codigo || 400).json({ ok: false, error: err.message || "bad_request" });
  } finally {
    emVoo--;
  }

  const c = dados.campos;

  // honeypot: bot preenche campo escondido — finge sucesso e descarta
  if (String(c.website || "").trim() !== "") return res.json({ ok: true });

  const corta = (v, n) => String(v || "").trim().slice(0, n);
  const limpo = {
    nome: corta(c.nome, 80),
    sobrenome: corta(c.sobrenome, 80),
    email: corta(c.email, 200),
    telefone: corta(c.telefone, 40),
    empresa: corta(c.empresa, 120),
    cargo: corta(c.cargo, 120),
    site: corta(c.site, 200),
    plano: corta(c.plano, 40),
    mensagem: corta(c.mensagem, 3000),
    lang: corta(c.lang, 5),
    when: new Date().toLocaleString("pt-BR", { timeZone: "Europe/Rome" }),
  };

  const faltando = ["nome", "sobrenome", "email", "telefone", "empresa", "cargo"].filter((k) => !limpo[k]);
  if (faltando.length) return res.status(400).json({ ok: false, error: "missing_fields", fields: faltando });
  if (!EMAIL_RE.test(limpo.email)) return res.status(400).json({ ok: false, error: "invalid_email" });
  // consentimento e obrigatorio: o publico e Italia/UE
  if (!["1", "true", "on", "sim", "si", "yes"].includes(String(c.consentimento || "").toLowerCase())) {
    return res.status(400).json({ ok: false, error: "consent_required" });
  }

  let anexo = null;
  if (dados.foto) {
    const tipo = tipoDaImagem(dados.foto.buffer);
    if (!tipo) return res.status(415).json({ ok: false, error: "invalid_image" });
    // nome gerado por nos: o nome que veio do cliente pode trazer caminho,
    // extensao dupla ou caractere de controle, e vai parar no cabecalho MIME.
    const base = (limpo.nome + "-" + limpo.sobrenome).toLowerCase().normalize("NFD")
      .replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "foto";
    anexo = { filename: base + "." + tipo.ext, content: dados.foto.buffer, contentType: tipo.mime };
  }
  limpo.temFoto = Boolean(anexo);

  if (!transporter) return res.status(503).json({ ok: false, error: "not_configured" });

  try {
    await transporter.sendMail({
      from: `"VENTUNO — cartões" <${SMTP_USER}>`, // precisa ser a caixa autenticada (SPF/DMARC)
      to: CONTACT_TO,
      replyTo: { name: `${limpo.nome} ${limpo.sobrenome}`, address: limpo.email },
      subject: `Pedido de cartão digital — ${limpo.nome} ${limpo.sobrenome}`,
      text:
        `Nome: ${limpo.nome} ${limpo.sobrenome}\nEmail: ${limpo.email}\nTelefone: ${limpo.telefone}\n` +
        `Empresa: ${limpo.empresa}\nCargo: ${limpo.cargo}\nSite: ${limpo.site || "—"}\n` +
        `Plano: ${limpo.plano || "—"}\nFoto: ${limpo.temFoto ? "em anexo" : "não enviada"}\n` +
        `Idioma: ${limpo.lang}\nRecebido: ${limpo.when}\n\n${limpo.mensagem || ""}`,
      html: htmlPedido(limpo),
      attachments: anexo ? [anexo] : [],
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[cartoes] falha no envio:", err.message);
    res.status(502).json({ ok: false, error: "send_failed" });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, smtp: Boolean(transporter) }));

/* ---------- static site ---------- */
app.use(
  express.static(path.join(__dirname, "public"), {
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader("Cache-Control", "public, max-age=2592000");
      } else {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);
// SPA fallback — mas um arquivo que não existe deve dar 404, e não devolver a
// página inteira: senão uma imagem quebrada responde 200 e o erro passa batido.
app.use((req, res) => {
  const last = req.path.split("/").pop() || "";
  if (last.includes(".")) return res.status(404).type("txt").send("Not found");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => console.log(`VENTUNO no ar na porta ${PORT}`));
