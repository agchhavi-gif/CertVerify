const pool = require('./index');

const createTables = async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Drop old table if it has the old schema (extra columns from previous version)
    // This checks if any of the old columns exist — if so, drop and recreate clean
    const oldColumnsCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'certificates'
        AND column_name IN ('expiry_date', 'issuer', 'uploaded_by', 'file_path', 'extracted_text', 'is_active')
    `);

    if (oldColumnsCheck.rows.length > 0) {
      console.log('Old schema detected — dropping and recreating certificates table...');
      await client.query('DROP TABLE IF EXISTS certificates CASCADE');
    }

    // Also drop old tables that are no longer needed
    await client.query('DROP TABLE IF EXISTS admins CASCADE');
    await client.query('DROP TABLE IF EXISTS verification_logs CASCADE');

    // Create the clean simplified table
    await client.query(`
      CREATE TABLE IF NOT EXISTS certificates (
        id               SERIAL PRIMARY KEY,
        certificate_id   VARCHAR(100) UNIQUE NOT NULL,
        recipient_name   VARCHAR(255) NOT NULL,
        issue_date       DATE NOT NULL,
        created_at       TIMESTAMP DEFAULT NOW()
      );
    `);

    await client.query('COMMIT');
    console.log('Database ready — certificates table OK');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    throw err;
  } finally {
    client.release();
  }
};

module.exports = createTables;
