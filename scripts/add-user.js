const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function addUser(username, password, isAdmin = false) {
  if (!username || !password) {
    console.error('Usage: node add-user.js <username> <password> [--admin]');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    // Check if user exists
    const existing = await client.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
      console.error(`❌ User "${username}" already exists`);
      process.exit(1);
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Insert user
    const result = await client.query(
      'INSERT INTO users (username, password, is_admin) VALUES ($1, $2, $3) RETURNING id',
      [username, passwordHash, isAdmin]
    );

    console.log(`✅ User "${username}" created successfully (ID: ${result.rows[0].id})`);
    if (isAdmin) {
      console.log('   👑 Admin privileges granted');
    }
  } catch (err) {
    console.error('❌ Failed to add user:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

// Parse arguments
const args = process.argv.slice(2);
const isAdmin = args.includes('--admin');
const filteredArgs = args.filter(a => a !== '--admin');
const [username, password] = filteredArgs;

addUser(username, password, isAdmin);
