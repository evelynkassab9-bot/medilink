const path = require("path");
const mysql = require("mysql2");
const sqlite3 = require("sqlite3").verbose();
require("dotenv").config();

const DB_CLIENT = String(process.env.DB_CLIENT || "mysql").trim().toLowerCase();
const SQLITE_DB_PATH = process.env.SQLITE_DB_PATH
  ? path.resolve(process.env.SQLITE_DB_PATH)
  : path.join(__dirname, "medical_system.db");

function normalizeRunArgs(sql, params, callback) {
  if (typeof params === "function") {
    callback = params;
    params = [];
  }

  if (!Array.isArray(params)) {
    params = [];
  }

  if (typeof callback !== "function") {
    callback = () => {};
  }

  return {
    sql: String(sql || "").trim(),
    params,
    callback,
  };
}

function normalizeMysqlSql(sql) {
  return String(sql || "")
    .replace(/^\s*PRAGMA\s+foreign_keys\s*=\s*ON\s*;?\s*$/i, "SELECT 1")
    .replace(/^\s*BEGIN\s+TRANSACTION\s*;?\s*$/i, "START TRANSACTION")
    .trim();
}

function createSqliteAdapter() {
  const connection = new sqlite3.Database(SQLITE_DB_PATH);
  connection.serialize(() => {
    connection.run("PRAGMA foreign_keys = ON");
  });

  const db = {
    client: "sqlite",
    connection,
    serialize(fn) {
      connection.serialize(() => {
        if (typeof fn === "function") fn();
      });
    },
    run(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.run(args.sql, args.params, function (err) {
        args.callback.call(
          {
            lastID: this?.lastID || 0,
            changes: this?.changes || 0,
          },
          err || null
        );
      });
    },
    get(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.get(args.sql, args.params, (err, row) => args.callback(err || null, row || null));
    },
    all(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.all(args.sql, args.params, (err, rows) => args.callback(err || null, rows || []));
    },
    query(sql, params, callback) {
      return this.all(sql, params, callback);
    },
    end(callback) {
      connection.close(callback);
    },
  };

  return db;
}

function createMysqlAdapter() {
  const connection = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "smart_emergency_medical_system",
    multipleStatements: true,
  });

  connection.connect((err) => {
    if (err) {
      console.error("MySQL connection error:", err.message);
      console.error(
        "Make sure XAMPP MySQL is running, the schema is imported, and the .env MySQL settings are correct."
      );
    } else {
      console.log("Connected to MySQL database.");
    }
  });

  connection.on("error", (error) => {
    console.error("MySQL runtime error:", error.message);
  });

  const db = {
    client: "mysql",
    connection,
    serialize(fn) {
      if (typeof fn === "function") fn();
    },
    run(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.query(normalizeMysqlSql(args.sql), args.params, function (err, result) {
        if (err) {
          return args.callback(err);
        }

        return args.callback.call(
          {
            lastID: result?.insertId || 0,
            changes: result?.affectedRows || 0,
          },
          null
        );
      });
    },
    get(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.query(normalizeMysqlSql(args.sql), args.params, (err, rows) => {
        args.callback(err || null, Array.isArray(rows) ? rows[0] || null : null);
      });
    },
    all(sql, params, callback) {
      const args = normalizeRunArgs(sql, params, callback);
      connection.query(normalizeMysqlSql(args.sql), args.params, (err, rows) => {
        args.callback(err || null, Array.isArray(rows) ? rows : []);
      });
    },
    query(sql, params, callback) {
      return this.all(sql, params, callback);
    },
    end(callback) {
      connection.end(callback);
    },
  };

  return db;
}

const db = DB_CLIENT === "sqlite" ? createSqliteAdapter() : createMysqlAdapter();

function runAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

async function migrateSqlite() {
  const columns = await new Promise((resolve, reject) => {
    db.all("PRAGMA table_info(patients)", [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });

  const hasPasswordColumn = columns.some((column) => column.name === "password");

  if (!hasPasswordColumn) {
    await runAsync("ALTER TABLE patients ADD COLUMN password TEXT");
  }

  await runAsync(`
    CREATE TABLE IF NOT EXISTS patient_vitals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id INTEGER NOT NULL,
      systolic_bp INTEGER,
      diastolic_bp INTEGER,
      heart_rate INTEGER,
      oxygen_saturation REAL,
      temperature_c REAL,
      respiratory_rate INTEGER,
      glucose_mg_dl REAL,
      recorded_by TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await runAsync(
    "CREATE INDEX IF NOT EXISTS idx_patient_vitals_patient_time ON patient_vitals(patient_id, created_at DESC)"
  );

  await runAsync(`
    UPDATE patients
    SET password = (
      SELECT users.password
      FROM users
      WHERE users.id = patients.user_id
    )
    WHERE COALESCE(password, '') = ''
  `);
}

async function migrateMysql() {
  const passwordColumn = await getAsync(
    `
    SELECT COLUMN_NAME
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'patients'
      AND COLUMN_NAME = 'password'
    LIMIT 1
    `
  );

  if (!passwordColumn) {
    await runAsync("ALTER TABLE patients ADD COLUMN password VARCHAR(255) NULL AFTER patient_code");
  }

  await runAsync(`
    CREATE TABLE IF NOT EXISTS patient_vitals (
      id INT AUTO_INCREMENT PRIMARY KEY,
      patient_id INT NOT NULL,
      systolic_bp INT NULL,
      diastolic_bp INT NULL,
      heart_rate INT NULL,
      oxygen_saturation DECIMAL(5,2) NULL,
      temperature_c DECIMAL(4,2) NULL,
      respiratory_rate INT NULL,
      glucose_mg_dl DECIMAL(8,2) NULL,
      recorded_by VARCHAR(255) NULL,
      notes TEXT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_patient_vitals_patient_time (patient_id, created_at)
    )
  `);

  await runAsync(`
    UPDATE patients p
    JOIN users u ON u.id = p.user_id
    SET p.password = u.password
    WHERE p.password IS NULL OR p.password = ''
  `);
}

async function runMigrations() {
  try {
    if (db.client === "mysql") {
      await migrateMysql();
    } else {
      await migrateSqlite();
    }

    console.log(`Database ready using ${db.client.toUpperCase()}.`);
  } catch (error) {
    console.error("Database migration error:", error.message);
  }
}

runMigrations();

module.exports = db;
