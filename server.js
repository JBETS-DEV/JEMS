const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const app = express();

let pairingCode = null;

// Route pour afficher le code
app.get('/', (req, res) => {
    if (!pairingCode) return res.send("<h1>Génération du code... Rechargez la page dans 5 secondes.</h1>");
    res.send(`<h1 style="text-align:center;">CODE WHATSAPP: ${pairingCode}</h1>`);
});

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth');
    const sock = makeWASocket({ auth: state });
    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                pairingCode = await sock.requestPairingCode("16133058730");
                console.log("CODE:", pairingCode);
            } catch (e) { console.log("Attente réseau..."); }
        }, 10000);
    }
}

app.listen(10000, () => {
    console.log("Serveur démarré");
    startBot();
});
