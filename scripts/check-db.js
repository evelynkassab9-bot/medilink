const db = require("../db");

function getCount(tableName) {
  return new Promise((resolve, reject) => {
    db.get(`SELECT COUNT(*) AS total FROM ${tableName}`, [], (error, row) => {
      if (error) return reject(error);
      resolve(row?.total || 0);
    });
  });
}

function getLatestPatientCredentials() {
  return new Promise((resolve, reject) => {
    db.get(
      `
      SELECT
        p.id AS patient_row_id,
        p.patient_code,
        u.national_id,
        u.email,
        u.full_name,
        u.password AS user_password,
        p.password AS patient_password,
        p.created_at
      FROM patients p
      LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.id DESC
      LIMIT 1
      `,
      [],
      (error, row) => {
        if (error) return reject(error);
        resolve(row || null);
      }
    );
  });
}

(async () => {
  try {
    const [users, patients, medicalRecords, emergencyNotes, latestPatient] = await Promise.all([
      getCount("users"),
      getCount("patients"),
      getCount("medical_records"),
      getCount("emergency_notes"),
      getLatestPatientCredentials(),
    ]);

    console.log(`Database client: ${String(db.client || "unknown").toUpperCase()}`);
    console.log(`users: ${users}`);
    console.log(`patients: ${patients}`);
    console.log(`medical_records: ${medicalRecords}`);
    console.log(`emergency_notes: ${emergencyNotes}`);

    if (latestPatient) {
      console.log("Latest patient credentials in database:");
      console.log(`- Patient row id: ${latestPatient.patient_row_id}`);
      console.log(`- Patient code: ${latestPatient.patient_code || ""}`);
      console.log(`- National ID: ${latestPatient.national_id || ""}`);
      console.log(`- Email: ${latestPatient.email || ""}`);
      console.log(`- Full name: ${latestPatient.full_name || ""}`);
      console.log(`- users.password: ${latestPatient.user_password || ""}`);
      console.log(`- patients.password: ${latestPatient.patient_password || ""}`);
      console.log(`- Created at: ${latestPatient.created_at || ""}`);
    } else {
      console.log("No patients found yet in the database.");
    }

    console.log("Database connection check passed.");
  } catch (error) {
    console.error("Database connection check failed:", error.message);
    process.exitCode = 1;
  } finally {
    if (typeof db.end === "function") {
      db.end(() => process.exit(process.exitCode || 0));
    }
  }
})();
