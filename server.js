const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// Connects to your Supabase Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Test route to see if it works
app.get('/api/players', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM players');
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).send("Database connection error");
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
