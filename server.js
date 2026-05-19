const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// =========================================================================
// 1. ALGORITHME DE GÉNÉRATION DES ÉQUIPES (Blues, Reds, Yellows)
// =========================================================================
app.post('/api/matches/:matchId/generate-teams', async (req, res) => {
    const { matchId } = req.params;
    try {
        const checkedIn = await pool.query(
            `SELECT p.id, p.full_name FROM attendance a 
             JOIN players p ON a.player_id = p.id 
             WHERE a.match_id = $1 AND a.will_attend = true AND p.status = 'Active'`,
            [matchId]
        );

        let playersList = checkedIn.rows;
        
        for (let i = playersList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playersList[i], playersList[j]] = [playersList[j], playersList[i]];
        }

        let teams = { blues: [], reds: [], yellows: [] };
        const totalPlayers = playersList.length;

        if (totalPlayers < 18) {
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

        await pool.query(
            "UPDATE matches SET teams_generated = $1, status = 'Closed' WHERE id = $2",
            [JSON.stringify(teams), matchId]
        );

        res.json({ message: "Teams split successfully!", teams });
    } catch (err) {
        console.error(err);
        res.status(500).send("Error generating random teams");
    }
});

// =========================================================================
// 2. SYSTÈME DISCIPLINAIRE ET ROTATION DES CHASUBLES
// =========================================================================
app.post('/api/bibs/report-status', async (req, res) => {
    const { playerId, matchId, hasWashed } = req.body;

    try {
        const playerRes = await pool.query("SELECT * FROM players WHERE id = $1", [playerId]);
        const player = playerRes.rows[0];

        if (hasWashed) {
            await pool.query("UPDATE bibs_rotation SET washed_status = 'Washed' WHERE player_id = $1 AND match_id = $2", [playerId, matchId]);
            await pool.query("UPDATE players SET bibs_refusal_streak = 0 WHERE id = $1", [playerId]);
            return res.json({ message: "Rotation cleared. Streak reset." });
        } else {
            const newStreak = player.bibs_refusal_streak + 1;
            await pool.query("UPDATE bibs_rotation SET washed_status = 'Refused' WHERE player_id = $1 AND match_id = $2", [playerId, matchId]);
            await pool.query("UPDATE players SET bibs_refusal_streak = $1 WHERE id = $2", [newStreak, playerId]);

            let punishment = "";

            if (newStreak === 1) {
                await pool.query("INSERT INTO sanctions (player_id, match_id, type, severity) VALUES ($1, $2, 'Bibs Refusal', 'Minor ($15)')", [playerId, matchId]);
                punishment = "$15 Fine issued. Player assigned next Saturday dynamically.";
            } else if (newStreak === 2) {
                await pool.query("INSERT INTO sanctions (player_id, match_id, type, severity) VALUES ($1, $2, 'Bibs Refusal', 'Medium ($15 + 1 Match)')", [playerId, matchId]);
                await pool.query("UPDATE players SET status = 'Suspended' WHERE id = $1", [playerId]);
                punishment = "$15 Fine + 1 Match Suspension. Shifted rotation.";
            } else if (newStreak === 3) {
                await pool.query("INSERT INTO sanctions (player_id, match_id, type, severity) VALUES ($1, $2, 'Bibs Refusal', 'Major ($15 + 3 Matches)')", [playerId, matchId]);
                await pool.query("UPDATE players SET status = 'Suspended', major_sanctions_count = major_sanctions_count + 1 WHERE id = $1", [playerId]);
                punishment = "$15 Fine + 3 Matches Suspension. (Final Warning Alert)";
            } else if (newStreak >= 4) {
                await pool.query("UPDATE players SET status = 'Excluded' WHERE id = $1", [playerId]);
                punishment = "CRITICAL: Player permanently excluded from the roster.";
            }

            return res.json({ message: "Infraction logged.", punishment });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error processing JEMS ruleset");
    }
});

// =========================================================================
// 3. MOTEUR WHATSAPP EN LECTURE TEMPS RÉEL
// =========================================================================
async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('/tmp/auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, qr } = update;
        if (qr) {
            console.log("=================================================");
            console.log("👉 SCANNEZ CE QR CODE AVEC VOTRE TELEPHONE WHATSAPP :");
            console.log("=================================================");
            qrcode.generate(qr, { small: true });
        }
        if (connection === 'close') {
            console.log('Connexion interrompue. Relancement du bot JEMS...');
            connectToWhatsApp();
        } else if (connection === 'open') {
            console.log('✅ JEMS Bot connecté avec succès à votre WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message) {
            const text = msg.message.conversation || msg.message.extendedTextMessage?.text;
            const sender = msg.key.participant || msg.key.remoteJid;
            if (text) {
                console.log(`[WhatsApp Sync] Message de ${sender}: ${text}`);
            }
        }
    });
}

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`JEMS core engine humming on port ${PORT}`);
    connectToWhatsApp().catch(err => console.error("Erreur lancement Bot WhatsApp:", err));
});
