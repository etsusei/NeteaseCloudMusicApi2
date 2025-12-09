const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

async function listUsers() {
  const client = await pool.connect();
  try {
    const result = await client.query(
      'SELECT id, username, is_admin, created_at FROM users ORDER BY id'
    );

    if (result.rows.length === 0) {
      console.log('No users found');
      return;
    }

    console.log('\n📋 Users:');
    console.log('─'.repeat(60));
    result.rows.forEach(user => {
      const admin = user.is_admin ? ' 👑' : '';
      console.log(`  [${user.id}] ${user.username}${admin} - ${user.created_at.toISOString().split('T')[0]}`);
    });
    console.log('─'.repeat(60));
    console.log(`Total: ${result.rows.length} users\n`);
  } catch (err) {
    console.error('❌ Failed to list users:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

listUsers();
