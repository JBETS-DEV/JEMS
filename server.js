const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCodeNet = require('qrcode'); // Changement pour affichage web dynamique

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

let latestQr = null;
let isConnected = false;

// Page d'accueil pour scanner le QR Code directement sur le web !
app.get('/', async (req, res) => {
    if (isConnected) {
        return res.send("<h1>✅ JEMS Bot connecté avec succès à votre WhatsApp! ⚽</h1>");
    }
    if (!latestQr) {
        return res.send("<h1>🔄 Le QR Code est en cours de génération... Rafraîchissez dans 10 secondes.</h1>");
    }
    try {
        const qrImage = await QRCodeNet.toDataURL(latestQr);
        res.send(`
            <div style="text-align:center; margin-top:50px; font-family:sans-serif;">
                <h1>⚽ Scannez ce QR Code avec WhatsApp ⚽</h1>
                <p>Option : Appareils connectés -> Connecter un appareil</p>
                <img src="${qrImage}" style="width:300px; border:1px solid #ccc; padding:10px;"/>
                <br/><br/>
                <small>Actualisation automatique si nécessaire</small>
            </div>
        `);
    } catch (err) {
        res.status(500).send("Erreur d'affichage du QR Code");
    }
});

// Vos routes API existantes pour JEMS
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
    } catch (err) { res.status(500).send("Error generating random teams"); }
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
            return res.json({ message: "Infraction logged. Streak upgraded." });
        }
    } catch (err) { res.status(500).send("Server Error"); }
});

// Connexion WhatsApp Web
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');
    const sock = makeWASocket({ auth: state });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) { latestQr = qr; } // On capture le QR code pour notre page web
        if (connection === 'close') {
            isConnected = false;
            connectToWhatsApp();
        } else if (connection === 'open') {
            isConnected = true;
            latestQr = null;
            console.log('✅ JEMS Bot connecté avec succès !');
        }
    });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`JEMS engine live on port ${PORT}`);
    connectToWhatsApp().catch(err => console.error(err));
});
