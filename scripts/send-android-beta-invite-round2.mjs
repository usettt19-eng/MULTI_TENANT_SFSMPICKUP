// Segunda tanda: manda por correo (vía SES SMTP) la invitación a la prueba
// beta de Android a los ~310 padres agregados en las listas de la pista de
// Prueba cerrada (tester44/55/66/88 en Google Play Console), que no estaban
// ya en Test_01 (Prueba interna, ver send-android-beta-invite.mjs).
//
// A diferencia de Prueba interna, el link de "Unirse" de Prueba cerrada es
// el mismo link normal de la tienda de Google Play — Play detecta
// automáticamente si la cuenta ya está en la lista de testers y muestra el
// flujo de unirse a la prueba.
//
// Uso:
//   cd scripts
//   npm install nodemailer   (si no lo hiciste ya)
//   SMTP_HOST=email-smtp.<region>.amazonaws.com \
//   SMTP_USER=<usuario SMTP de SES> \
//   SMTP_PASS=<password SMTP de SES> \
//   node send-android-beta-invite-round2.mjs
//
// Variables opcionales: SMTP_PORT, FROM_EMAIL, DRY_RUN=1 (igual que en el
// script de la primera tanda).

import nodemailer from 'nodemailer';

const RECIPIENTS = [
  'aduaelena@gmail.com', 'alejandragarciadev@gmail.com', 'alejandrapazosv@gmail.com',
  'alejandrorojas962@gmail.com', 'alizarwassouf@gmail.com', 'andreasalazar8511@gmail.com',
  'arturo.samaniego7@gmail.com', 'atorresgago@gmail.com', 'betamara27@gmail.com',
  'bonaza27@gmail.com', 'brunodamat@gmail.com', 'bushrasyeda12@gmail.com',
  'cangeles87@gmail.com', 'carchboldc@gmail.com', 'ceyc1908@gmail.com',
  'christian.arce02@gmail.com', 'cintiazrt@gmail.com', 'cphyon24@gmail.com',
  'cynthiacarmonam@gmail.com', 'danilo.abissamra@gmail.com', 'davidruizpolo@gmail.com',
  'dgyngyn@gmail.com', 'dhavish@gmail.com', 'e.aquinopineda@gmail.com',
  'e.chauderon@gmail.com', 'edsonartiga@gmail.com', 'eileenurena@gmail.com',
  'emilie.lanzafame.contact@gmail.com', 'emmacearakelly@gmail.com', 'estefany.alvarez@gmail.com',
  'esther.anies@gmail.com', 'fabecerras@gmail.com', 'fernandapeixotinho@gmail.com',
  'fgiraldezm@gmail.com', 'fige2426@gmail.com', 'fressange@gmail.com',
  'funnychingching@gmail.com', 'fvaleirao@gmail.com', 'gabriel.miquel84@gmail.com',
  'gcc1282@gmail.com', 'giannacorrea@gmail.com', 'gmelinar@gmail.com',
  'gonzasegura@gmail.com', 'grusmarkverab@gmail.com', 'hfonseca@gmail.com',
  'hormari084@gmail.com', 'iris.masi@gmail.com', 'ivisyoung1425@gmail.com',
  'jacarter70@gmail.com', 'jeffhero05@gmail.com', 'jennifer.h171@gmail.com',
  'joaquinhornasosa@gmail.com', 'jumacarvajal@gmail.com', 'kateryneb@gmail.com',
  'katieskid2010@gmail.com', 'kbrav89@gmail.com', 'kirrinjones@gmail.com',
  'kristellgordillo@gmail.com', 'krystalperezh@gmail.com', 'krystalperezhorta@gmail.com',
  'kyvilla32@gmail.com', 'labradoble@gmail.com', 'lazarohermosilla.b@gmail.com',
  'ldh3644@gmail.com', 'linaibanez@gmail.com', 'linaruiz1128@gmail.com',
  'lorenaguerreroc@gmail.com', 'lubraguim@gmail.com', 'lucas.lanzafame@gmail.com',
  'mafem317@gmail.com', 'malexandra.perez@gmail.com', 'marcos.victorica@gmail.com',
  'maylinacostatello@gmail.com', 'mfernanda0103@gmail.com', 'migdonesmacedo@gmail.com',
  'mlhill@gmail.com', 'mtgomezn@gmail.com', 'mthearak@gmail.com',
  'naved.adeel@gmail.com', 'nbazan30@gmail.com', 'nellypadilla3@gmail.com',
  'oaalvarezc@gmail.com', 'orangel1978@gmail.com', 'oscarprieto.r@gmail.com',
  'ota.cecilia@gmail.com', 'pablo.i.villarreal@gmail.com', 'pabloandres.ramirez@gmail.com',
  'palacios.j.ignacio@gmail.com', 'pfrm25@gmail.com', 'prodriz@gmail.com',
  'quincy.ifill@gmail.com', 'rbmilantonio@gmail.com', 'recordshin@gmail.com',
  'ricardo.limias80@gmail.com', 'rubieldeleon23@gmail.com', 'sakhayaanakriv@gmail.com',
  'santiagormt@gmail.com', 'scottnycknight@gmail.com', 'sergio.colombo82@gmail.com',
  'shaneemorrison@gmail.com', 'shivasthi@gmail.com', 'shmeleva.anastasia@gmail.com',
  'smcivilworks@gmail.com', 'steinbergjenny@gmail.com', 'stephanie.lievano@gmail.com',
  'tatiana.thula@gmail.com', 'valeria.cannavo@gmail.com', 'vane.giurdanella@gmail.com',
  'verodelar@gmail.com', 'veronagel21@gmail.com', 'victorvargas83@gmail.com',
  'willsicot@gmail.com', 'zumeta.j@gmail.com', 'zuzelpaneque@gmail.com',
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
  'flopezmusic@gmail.com', 'foxnavvab@gmail.com', 'francatiso@gmail.com',
  'fuente.espeja@gmail.com', 'ggonzalez.rivera@gmail.com', 'gissellerios@gmail.com',
  'glolaciregui@gmail.com', 'gonzalez.ulises@gmail.com', 'gracepinedar@gmail.com',
  'greciamedinac@gmail.com', 'gyorlenys@gmail.com', 'h18fran@gmail.com',
  'hadarmarkman@gmail.com', 'halfu28@gmail.com', 'hedarfu@gmail.com',
  'hr.forde07@gmail.com', 'ifeelgod2000@gmail.com', 'inversionescha17@gmail.com',
  'irinacastillowelch@gmail.com', 'isabelcqc26@gmail.com', 'isabeldelapenya@gmail.com',
  'isislopez@gmail.com', 'jacemkelly@gmail.com', 'jaemydl12@gmail.com',
  'jaimejmedrano@gmail.com', 'jakeslusser@gmail.com', 'janeth.nicolau@gmail.com',
  'jayronaldhughes@gmail.com', 'jccroston@gmail.com', 'jclargacha@gmail.com',
  'jdavid0327@gmail.com', 'jdefreitas385@gmail.com', 'jenniferroachpty20@gmail.com',
  'jessica.gardiaz@gmail.com', 'jgonzalezgaristo@gmail.com', 'jhulov@gmail.com',
  'jimenapitty@gmail.com', 'jimenasantosperez@gmail.com', 'joaquinmartinez80@gmail.com',
  'johnrosadomeza@gmail.com', 'jonathanvanviegen@gmail.com', 'jorgerojas1984@gmail.com',
  'joseandresdelapena@gmail.com', 'joseleonardo7@gmail.com', 'josere32@gmail.com',
  'jrayvaucher@gmail.com', 'jrchiari6@gmail.com', 'juantomas25@gmail.com',
  'juldia01@gmail.com', 'junelovesjune@gmail.com', 'karencuevasr10@gmail.com',
  'karihuske@gmail.com', 'karinacr0807@gmail.com', 'karoumsanaa99@gmail.com',
  'kathyuj01@gmail.com', 'katko55@gmail.com', 'kcmeikle@gmail.com',
  'kenia.nunez.m@gmail.com', 'keniadagmar12@gmail.com', 'kgcarrillo@gmail.com',
  'kobalet@gmail.com', 'kspana@gmail.com', 'lexie.howison@gmail.com',
];

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM_EMAIL = process.env.FROM_EMAIL || 'Safe Smart Pickup <no-reply@safesmartpickup.com>';
const DRY_RUN = process.env.DRY_RUN === '1';

