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

app.get('/', (req, res) => {
    if (isConnected) {
        return res.send("<h1 style='color:green; text-align:center; font-family:sans-serif;'>✅ JEMS Bot connecté avec succès à votre WhatsApp! ⚽</h1>");
    }
    if (!pairingCode) {
        return res.send("<h1 style='text-align:center; font-family:sans-serif;'>🔄 JEMS initialise le tunnel sécurisé... Patientez 15 secondes et rafraîchissez la page pour obtenir votre code.</h1>");
    }
    res.send(`
        <div style="text-align:center; margin-top:60px; font-family:sans-serif; background:#f4f4f9; padding:30px; border-radius:10px; display:inline-block; max-width:500px;">
            <h1 style="color:#25D366;">⚽ Liaison WhatsApp JEMS ⚽</h1>
            <p style="font-size:16px; text-align:left;">1. Ouvrez WhatsApp sur votre téléphone.<br/>2. Allez dans <b>Appareils connectés</b> -> <b>Connecter un appareil</b>.<br/>3. Cliquez sur <b>"Lier avec le numéro de téléphone plutôt"</b> en bas.</p>
            <p style="font-size:16px; color:#555; font-weight:bold;">Entrez ce code sur votre téléphone :</p>
            <div style="font-size:42px; font-weight:bold; letter-spacing:5px; background:#fff; padding:15px; border:2px dashed #25D366; display:inline-block; margin:10px; color:#333; border-radius:5px;">
                ${pairingCode}
            </div>
            <br/><br/>
            <small style="color:#aa0000; font-weight:bold;">⚠️ Le code expire après 2 minutes. Rafraîchissez la page si nécessaire.</small>
        </div>
    `);
});

// APIs de tri des équipes
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

app.post('/api/bibs/report-status', async (req, res) => {
    const { playerId, matchId, hasWashed } = req.body;
    try {
        const playerRes = await pool.query("SELECT * FROM players WHERE id = $1", [playerId]);
        const player = playerRes.rows[0];
        if (hasWashed) {
            await pool.query("UPDATE bibs_rotation SET washed_status = 'Washed' WHERE player_id = $1 AND match_id = $2", [playerId, matchId]);
            await pool.query("UPDATE players SET bibs_refusal_streak = 0 WHERE id = $1", [playerId]);
            return res.json({ message: "Rotation cleared." });
        } else {
            const newStreak = player.bibs_refusal_streak + 1;
            await pool.query("UPDATE bibs_rotation SET washed_status = 'Refused' WHERE player_id = $1 AND match_id = $2", [playerId, matchId]);
            await pool.query("UPDATE players SET bibs_refusal_streak = $1 WHERE id = $2", [newStreak, playerId]);
            return res.json({ message: "Infraction logged." });
        }
    } catch (err) { res.status(500).send("Server Error"); }
});

// Connexion WhatsApp avec gestion des blocages d'IP
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        logger: require('pino')({ level: 'silent' }), // Rend le terminal propre
        browser: ["Ubuntu", "Chrome", "110.0.5481.177"] // Simule un navigateur classique pour éviter les blocages
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        setTimeout(async () => {
            try {
                // Numéro d'admin Michael configuré par défaut
                pairingCode = await sock.requestPairingCode("16133058730");
                console.log(`✅ CODE GÉNÉRÉ DISPONIBLE SUR LA PAGE WEB`);
            } catch (err) {
                pairingCode = null;
            }
        }, 8000);
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            isConnected = false;
            pairingCode = null;
            const reason = lastDisconnect?.error?.output?.statusCode;
            // Évite de boucler si WhatsApp rejette l'adresse IP, attend avant de réessayer
            const delay = reason === DisconnectReason.restartRequired ? 1000 : 15000;
            setTimeout(connectToWhatsApp, delay);
        } else if (connection === 'open') {
            isConnected = true;
            pairingCode = null;
            console.log('✅ JEMS Bot connecté à WhatsApp avec succès !');
        }
    });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`JEMS engine listening on port ${PORT}`);
    connectToWhatsApp().catch(err => console.error(err));
});
