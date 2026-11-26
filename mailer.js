const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});

async function sendMail({ to, subject, html, text }) {
  if (!process.env.SMTP_HOST) {
    console.warn('[mailer] SMTP non configuré — email non envoyé :', subject);
    return { ok: false, reason: 'smtp_disabled' };
  }
  return transporter.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@me23legend.app',
    to, subject, text, html
  });
}

/**
 * Envoie le code de validation de retrait.
 */
async function sendWithdrawalOTP({ to, code, amount, devise }) {
  const subject = `🔐 Code de validation retrait — ${code}`;
  const text =
`Votre code de validation pour le retrait est : ${code}

Montant : ${Number(amount).toFixed(2)} ${devise}
Ce code expire dans 10 minutes.
Ne le communiquez à personne.

Si vous n'êtes pas à l'origine de cette demande, ignorez cet email et changez votre mot de passe immédiatement.`;

  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:500px;margin:auto;padding:32px;
                background:#0d0d18;color:#e9e9ff;border-radius:16px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:32px;">🔐</div>
        <h2 style="color:#7c3aed;margin:12px 0 4px;">Validation de retrait</h2>
        <div style="color:#a0a0c0;font-size:.9rem;">Me2/3Legend</div>
      </div>
      <div style="background:rgba(124,58,237,.15);border:1px solid rgba(124,58,237,.35);
                  border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
        <div style="font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;
                    color:#a0a0c0;margin-bottom:8px;">Code à 6 chiffres</div>
        <div style="font-size:2.4rem;font-weight:800;letter-spacing:.3em;color:#22d3ee;
                    font-family:monospace;">${code}</div>
      </div>
      <div style="background:rgba(16,185,129,.1);border-left:4px solid #10b981;
                  padding:14px 18px;border-radius:8px;margin-bottom:20px;font-size:.9rem;">
        <strong>Montant :</strong> ${Number(amount).toFixed(2)} ${devise}
      </div>
      <p style="color:#a0a0c0;font-size:.85rem;line-height:1.5;">
        Ce code expire dans <strong>10 minutes</strong>. Ne le communiquez à personne.
      </p>
      <p style="color:#f59e0b;font-size:.8rem;margin-top:20px;padding-top:16px;
                border-top:1px solid rgba(124,58,237,.2);">
        ⚠️ Si vous n'êtes pas à l'origine de cette demande, ignorez cet email
        et changez votre mot de passe immédiatement.
      </p>
    </div>`;

  return sendMail({ to, subject, text, html });
}

module.exports = { sendMail, sendWithdrawalOTP };