const SUBJECT = 'Ayúdanos a probar Safe Smart Pickup en Android — antes del lanzamiento';

const TEST_LINK = 'https://play.google.com/store/apps/details?id=com.safesmartpickup.app';

const TEXT_BODY = `Hola,

Antes de publicar oficialmente la app de Safe Smart Pickup para Android, estamos haciendo una prueba con un grupo de padres, y tu correo quedó seleccionado para participar.

Solo te toma un par de minutos. Únete a la prueba aquí:
${TEST_LINK}

Necesitas un teléfono Android y abrir el enlace con la sesión iniciada en tu cuenta de Gmail (la misma con la que estás registrado en Safe Smart Pickup). Google Play te mostrará la opción de unirte como probador; luego solo instalas la app como cualquier otra.

Es una versión de prueba, así que si ves algo raro o tienes cualquier duda mientras la usas, simplemente responde este correo — nos ayuda muchísimo a mejorarla antes de que salga al público.

¡Gracias por tu ayuda!

El equipo de Safe Smart Pickup`;

const HTML_BODY = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:34rem;margin:0 auto;color:#101a2c;line-height:1.6;">
  <p>Hola,</p>
  <p>Antes de publicar oficialmente la app de <strong>Safe Smart Pickup</strong> para Android, estamos haciendo una prueba con un grupo de padres — y tu correo quedó seleccionado para participar.</p>
  <p style="text-align:center;margin:2rem 0;">
    <a href="${TEST_LINK}"
       style="background:#362f97;color:#ffffff;text-decoration:none;font-weight:700;padding:0.9rem 1.6rem;border-radius:0.6rem;display:inline-block;">
      Únete a la prueba
    </a>
  </p>
  <p>Necesitas un teléfono <strong>Android</strong> y abrir el enlace con la sesión iniciada en tu cuenta de <strong>Gmail</strong> (la misma con la que estás registrado en Safe Smart Pickup). Google Play te mostrará la opción de unirte como probador; luego solo instalas la app como cualquier otra.</p>
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
