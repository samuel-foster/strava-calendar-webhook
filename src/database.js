const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DB_PATH || './data/sync.db';

let db = null;

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database initialization error:', err);
        reject(err);
      } else {
        console.log('Connected to SQLite database at', DB_PATH);
        createTables();
        resolve(db);
      }
    });
  });
}

function createTables() {
  // State table: tracks last synced activity
  db.run(`
    CREATE TABLE IF NOT EXISTS state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('Error creating state table:', err);
    } else {
      console.log('State table ready');
      // Initialize state record after table is created
      db.run(`
        INSERT OR IGNORE INTO state (key, value)
        VALUES ('last_activity_id', '0'), ('last_webhook_id', '0')
      `, (err) => {
        if (err) console.error('Error initializing state:', err);
        else console.log('State records initialized');
      });
    }
  });

  // Sync log table: audit trail
  db.run(`
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      activity_id TEXT,
      activity_name TEXT,
      status TEXT,
      calendar_event_id TEXT,
      error_message TEXT,
      sync_source TEXT
    )
  `, (err) => {
    if (err) console.error('Error creating sync_log table:', err);
    else console.log('Sync log table ready');
  });
}

// Get last synced activity ID
function getLastActivityId() {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT value FROM state WHERE key = 'last_activity_id'",
      (err, row) => {
        if (err) reject(err);
        else resolve(row ? row.value : '0');
      }
    );
  });
}

// Update last synced activity ID
function updateLastActivityId(activityId) {
  return new Promise((resolve, reject) => {
    db.run(
      "UPDATE state SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'last_activity_id'",
      [activityId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// Log a sync attempt
function logSync(activityId, activityName, status, calendarEventId = null, errorMessage = null, source = 'webhook') {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO sync_log (activity_id, activity_name, status, calendar_event_id, error_message, sync_source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [activityId, activityName, status, calendarEventId, errorMessage, source],
      function(err) {
        if (err) {
          console.error('Error logging sync:', err);
          reject(err);
        } else {
          resolve(this.lastID);
        }
      }
    );
  });
}

// Get recent syncs for audit
function getRecentSyncs(limit = 50) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM sync_log ORDER BY timestamp DESC LIMIT ?`,
      [limit],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

// Close database
function closeDatabase() {
  return new Promise((resolve, reject) => {
    if (db) {
      db.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      resolve();
    }
  });
}

module.exports = {
  initDatabase,
  getLastActivityId,
  updateLastActivityId,
  logSync,
  getRecentSyncs,
  closeDatabase,
};
