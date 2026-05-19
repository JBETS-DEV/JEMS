const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

let pairingCode = null;
let isConnected = false;

// Page d'accueil web pour récupérer votre code de connexion simplement
app.get('/', (req, res) => {
    if (isConnected) {
        return res.send("<h1 style='color:green; text-align:center; font-family:sans-serif;'>✅ JEMS Bot connecté avec succès à votre WhatsApp! ⚽</h1>");
    }
    if (!pairingCode) {
        return res.send("<h1 style='text-align:center; font-family:sans-serif;'>🔄 JEMS génère votre code de connexion... Patientez 10 secondes et rafraîchissez la page.</h1>");
    }
    res.send(`
        <div style="text-align:center; margin-top:60px; font-family:sans-serif; background:#f4f4f9; padding:30px; border-radius:10px; display:inline-block; margin-left:auto; margin-right:auto;">
            <h1 style="color:#25D366;">⚽ Liaison WhatsApp JEMS ⚽</h1>
            <p style="font-size:18px;">Sur votre téléphone : Ouvrez WhatsApp -> Appareils connectés -> Connecter un appareil -> <b>Lier avec le numéro de téléphone</b>.</p>
            <p style="font-size:16px; color:#555;">Entrez ensuite le code suivant :</p>
            <div style="font-size:42px; font-weight:bold; letter-spacing:5px; background:#fff; padding:15px; border:2px dashed #25D366; display:inline-block; margin:20px; color:#333;">
                ${pairingCode}
            </div>
            <br/>
            <small style="color:#888;">Ce code expire rapidement. Rafraîchissez la page si nécessaire.</small>
        </div>
    `);
});

// Vos routes API pour JEMS
app.post('/api/matches/:matchId/generate-teams', async (req, res) => {
    const { matchId } = req.params;
    try {
        const checkedIn = await pool.query(
            `SELECT p.id, p.full_name FROM attendance a JOIN players p ON a.player_id = p.id WHERE a.match_id = $1 AND a.will_attend = true AND p.status = 'Active'`,
            [matchId]
        );
        let playersList = checkedIn.rows;
        for (let i = playersList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playersList[i], playersList[j]] = [playersList[j], playersList[i]];
        }
        let teams = { blues: [], reds: [], yellows: [] };
        if (playersList.length < 18) {
            playersList.forEach((player, index) => {
                if (index % 2 === 0) teams.blues.push(player);
                else teams.reds.push(player);
            });
            delete teams.yellows;
        } else {
            playersList.forEach((player, index) => {
                if (index % 3 === 0) teams.blues.push(player);
                else if (index % 3 === 1) teams.reds.push(player);
                else teams.yellows.push(player);
            });
        }
        await pool.query("UPDATE matches SET teams_generated = $1, status = 'Closed' WHERE id = $2", [JSON.stringify(teams), matchId]);
        res.json({ message: "Teams split successfully!", teams });
    } catch (err) { res.status(500).send("Error"); }
});

// Initialisation et gestion de la connexion WhatsApp
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        mobile: false
    });

    sock.ev.on('creds.update', saveCreds);

    // Demande du code d'association textuel si l'appareil n'est pas encore enregistré
    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Utilisation du numéro de Michael vu sur votre WhatsApp
                pairingCode = await sock.requestPairingCode("16133058730");
                console.log(`>>> CODE D'ASSOCIATION GÉNÉRÉ : ${pairingCode} <<<`);
            } catch (err) {
                console.error("Erreur de génération du code :", err);
            }
        }, 5000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isConnected = false;
            pairingCode = null;
            const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Connexion perdue. Reconnexion automatique :', shouldReconnect);
            if (shouldReconnect) { connectToWhatsApp(); }
        } else if (connection === 'open') {
            isConnected = true;
            pairingCode = null;
            console.log('✅ JEMS Bot connecté avec succès à WhatsApp !');
        }
    });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`JEMS engine running on port ${PORT}`);
    connectToWhatsApp().catch(err => console.error(err));
});
