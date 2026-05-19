const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// 1. RANDOM TEAM GENERATION ALGORITHM (Blues, Reds, Yellows)
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
        
        // Random Shuffle (Fisher-Yates)
        for (let i = playersList.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [playersList[i], playersList[j]] = [playersList[j], playersList[i]];
        }

        let teams = { blues: [], reds: [], yellows: [] };
        const totalPlayers = playersList.length;

        // Rule: Less than 18 players = Only 2 teams. Otherwise 3 teams.
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

// 2. BIBS ROTATION & DISCIPLINARY SYSTEM
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

            const checkMajor = await pool.query("SELECT major_sanctions_count FROM players WHERE id = $1", [playerId]);
            if (checkMajor.rows[0].major_sanctions_count >= 2) {
                await pool.query("UPDATE players SET status = 'Excluded' WHERE id = $1", [playerId]);
                punishment = "CRITICAL: 2 Major Sanctions reached. Permanent Exclusion enforced.";
            }

            return res.json({ message: "Infraction logged.", punishment });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send("Server Error processing JEMS ruleset");
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`JEMS core engine humming on port ${PORT}`));
