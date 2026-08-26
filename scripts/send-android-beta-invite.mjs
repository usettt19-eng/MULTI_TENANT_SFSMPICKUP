// Manda por correo (vía SES SMTP) la invitación a la prueba beta de Android
// a la lista fija de 100 padres de TCS Albrook + TCS Costa del Este.
//
// Uso:
//   cd scripts
//   npm install nodemailer
//   SMTP_HOST=email-smtp.<region>.amazonaws.com \
//   SMTP_USER=<usuario SMTP de SES> \
//   SMTP_PASS=<password SMTP de SES> \
//   node send-android-beta-invite.mjs
//
// Variables opcionales:
//   SMTP_PORT     (default 587)
//   FROM_EMAIL    (default "Safe Smart Pickup <no-reply@safesmartpickup.com>")
//   DRY_RUN=1     no envía nada, solo imprime a quién le mandaría
//
// Las credenciales SMTP son las mismas que ya se generaron para el IAM
// dedicado de SES (ver ESTADO-DEL-PROYECTO.md, sección "Correo real e
// invitaciones"). Si no las tienes a mano, se generan de nuevo en
// AWS SES -> SMTP settings -> Create SMTP credentials (no se pueden
// recuperar credenciales viejas, solo crear unas nuevas).

import nodemailer from 'nodemailer';

const RECIPIENTS = [
  'abnerbenaim@gmail.com', 'acgr.grac@gmail.com', 'adamkohnstamm@gmail.com',
  'adspanama14@gmail.com', 'ahidrovo@gmail.com', 'ahuzzard@gmail.com',
  'albertochongw@gmail.com', 'alejandrarodriguez04@gmail.com', 'alessfamig@gmail.com',
  'alonsoalejandro@gmail.com', 'altacoco.g@gmail.com', 'ameikle@gmail.com',
  'amspeci@gmail.com', 'anamilenah1231@gmail.com', 'andrea.maestre23@gmail.com',
  'andreamalub@gmail.com', 'angel.i.marin@gmail.com', 'angelmarquez70@gmail.com',
  'angelo.sanov@gmail.com', 'angelots@gmail.com', 'anibalmoli87@gmail.com',
  'anikasanin@gmail.com', 'antonio75silv@gmail.com', 'anyasardelic2491@gmail.com',
  'aracelisobenes@gmail.com', 'arauzcarolina@gmail.com', 'ariadnalide@gmail.com',
  'aspadamejia@gmail.com', 'avicentemayo@gmail.com', 'beatricenavereau@gmail.com',
  'bensimonmauro@gmail.com', 'bgpozuelo@gmail.com', 'biocata@gmail.com',
  'blackswanpsy@gmail.com', 'boyzielee@gmail.com', 'bozenapty@gmail.com',
  'brianwanlass@gmail.com', 'briceno.roxana@gmail.com', 'brittvanmarsenille@gmail.com',
  'bvallesr@gmail.com', 'byrocar@gmail.com', 'ca.forde06@gmail.com',
  'carlijneblom@gmail.com', 'carlosdelgado1973@gmail.com', 'carloshlozanoch@gmail.com',
  'carol.planeta23@gmail.com', 'carovictoriag@gmail.com', 'catacastrogavi85@gmail.com',
  'catalinagomez.isf@gmail.com', 'cathe.caro0987@gmail.com', 'catherinedaly@gmail.com',
  'cctravis@gmail.com', 'celsorodriguezd@gmail.com', 'cesar.conto@gmail.com',
  'cesar883@gmail.com', 'cesarcaro.quimed@gmail.com', 'charliebrame92@gmail.com',
  'charlotte.pritchard3@gmail.com', 'cherilmoralesjose@gmail.com', 'chetwyn.clarke@gmail.com',
  'christianlopezgt@gmail.com', 'christina.danello@gmail.com', 'ciciliani@gmail.com',
  'cjvelasquez12@gmail.com', 'claudia.ale.alvarado@gmail.com', 'claudiasapir76@gmail.com',
  'consultorioinmobiliario@gmail.com', 'cristobal.icaza@gmail.com', 'crspatino1@gmail.com',
  'cvchambel@gmail.com', 'cvisuete24@gmail.com', 'damendez.arias@gmail.com',
  'danieljarevalo1@gmail.com', 'david.flores3@gmail.com', 'daviddiaz10pv@gmail.com',
  'dedeia061115@gmail.com', 'demetrioantonatos@gmail.com', 'deurypul@gmail.com',
  'dguanchezaponte@gmail.com', 'dianasilvahijos@gmail.com', 'diego.mendoza.salazar@gmail.com',
  'diegovarela76@gmail.com', 'diwan.singh70@gmail.com', 'dmayorgag5@gmail.com',
  'donelly.iva@gmail.com', 'elizabethvaucher@gmail.com', 'elsafajardo@gmail.com',
  'elsiegeraldine@gmail.com', 'emmanuelle.cheurlin@gmail.com', 'engineer.sglee@gmail.com',
  'ertas71tolga@gmail.com', 'esperanzagonzalezm@gmail.com', 'estebanruizm@gmail.com',
  'esthermswart@gmail.com', 'fabiola.hemadi@gmail.com', 'fe.fernandez84@gmail.com',
  'fer.rojaz@gmail.com', 'ferrangalindolara@gmail.com', 'fhafesji@gmail.com',
  'flopezmusic@gmail.com',
];

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Safe Smart Pickup <no-reply@safesmartpickup.com>';
const DRY_RUN = process.env.DRY_RUN === '1';

const SUBJECT = 'Ayúdanos a probar Safe Smart Pickup en Android — antes del lanzamiento';

const TEXT_BODY = `Hola,

Antes de publicar oficialmente la app de Safe Smart Pickup para Android, estamos haciendo una prueba con un grupo pequeño de padres, y tu correo quedó seleccionado para participar.

Solo te toma un par de minutos. Únete a la prueba aquí:
https://safesmartpickup.com/prueba-android.html

Ahí encontrarás el paso a paso completo. En resumen: necesitas un teléfono Android y abrir el enlace con la sesión iniciada en tu cuenta de Gmail (la misma con la que estás registrado en Safe Smart Pickup) — luego solo confirmas e instalas desde Google Play, como cualquier otra app.

Es una versión de prueba, así que si ves algo raro o tienes cualquier duda mientras la usas, simplemente responde este correo — nos ayuda muchísimo a mejorarla antes de que salga al público.

¡Gracias por tu ayuda!

El equipo de Safe Smart Pickup`;

const HTML_BODY = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:34rem;margin:0 auto;color:#101a2c;line-height:1.6;">
  <p>Hola,</p>
  <p>Antes de publicar oficialmente la app de <strong>Safe Smart Pickup</strong> para Android, estamos haciendo una prueba con un grupo pequeño de padres — y tu correo quedó seleccionado para participar.</p>
  <p style="text-align:center;margin:2rem 0;">
    <a href="https://safesmartpickup.com/prueba-android.html"
       style="background:#362f97;color:#ffffff;text-decoration:none;font-weight:700;padding:0.9rem 1.6rem;border-radius:0.6rem;display:inline-block;">
      Únete a la prueba
    </a>
  </p>
  <p>Ahí encontrarás el paso a paso completo. En resumen: necesitas un teléfono <strong>Android</strong> y abrir el enlace con la sesión iniciada en tu cuenta de <strong>Gmail</strong> (la misma con la que estás registrado en Safe Smart Pickup) — luego solo confirmas e instalas desde Google Play, como cualquier otra app.</p>
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
    // Pausa breve entre envíos para no golpear el límite de tasa de SES.
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
