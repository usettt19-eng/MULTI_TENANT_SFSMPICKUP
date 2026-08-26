// Manda por correo (vía SES SMTP) la invitación a la prueba beta de iOS
// (TestFlight) a los padres reales de The Casco School.
//
// A diferencia de Android, TestFlight NO exige un correo de un proveedor
// específico (no hace falta Gmail) — cualquier correo sirve, solo se
// necesita un iPhone. Por eso esta lista no está filtrada por dominio,
// solo se excluyeron 2 cuentas de datos de ejemplo (@ejemplo.com) que no
// corresponden a padres reales.
//
// Uso:
//   cd scripts
//   npm install nodemailer   (si no lo instalaste ya para el script de Android)
//   SMTP_HOST=email-smtp.<region>.amazonaws.com \
//   SMTP_USER=<usuario SMTP de SES> \
//   SMTP_PASS=<password SMTP de SES> \
//   node send-ios-beta-invite.mjs
//
// Variables opcionales:
//   SMTP_PORT     (default 587)
//   FROM_EMAIL    (default "Safe Smart Pickup <no-reply@safesmartpickup.com>")
//   DRY_RUN=1     no envía nada, solo imprime a quién le mandaría

import nodemailer from 'nodemailer';

const RECIPIENTS = [
  'keniadagmar12@gmail.com', // Kenia Alvarez
  'srubenduse@gmail.com',    // luis Perez (cuenta de prueba)
  'srubend@gmail.com',       // Ruben Dario Suarez Sanchez (cuenta de prueba)
];

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Safe Smart Pickup <no-reply@safesmartpickup.com>';
const DRY_RUN = process.env.DRY_RUN === '1';

const SUBJECT = 'Ayúdanos a probar Safe Smart Pickup en iPhone — antes del lanzamiento';

const TEXT_BODY = `Hola,

Antes de publicar oficialmente la app de Safe Smart Pickup para iPhone, estamos haciendo una prueba con un grupo pequeño de padres, y fuiste seleccionado para participar.

Solo te toma un par de minutos. Únete a la prueba aquí:
https://safesmartpickup.com/prueba-ios.html

Ahí encontrarás el paso a paso completo. En resumen: necesitas la app TestFlight (de Apple, gratis en el App Store) y abrir el enlace desde tu iPhone — luego solo aceptas e instalas Safe Smart Pickup, como cualquier otra app.

Es una versión de prueba, así que si ves algo raro o tienes cualquier duda mientras la usas, simplemente responde este correo — nos ayuda muchísimo a mejorarla antes de que salga al público.

¡Gracias por tu ayuda!

El equipo de Safe Smart Pickup`;

const HTML_BODY = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:34rem;margin:0 auto;color:#101a2c;line-height:1.6;">
  <p>Hola,</p>
  <p>Antes de publicar oficialmente la app de <strong>Safe Smart Pickup</strong> para iPhone, estamos haciendo una prueba con un grupo pequeño de padres — y fuiste seleccionado para participar.</p>
  <p style="text-align:center;margin:2rem 0;">
    <a href="https://safesmartpickup.com/prueba-ios.html"
       style="background:#362f97;color:#ffffff;text-decoration:none;font-weight:700;padding:0.9rem 1.6rem;border-radius:0.6rem;display:inline-block;">
      Únete a la prueba
    </a>
  </p>
  <p>Ahí encontrarás el paso a paso completo. En resumen: necesitas la app <strong>TestFlight</strong> (de Apple, gratis en el App Store) y abrir el enlace desde tu <strong>iPhone</strong> — luego solo aceptas e instalas Safe Smart Pickup, como cualquier otra app.</p>
  <p>Es una versión de prueba, así que si ves algo raro o tienes cualquier duda mientras la usas, simplemente responde este correo — nos ayuda muchísimo a mejorarla antes de que salga al público.</p>
  <p>¡Gracias por tu ayuda!<br>El equipo de Safe Smart Pickup</p>
</div>`;

async function main() {
  console.log(`Destinatarios: ${RECIPIENTS.length}`);

  if (DRY_RUN) {
    console.log('DRY_RUN=1 -> no se envía nada, solo se lista:');
    RECIPIENTS.forEach((email) => console.log(' -', email));
    return;
  }

  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    console.error('Faltan variables de entorno: SMTP_HOST, SMTP_USER, SMTP_PASS son obligatorias.');
    process.exit(1);
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  const results = { sent: [], failed: [] };

  for (const email of RECIPIENTS) {
    try {
      await transporter.sendMail({
        from: FROM_EMAIL,
        to: email,
        subject: SUBJECT,
        text: TEXT_BODY,
        html: HTML_BODY,
      });
      results.sent.push(email);
      console.log(`✓ enviado a ${email}`);
    } catch (err) {
      results.failed.push({ email, error: err.message });
      console.error(`✗ falló ${email}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log('\n--- Resumen ---');
  console.log(`Enviados: ${results.sent.length}`);
  console.log(`Fallidos: ${results.failed.length}`);
  if (results.failed.length > 0) {
    console.log('Correos que fallaron:');
    results.failed.forEach(({ email, error }) => console.log(` - ${email}: ${error}`));
  }
}

main();
