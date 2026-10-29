/**
 * Creates the application database if it does not exist yet. Connects to the
 * default postgres database to do it, so this is the one script that does not
 * use the shared pool.
 */
import pg from 'pg';
import env from '../config/env.js';

const { Client } = pg;

async function main() {
  const client = new Client({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'postgres',
    ssl: env.DB_SSL ? { rejectUnauthorized: false } : false,
  });

  await client.connect();
  const { rowCount } = await client.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [env.DB_NAME],
  );

  if (rowCount) {
    console.log('Database "' + env.DB_NAME + '" already exists.');
  } else {
    await client.query('CREATE DATABASE "' + env.DB_NAME + '"');
    console.log('Database "' + env.DB_NAME + '" created.');
  }

  await client.end();
}

main().catch((err) => {
  console.error('Failed to create database:', err.message);
  process.exit(1);
});
