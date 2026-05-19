// ==========================================
// CONTEXTE BOT WHATSAPP (LECTURE AUTOMATIQUE)
// ==========================================
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true // Affiche le QR Code dans les logs Render !
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log("=== SCANNEZ CE QR CODE AVEC VOTRE TELEPHONE ===");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            console.log('Connexion perdue. Reconnexion en cours...');
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('JEMS Bot est connecté avec succès à votre WhatsApp! ⚽');
        }
    });

    // Écoute des messages et des votes du groupe
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            const sender = msg.key.participant || msg.key.remoteJid;

            // Log de test pour voir si le bot entend le groupe "Saturday Soccer"
            if (text) {
                console.log(`Message reçu de ${sender}: ${text}`);
            }
        }
    });
}

// Lancement du bot après le démarrage du serveur express
connectToWhatsApp();
