/**
 * VENTUNO — serves the static site and handles the contact form.
 * Mail goes out over SMTP (Hostinger mailbox); nothing is stored.
 */
const path = require("path");
const express = require("express");
const compression = require("compression");
const nodemailer = require("nodemailer");

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
      replyTo: `"${clean.name}" <${clean.email}>`,
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
app.use((_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => console.log(`VENTUNO no ar na porta ${PORT}`));
