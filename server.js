const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const session = require("express-session");
const db = require("./db");
const QRCode = require("qrcode");
const { buildClinicalInsights } = require("./services/clinical-insights");
const { createAssistantReply } = require("./services/app-chatbot");
const { startNgrok } = require("./scripts/ngrok");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SESSION_SECRET = process.env.SESSION_SECRET || "super_secret_project_key";
const DEFAULT_VITALS_LIMIT = 12;

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: "6mb" }));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  })
);

app.use((req, res, next) => {
  res.locals.currentStaff = req.session.staffUser || null;
  res.locals.currentPatient = req.session.patientAccess || null;
  res.locals.currentPatientUser = req.session.patientUser || null;
  res.locals.currentUser = req.session.staffUser || req.session.patientUser || null;
  res.locals.isPatientSelfAccess = Boolean(req.session.patientUser);
  res.locals.isAppClient = req.session.clientMode === "app";
  next();
});

// ─────────────────────────────────────────────────────────────
// View Engine / Static Files
// ─────────────────────────────────────────────────────────────
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));

// Optional startup view check
function verifyViewsExist() {
  const expectedViews = [
    "edit-patient.ejs",
    "family-links.ejs",
    "login.ejs",
    "patient-access.ejs",
    "patient-login.ejs",
    "patient-portal.ejs",
    "patient-qr.ejs",
    "register-patient.ejs",
    "risk-assessment.ejs",
    "room-view.ejs",
    "scan-qr.ejs",
  ];

  const viewsDir = path.join(__dirname, "views");
  const missing = expectedViews.filter((file) => !fs.existsSync(path.join(viewsDir, file)));

  if (missing.length > 0) {
    console.warn("\n⚠ Missing view files:");
    missing.forEach((file) => console.warn(` - ${file}`));
    console.warn("");
  } else {
    console.log("All expected view files were found.");
  }
}

verifyViewsExist();

// ─────────────────────────────────────────────────────────────
// Middleware
// ─────────────────────────────────────────────────────────────
function requireStaff(req, res, next) {
  if (!req.session.staffUser) return res.redirect("/login");
  next();
}

function getPatientEntryRoute(req) {
  if (req.session.staffUser) {
    return "/patient-access";
  }

  return "/login";
}

function requirePatientAccess(req, res, next) {
  const hasPatientSession = Boolean(req.session.patientAccess);

  if (hasPatientSession) {
    return next();
  }

  return res.redirect(getPatientEntryRoute(req));
}

function renderRegisterPatientPage(
  res,
  error = null,
  success = null,
  formData = {},
  generatedCredentials = null
) {
  res.render("register-patient.ejs", {
    title: "Register Patient",
    error,
    success,
    formData,
    generatedCredentials,
  });
}

function formatDateForInput(dateValue) {
  if (!dateValue) return "";

  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return "";

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function renderEditPatientPage(res, patient, error = null, success = null) {
  res.render("edit-patient.ejs", {
    title: `Edit Patient — ${patient.patient_code || ""}`,
    patient,
    formattedDob: formatDateForInput(patient.date_of_birth),
    error,
    success,
  });
}

// ─────────────────────────────────────────────────────────────
// Utility Helpers
// ─────────────────────────────────────────────────────────────
const PASSWORD_CHARSETS = {
  uppercase: "ABCDEFGHJKLMNPQRSTUVWXYZ",
  lowercase: "abcdefghijkmnopqrstuvwxyz",
};

function getSecureRandomInt(max) {
  return crypto.randomInt(0, max);
}

function getRandomCharacter(characters) {
  return characters[getSecureRandomInt(characters.length)];
}

function getPasswordPrefix(accountType = "patient", seedValue = "") {
  const cleanedSeed = String(seedValue || "").replace(/[^A-Za-z]/g, "");
  const identityLetter = cleanedSeed
    ? cleanedSeed.charAt(0).toUpperCase()
    : getRandomCharacter(PASSWORD_CHARSETS.uppercase);

  switch (String(accountType || "patient").toLowerCase()) {
    case "doctor":
      return `Dr${identityLetter}`;
    case "nurse":
      return `Nr${identityLetter}`;
    case "admin":
      return `Ad${identityLetter}`;
    case "staff":
      return `St${identityLetter}`;
    case "patient":
    default:
      return `Pt${identityLetter}`;
  }
}

function generateStructuredPassword(accountType = "patient", seedValue = "") {
  const prefix = getPasswordPrefix(accountType, seedValue);
  const numericBlock = String(getSecureRandomInt(10000)).padStart(4, "0");
  const lowercaseLetter = getRandomCharacter(PASSWORD_CHARSETS.lowercase);
  const uppercaseLetter = getRandomCharacter(PASSWORD_CHARSETS.uppercase);

  return `${prefix}#${numericBlock}${lowercaseLetter}${uppercaseLetter}`;
}

function buildGeneratedPatientNationalId(sequenceNumber) {
  const normalizedSequence = Number(sequenceNumber) > 0 ? Number(sequenceNumber) : 1;
  return `PAT${String(1000 + normalizedSequence)}`;
}

function normalizeLebanesePhone(phoneValue, { required = false, label = "Phone number" } = {}) {
  const rawValue = String(phoneValue || "").trim();

  if (!rawValue) {
    return {
      value: "",
      error: required ? `${label} is required.` : null,
    };
  }

  if (!/^[+\d\s()-]+$/.test(rawValue)) {
    return {
      value: rawValue,
      error: `${label} must contain only digits and the + symbol.`,
    };
  }

  let digits = rawValue.replace(/\D/g, "");

  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  if (digits.startsWith("961")) {
    digits = digits.slice(3);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (!/^\d{7,8}$/.test(digits)) {
    return {
      value: rawValue,
      error: `${label} must be a valid Lebanese number in the format +961XXXXXXXX.`,
    };
  }

  return {
    value: `+961${digits}`,
    error: null,
  };
}

async function comparePassword(plainPassword, storedPassword) {
  if (!plainPassword || !storedPassword) {
    return false;
  }

  return String(plainPassword) === String(storedPassword);
}

async function hashPassword(plainPassword) {
  return String(plainPassword || "");
}

function setPatientAccessSession(req, patient, options = {}) {
  req.session.patientAccess = {
    id: patient.id,
    user_id: patient.user_id,
    patient_code: patient.patient_code,
    full_name: `${patient.first_name} ${patient.last_name}`.trim(),
    access_mode: options.access_mode || "staff-supervised",
  };
}

function clearPatientAccessSession(req) {
  delete req.session.patientAccess;
  delete req.session.patientUser;
}

function renderPatientLoginPage(req, res, error = null) {
  const isAppClient = req.session.clientMode === "app";

  res.render(isAppClient ? "app-patient-login.ejs" : "patient-login.ejs", {
    title: isAppClient ? "MediLink Patient App Login" : "Patient Login",
    error,
  });
}

function renderStaffLoginPage(res, error = null, notice = null) {
  res.render("login.ejs", {
    title: "Staff Sign In",
    error,
    notice,
  });
}

function authenticateStaffLogin(req, res) {
  const identifier = normalizeLookupValue(req.body.identifier);
  const password = normalizeLookupValue(req.body.password);

  if (!identifier || !password) {
    return renderStaffLoginPage(res, "Please fill in all fields.");
  }

  db.get(
    `
    SELECT id, full_name, email, national_id, role, password
    FROM users
    WHERE role IN ('staff', 'admin')
      AND (
        LOWER(COALESCE(email, '')) = LOWER(?)
        OR UPPER(COALESCE(national_id, '')) = UPPER(?)
      )
    LIMIT 1
    `,
    [identifier, identifier],
    async (err, staffUser) => {
      if (err) {
        console.error(err.message);
        return renderStaffLoginPage(res, "Database error. Please try again.");
      }

      const isValidStaffPassword = staffUser ? await comparePassword(password, staffUser.password) : false;

      if (!staffUser || !isValidStaffPassword) {
        return renderStaffLoginPage(res, "Invalid staff email, ID, or password.");
      }

      clearPatientAccessSession(req);
      delete req.session.patientUser;
      delete req.session.clientMode;

      req.session.staffUser = {
        id: staffUser.id,
        full_name: staffUser.full_name,
        email: staffUser.email,
        national_id: staffUser.national_id,
        role: staffUser.role,
      };

      logAuditEvent({
        req,
        actor_name: req.session.staffUser.full_name,
        actor_role: req.session.staffUser.role,
        patient_code: "",
        action_type: "STAFF_LOGIN",
        access_channel: "web",
        details: `Staff logged in using identifier: ${identifier}`,
      });

      return res.redirect("/patient-access");
    }
  );
}

function authenticatePatientLogin(req, res) {
  const identifier = normalizeLookupValue(req.body.identifier);
  const password = normalizeLookupValue(req.body.password);

  if (!identifier || !password) {
    return renderPatientLoginPage(req, res, "Please fill in all fields.");
  }

  db.get(
    `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.national_id,
      u.role,
      p.id AS patient_id,
      p.patient_code,
      p.first_name,
      p.last_name,
      COALESCE(NULLIF(p.password, ''), u.password) AS patient_password
    FROM users u
    JOIN patients p ON p.user_id = u.id
    WHERE u.role = 'patient'
      AND (
        UPPER(COALESCE(p.patient_code, '')) = UPPER(?)
        OR UPPER(COALESCE(u.national_id, '')) = UPPER(?)
      )
    LIMIT 1
    `,
    [identifier, identifier],
    async (err, patientUser) => {
      if (err) {
        console.error(err.message);
        return renderPatientLoginPage(req, res, "Database error. Please try again.");
      }

      const isValidPatientPassword = patientUser
        ? await comparePassword(password, patientUser.patient_password)
        : false;

      if (!patientUser || !isValidPatientPassword) {
        return renderPatientLoginPage(req, res, "Invalid patient ID or password.");
      }

      delete req.session.staffUser;
      clearPatientAccessSession(req);

      req.session.patientUser = {
        id: patientUser.id,
        full_name: patientUser.full_name || `${patientUser.first_name || ""} ${patientUser.last_name || ""}`.trim(),
        email: patientUser.email,
        national_id: patientUser.national_id,
        role: patientUser.role,
      };

      setPatientAccessSession(
        req,
        {
          id: patientUser.patient_id,
          user_id: patientUser.id,
          patient_code: patientUser.patient_code,
          first_name: patientUser.first_name,
          last_name: patientUser.last_name,
        },
        { access_mode: "self-service" }
      );

      logAuditEvent({
        req,
        actor_name: req.session.patientUser.full_name,
        actor_role: "patient",
        patient_code: patientUser.patient_code,
        action_type: "PATIENT_LOGIN_SELF_SERVICE",
        access_channel: "patient-portal",
        details: `Patient logged in using identifier: ${identifier}`,
      });

      res.redirect(`/patient-portal/${patientUser.patient_code}`);
    }
  );
}

function requireNoActivePatientSession(req, res, next) {
  if (!req.session.patientAccess) {
    return next();
  }

  return res.redirect("/dashboard?notice=active-session-lock");
}

function enforceSessionPatientMatch(req, res, next) {
  const sessionPatientCode = req.session.patientAccess?.patient_code;
  const requestedPatientCode = String(req.params.patientCode || "").trim();

  if (!sessionPatientCode || !requestedPatientCode || requestedPatientCode === sessionPatientCode) {
    return next();
  }

  if (req.session.staffUser) {
    return res.redirect("/dashboard?notice=active-session-lock");
  }

  if (sessionPatientCode) {
    return res.redirect(`/patient-portal/${encodeURIComponent(sessionPatientCode)}`);
  }

  return res.redirect("/login");
}

function normalizeLookupValue(value) {
  return String(value || "").trim();
}

function normalizePatientCode(value) {
  return normalizeLookupValue(value).toUpperCase();
}

function parseQrPayload(qrValue, type = "patient") {
  const raw = normalizeLookupValue(qrValue).replace(/[\x00-\x1F\x7F]+/g, "");
  if (!raw) return "";

  const extractPatientCode = (value) => {
    const text = normalizeLookupValue(value);
    if (!text) return "";

    const fullUrlMatch = text.match(/https?:\/\/[^\s]+/i);
    const candidate = fullUrlMatch ? fullUrlMatch[0] : text;

    try {
      const parsed = new URL(candidate);
      const path = decodeURIComponent(parsed.pathname || "").trim();
      const routeMatchers = [
        /\/patient-qr-login\/([^/?#]+)/i,
        /\/patient-portal\/([^/?#]+)/i,
        /\/patient-qr\/([^/?#]+)/i,
        /\/emergency\/([^/?#]+)/i,
        /\/room-view\/([^/?#]+)/i,
      ];

      for (const matcher of routeMatchers) {
        const match = path.match(matcher);
        if (match && match[1]) {
          return normalizePatientCode(match[1]);
        }
      }

      const queryCode =
        parsed.searchParams.get("patientCode") ||
        parsed.searchParams.get("patient_code") ||
        parsed.searchParams.get("code");
      if (queryCode) {
        return normalizePatientCode(queryCode);
      }
    } catch (_) {
      // Not a fully qualified URL, continue with plain-text patterns.
    }

    const prefixedPatterns = [
      /^PATIENT:([^/?#]+)$/i,
      /^PATIENT_CODE:([^/?#]+)$/i,
      /^QR:([^/?#]+)$/i,
      /^CODE:([^/?#]+)$/i,
      /patient-qr-login\/([^/?#]+)/i,
      /patient-portal\/([^/?#]+)/i,
      /patient-qr\/([^/?#]+)/i,
      /emergency\/([^/?#]+)/i,
      /room-view\/([^/?#]+)/i,
    ];

    for (const pattern of prefixedPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return normalizePatientCode(match[1]);
      }
    }

    if (/^P-\d+$/i.test(text)) {
      return normalizePatientCode(text);
    }

    return "";
  };

  if (type === "patient") {
    const patientCode = extractPatientCode(raw);
    return patientCode || normalizePatientCode(raw);
  }

  return raw;
}

// ─────────────────────────────────────────────────────────────
// Audit Log Helper
// ─────────────────────────────────────────────────────────────
function logAuditEvent({
  req = null,
  actor_name = "Public/Unauthenticated",
  actor_role = "public",
  patient_code = "",
  action_type = "",
  access_channel = "web",
  details = "",
}) {
  const ipAddress =
    req?.headers?.["x-forwarded-for"] ||
    req?.socket?.remoteAddress ||
    req?.ip ||
    "";

  db.run(
    `
    INSERT INTO audit_logs (
      actor_name,
      actor_role,
      patient_code,
      action_type,
      access_channel,
      details,
      ip_address
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [actor_name, actor_role, patient_code, action_type, access_channel, details, ipAddress],
    (err) => {
      if (err) {
        console.error("Audit log error:", err.message);
      }
    }
  );
}

// ─────────────────────────────────────────────────────────────
// QR Helpers
// ─────────────────────────────────────────────────────────────
async function generateAndSaveQR(patientCode) {
  const qrPayload = `PATIENT:${patientCode}`;
  const qrDir = path.join(__dirname, "public", "qrcodes");
  const filePath = path.join(qrDir, `${patientCode}.png`);

  if (!fs.existsSync(qrDir)) {
    fs.mkdirSync(qrDir, { recursive: true });
  }

  await QRCode.toFile(filePath, qrPayload, {
    width: 300,
    margin: 2,
    color: { dark: "#0b5ed7", light: "#ffffff" },
  });

  const qrWebPath = `/qrcodes/${patientCode}.png`;

  return new Promise((resolve, reject) => {
    db.run(
      `UPDATE patients SET qr_code = ? WHERE patient_code = ?`,
      [qrWebPath, patientCode],
      (err) => {
        if (err) return reject(err);
        resolve(qrWebPath);
      }
    );
  });
}

// ─────────────────────────────────────────────────────────────
// Relationship Helpers
// ─────────────────────────────────────────────────────────────
function reverseRelationship(relationship, memberGender = "") {
  const gender = (memberGender || "").toLowerCase();

  switch ((relationship || "").toLowerCase()) {
    case "father":
    case "mother":
      return gender === "female" ? "Daughter" : "Son";
    case "son":
      return gender === "female" ? "Mother" : "Father";
    case "daughter":
      return gender === "female" ? "Mother" : "Father";
    case "brother":
      return gender === "female" ? "Sister" : "Brother";
    case "sister":
      return gender === "female" ? "Sister" : "Brother";
    case "husband":
      return "Wife";
    case "wife":
      return "Husband";
    case "grandfather":
    case "grandmother":
      return gender === "female" ? "Granddaughter" : "Grandson";
    case "grandson":
      return gender === "female" ? "Grandmother" : "Grandfather";
    case "granddaughter":
      return gender === "female" ? "Grandmother" : "Grandfather";
    case "uncle":
    case "aunt":
      return gender === "female" ? "Niece" : "Nephew";
    case "nephew":
      return gender === "female" ? "Aunt" : "Uncle";
    case "niece":
      return gender === "female" ? "Aunt" : "Uncle";
    case "cousin":
      return "Cousin";
    default:
      return relationship || "Other";
  }
}

function getDisplayRelationship(relationship, direction, memberGender) {
  if (direction === "incoming") {
    return reverseRelationship(relationship, memberGender);
  }
  return relationship || "Other";
}

function getRelationshipWeight(relationship) {
  const rel = (relationship || "").toLowerCase();

  if (["father", "mother", "brother", "sister", "son", "daughter"].includes(rel)) {
    return 3;
  }

  if (
    [
      "grandfather",
      "grandmother",
      "grandson",
      "granddaughter",
      "uncle",
      "aunt",
      "nephew",
      "niece",
    ].includes(rel)
  ) {
    return 2;
  }

  if (["cousin"].includes(rel)) {
    return 1;
  }

  return 0;
}

// ─────────────────────────────────────────────────────────────
// Risk Assessment Helpers
// ─────────────────────────────────────────────────────────────
function normalizeText(text) {
  return (text || "").toString().trim().toLowerCase();
}

function buildRiskAssessment(patient, familyMembers) {
  const rules = [
    {
      name: "Hypertension",
      keywords: ["hypertension", "high blood pressure"],
      recommendation: "Monitor blood pressure regularly and review cardiovascular history.",
    },
    {
      name: "Diabetes",
      keywords: ["diabetes", "blood sugar", "diabetic"],
      recommendation: "Monitor glucose levels and review endocrine/metabolic risk.",
    },
    {
      name: "Heart Disease",
      keywords: ["heart disease", "cardiac", "coronary", "heart failure", "arrhythmia"],
      recommendation: "Review cardiac history and consider cardiovascular screening.",
    },
    {
      name: "Asthma",
      keywords: ["asthma", "respiratory allergy", "bronchospasm"],
      recommendation: "Review respiratory history and inhaler/allergy needs.",
    },
    {
      name: "Stroke",
      keywords: ["stroke", "cerebrovascular"],
      recommendation: "Assess neurological history and vascular risk factors.",
    },
    {
      name: "Cancer",
      keywords: ["cancer", "tumor", "oncology", "breast cancer", "colon cancer"],
      recommendation: "Review hereditary cancer history and screening needs.",
    },
    {
      name: "Kidney Disease",
      keywords: ["kidney disease", "renal", "kidney failure", "chronic kidney disease"],
      recommendation: "Review renal history and monitor kidney-related indicators.",
    },
  ];

  const patientMedicalText = normalizeText(
    [
      patient?.diagnosis,
      patient?.chronic_conditions,
      patient?.risk_flags,
      patient?.emergency_summary,
      patient?.notes,
    ].join(" ")
  );

  const alerts = [];

  rules.forEach((rule) => {
    const matchedRelatives = [];

    (familyMembers || []).forEach((member) => {
      const memberText = normalizeText(
        [
          member.diagnosis,
          member.chronic_conditions,
          member.risk_flags,
          member.emergency_summary,
          member.notes,
        ].join(" ")
      );

      const hasMatch = rule.keywords.some((keyword) => memberText.includes(keyword));

      if (hasMatch) {
        matchedRelatives.push({
          patient_code: member.patient_code,
          full_name: `${member.first_name} ${member.last_name}`,
          relationship: member.display_relationship || member.relationship || "Relative",
          weight: getRelationshipWeight(member.display_relationship || member.relationship),
          evidence: member.risk_flags || member.chronic_conditions || member.diagnosis || rule.name,
        });
      }
    });

    if (matchedRelatives.length > 0) {
      const totalWeight = matchedRelatives.reduce((sum, relative) => sum + relative.weight, 0);
      const firstDegreeCount = matchedRelatives.filter((r) => r.weight === 3).length;
      const patientAlreadyHasCondition = rule.keywords.some((keyword) =>
        patientMedicalText.includes(keyword)
      );

      let level = "low";

      if (firstDegreeCount >= 1 || totalWeight >= 4) {
        level = "high";
      } else if (matchedRelatives.length >= 2 || totalWeight >= 2) {
        level = "medium";
      }

      const evidenceText = matchedRelatives
        .map((r) => `${r.relationship}: ${r.full_name} (${r.patient_code})`)
        .join(", ");

      let summary = `Family history suggests inherited risk for ${rule.name}.`;
      if (level === "high") {
        summary = `Strong family history suggests elevated inherited risk for ${rule.name}.`;
      } else if (level === "medium") {
        summary = `Moderate family history suggests possible inherited risk for ${rule.name}.`;
      }

      if (patientAlreadyHasCondition) {
        summary += ` The patient already shows related clinical indicators, which strengthens the family-linked pattern.`;
      }

      alerts.push({
        condition: rule.name,
        level,
        relative_count: matchedRelatives.length,
        summary,
        recommendation: rule.recommendation,
        evidence_text: evidenceText,
        matched_relatives: matchedRelatives,
      });
    }
  });

  const levelRank = { low: 1, medium: 2, high: 3 };

  const highestLevel =
    alerts.length > 0
      ? alerts.reduce(
          (highest, alert) =>
            levelRank[alert.level] > levelRank[highest] ? alert.level : highest,
          "low"
        )
      : "none";

  const hereditaryScore = alerts.reduce((score, alert) => {
    if (alert.level === "high") return score + 3;
    if (alert.level === "medium") return score + 2;
    return score + 1;
  }, 0);

  let overview = "No strong inherited risk pattern detected from linked family members.";
  if (alerts.length > 0) {
    overview = `The system identified ${alerts.length} inherited risk alert(s) based on linked family history.`;
  }

  return {
    overview,
    alert_count: alerts.length,
    highest_level: highestLevel,
    hereditary_score: hereditaryScore,
    alerts,
  };
}

// ─────────────────────────────────────────────────────────────
// Async DB Helpers / Vitals / Analytics
// ─────────────────────────────────────────────────────────────
function dbGetAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row || null);
    });
  });
}

function dbAllAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

function dbRunAsync(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function getFullNameSql(alias = "p") {
  if (db.client === "mysql") {
    return `TRIM(CONCAT(COALESCE(${alias}.first_name, ''), ' ', COALESCE(${alias}.last_name, '')))`;
  }

  return `TRIM(COALESCE(${alias}.first_name, '') || ' ' || COALESCE(${alias}.last_name, ''))`;
}

function splitClinicalTerms(value) {
  return String(value || "")
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.toLowerCase());
}

function countTerms(values = []) {
  const counts = new Map();

  values.forEach((value) => {
    splitClinicalTerms(value).forEach((term) => {
      counts.set(term, (counts.get(term) || 0) + 1);
    });
  });

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([label, value]) => ({
      label: label.replace(/\b\w/g, (match) => match.toUpperCase()),
      value,
    }));
}

function buildLocationLinks(patientData) {
  const address = String(patientData?.address || "").trim();
  if (!address) {
    return {
      patient_address_lookup: null,
      nearby_hospitals: null,
    };
  }

  return {
    patient_address_lookup: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
    nearby_hospitals: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`hospitals near ${address}`)}`,
  };
}

function getPatientVitals(patientId, limit = DEFAULT_VITALS_LIMIT, callback) {
  const sql = `
    SELECT
      id,
      patient_id,
      systolic_bp,
      diastolic_bp,
      heart_rate,
      oxygen_saturation,
      temperature_c,
      respiratory_rate,
      glucose_mg_dl,
      recorded_by,
      notes,
      created_at
    FROM patient_vitals
    WHERE patient_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT ?
  `;

  db.all(sql, [patientId, Number(limit || DEFAULT_VITALS_LIMIT)], (err, rows) => {
    callback(err, rows || []);
  });
}

function getPatientVitalsAsync(patientId, limit = DEFAULT_VITALS_LIMIT) {
  return new Promise((resolve, reject) => {
    getPatientVitals(patientId, limit, (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

async function buildSystemAnalyticsOverview() {
  const patients = await dbAllAsync(
    `
    SELECT
      p.id,
      p.patient_code,
      p.first_name,
      p.last_name,
      p.gender,
      p.date_of_birth,
      p.blood_type,
      p.address,
      COALESCE(m.diagnosis, '') AS diagnosis,
      COALESCE(m.chronic_conditions, '') AS chronic_conditions,
      COALESCE(m.allergies, '') AS allergies,
      COALESCE(m.medications, '') AS medications,
      COALESCE(m.notes, '') AS notes,
      COALESCE(e.priority_level, 'medium') AS priority_level,
      COALESCE(e.risk_flags, '') AS risk_flags,
      COALESCE(e.emergency_summary, '') AS emergency_summary
    FROM patients p
    LEFT JOIN medical_records m ON m.id = (
      SELECT id FROM medical_records WHERE patient_id = p.id ORDER BY id DESC LIMIT 1
    )
    LEFT JOIN emergency_notes e ON e.id = (
      SELECT id FROM emergency_notes WHERE patient_id = p.id ORDER BY id DESC LIMIT 1
    )
    ORDER BY p.id DESC
    `
  );

  const auditRows = await dbAllAsync(
    `
    SELECT actor_role, action_type, created_at
    FROM audit_logs
    ORDER BY id DESC
    LIMIT 400
    `
  );

  const vitalsRows = await dbAllAsync(
    `
    SELECT patient_id, created_at
    FROM patient_vitals
    ORDER BY id DESC
    LIMIT 500
    `
  );

  const totals = {
    totalPatients: patients.length,
    withFamilyHistory: 0,
    highPriorityCases: patients.filter((patient) => patient.priority_level === "high").length,
    patientsWithVitals: new Set(vitalsRows.map((row) => row.patient_id)).size,
  };

  const bloodDistributionMap = new Map();
  const genderDistributionMap = new Map();
  const priorityDistributionMap = new Map();

  patients.forEach((patient) => {
    const bloodType = patient.blood_type || "Unknown";
    bloodDistributionMap.set(bloodType, (bloodDistributionMap.get(bloodType) || 0) + 1);

    const gender = patient.gender || "Unknown";
    genderDistributionMap.set(gender, (genderDistributionMap.get(gender) || 0) + 1);

    const priority = patient.priority_level || "medium";
    priorityDistributionMap.set(priority, (priorityDistributionMap.get(priority) || 0) + 1);
  });

  const recentActivityMap = new Map();
  const today = new Date();
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    const key = date.toISOString().split("T")[0];
    recentActivityMap.set(key, 0);
  }

  auditRows.forEach((row) => {
    const key = String(row.created_at || "").slice(0, 10);
    if (recentActivityMap.has(key)) {
      recentActivityMap.set(key, recentActivityMap.get(key) + 1);
    }
  });

  const highAttentionPatients = [];

  for (const patient of patients) {
    const familyMembers = await new Promise((resolve) => {
      getFamilyMembers(patient.id, (err, rows) => resolve(err ? [] : rows || []));
    });

    if (familyMembers.length > 0) {
      totals.withFamilyHistory += 1;
    }

    const recentVitals = await getPatientVitalsAsync(patient.id, 6).catch(() => []);
    const riskAssessment = buildRiskAssessment(patient, familyMembers);
    const insights = buildClinicalInsights(patient, familyMembers, recentVitals, riskAssessment);

    highAttentionPatients.push({
      patient_code: patient.patient_code,
      full_name: `${patient.first_name} ${patient.last_name}`.trim(),
      priority_level: patient.priority_level || "medium",
      care_score: insights.care_score,
      care_band: insights.care_band,
      summary: insights.summary,
      hereditary_score: riskAssessment.hereditary_score,
    });
  }

  highAttentionPatients.sort((a, b) => b.care_score - a.care_score);

  return {
    totals,
    bloodDistribution: Array.from(bloodDistributionMap.entries()).map(([label, value]) => ({ label, value })),
    genderDistribution: Array.from(genderDistributionMap.entries()).map(([label, value]) => ({ label, value })),
    priorityDistribution: Array.from(priorityDistributionMap.entries()).map(([label, value]) => ({ label, value })),
    topRiskFlags: countTerms(patients.map((patient) => patient.risk_flags)),
    topChronicConditions: countTerms(patients.map((patient) => patient.chronic_conditions)),
    recentActivity: Array.from(recentActivityMap.entries()).map(([label, value]) => ({ label, value })),
    highAttentionPatients: highAttentionPatients.slice(0, 6),
  };
}

// ─────────────────────────────────────────────────────────────
// Data Helpers
// ─────────────────────────────────────────────────────────────
function getPatientFullDataByCode(patientCode, callback) {
  const normalizedPatientCode = normalizePatientCode(patientCode);
  const sql = `
    SELECT
      p.*,
      u.email,
      u.national_id,
      m.id AS medical_record_id,
      m.diagnosis,
      m.allergies,
      m.medications,
      m.chronic_conditions,
      m.last_visit_date,
      m.doctor_name,
      m.notes,
      e.id AS emergency_note_id,
      e.emergency_summary,
      e.risk_flags,
      e.priority_level
    FROM patients p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN medical_records m ON m.id = (
      SELECT id
      FROM medical_records
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    LEFT JOIN emergency_notes e ON e.id = (
      SELECT id
      FROM emergency_notes
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    WHERE UPPER(p.patient_code) = UPPER(?)
    LIMIT 1
  `;

  db.get(sql, [normalizedPatientCode], callback);
}

function getFamilyMembers(patientId, callback) {
  const sql1 = `
    SELECT
      fl.id,
      fl.relationship,
      'outgoing' AS direction,
      p.id AS patient_id,
      p.user_id,
      p.patient_code,
      p.first_name,
      p.last_name,
      p.gender,
      p.date_of_birth,
      p.blood_type,
      p.qr_code,
      m.diagnosis,
      m.allergies,
      m.medications,
      m.chronic_conditions,
      m.notes,
      e.risk_flags,
      e.priority_level,
      e.emergency_summary
    FROM family_links fl
    JOIN patients p ON fl.related_patient_id = p.id
    LEFT JOIN medical_records m ON m.id = (
      SELECT id
      FROM medical_records
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    LEFT JOIN emergency_notes e ON e.id = (
      SELECT id
      FROM emergency_notes
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    WHERE fl.patient_id = ?
  `;

  const sql2 = `
    SELECT
      fl.id,
      fl.relationship,
      'incoming' AS direction,
      p.id AS patient_id,
      p.user_id,
      p.patient_code,
      p.first_name,
      p.last_name,
      p.gender,
      p.date_of_birth,
      p.blood_type,
      p.qr_code,
      m.diagnosis,
      m.allergies,
      m.medications,
      m.chronic_conditions,
      m.notes,
      e.risk_flags,
      e.priority_level,
      e.emergency_summary
    FROM family_links fl
    JOIN patients p ON fl.patient_id = p.id
    LEFT JOIN medical_records m ON m.id = (
      SELECT id
      FROM medical_records
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    LEFT JOIN emergency_notes e ON e.id = (
      SELECT id
      FROM emergency_notes
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    WHERE fl.related_patient_id = ?
  `;

  db.all(sql1, [patientId], (err, rows1) => {
    if (err) return callback(err, []);

    db.all(sql2, [patientId], (err, rows2) => {
      if (err) return callback(err, rows1 || []);

      const combined = [...(rows1 || []), ...(rows2 || [])].map((row) => ({
        ...row,
        display_relationship: getDisplayRelationship(
          row.relationship,
          row.direction,
          row.gender
        ),
      }));

      const seen = new Set();
      const uniqueRows = [];

      combined.forEach((row) => {
        const key = `${row.id}-${row.patient_code}-${row.direction}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueRows.push(row);
        }
      });

      callback(null, uniqueRows);
    });
  });
}

// ─────────────────────────────────────────────────────────────
// App Assistant API
// ─────────────────────────────────────────────────────────────
app.post("/api/chatbot/message", async (req, res) => {
  const message = String(req.body.message || "").trim();

  if (!message) {
    return res.status(400).json({
      reply: "Please enter a message for the assistant.",
      suggestions: ["Explain current page", "Summarize my record", "Show important information"],
    });
  }

  try {
    let patientData = null;
    let familyMembers = [];
    let recentVitals = [];

      if (req.session.patientAccess?.patient_code) {
      patientData = await new Promise((resolve, reject) => {
        getPatientFullDataByCode(req.session.patientAccess.patient_code, (err, patient) => {
          if (err) return reject(err);
          resolve(patient || null);
        });
      });

      if (patientData) {
        familyMembers = await new Promise((resolve) => {
          getFamilyMembers(patientData.id, (err, rows) => resolve(err ? [] : rows || []));
        });

        recentVitals = await getPatientVitalsAsync(patientData.id, 6).catch(() => []);
      }
    }

    const assistantReply = createAssistantReply({
      message,
      pathname: String(req.body.pathname || req.path || ""),
      patientData,
      familyMembers,
      recentVitals,
    });

    return res.json(assistantReply);
  } catch (error) {
    console.error("Assistant API error:", error.message);
    return res.status(500).json({
      reply: "The assistant could not load the current session context. Please try again.",
      suggestions: ["Explain current page", "Summarize my record", "Show important information"],
    });
  }
});

// ─────────────────────────────────────────────────────────────
// Home
// ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  if (req.session.patientAccess?.patient_code) {
    return res.redirect(`/patient-portal/${encodeURIComponent(req.session.patientAccess.patient_code)}`);
  }

  if (req.session.staffUser) {
    return res.redirect("/patient-access");
  }

  return res.redirect("/login");
});

// ─────────────────────────────────────────────────────────────
// Staff Login / Logout
// ─────────────────────────────────────────────────────────────
app.get("/patient-login", (req, res) => {
  if (req.session.patientAccess?.patient_code) {
    return res.redirect(`/patient-portal/${encodeURIComponent(req.session.patientAccess.patient_code)}`);
  }

  if (req.session.staffUser) {
    return res.redirect("/patient-access");
  }

  return res.redirect("/login?notice=staff-first");
});

app.get("/app/patient-login", (req, res) => {
  delete req.session.staffUser;
  req.session.clientMode = "app";

  if (req.session.patientAccess?.patient_code) {
    return res.redirect(`/patient-portal/${encodeURIComponent(req.session.patientAccess.patient_code)}`);
  }

  return renderPatientLoginPage(req, res, null);
});

app.get("/login", (req, res) => {
  if (req.session.patientAccess?.patient_code) {
    return res.redirect(`/patient-portal/${encodeURIComponent(req.session.patientAccess.patient_code)}`);
  }

  if (req.session.staffUser) {
    return res.redirect("/patient-access");
  }

  return renderStaffLoginPage(res, null, req.query.notice || null);
});

app.post("/patient-login", requireStaff, (req, res) => {
  return res.redirect("/patient-access");
});

app.post("/app/patient-login", (req, res) => {
  delete req.session.staffUser;
  req.session.clientMode = "app";
  return authenticatePatientLogin(req, res);
});

app.post("/login", (req, res) => authenticateStaffLogin(req, res));

app.get("/logout", (req, res) => {
  const currentStaff = req.session.staffUser;
  const currentPatient = req.session.patientAccess;
  const currentPatientUser = req.session.patientUser;
  const redirectPath = req.session.clientMode === "app" && currentPatientUser && !currentStaff
    ? "/app/patient-login"
    : "/login";

  if (currentPatient && currentStaff) {
    logAuditEvent({
      req,
      actor_name: currentStaff.full_name,
      actor_role: currentStaff.role,
      patient_code: currentPatient.patient_code,
      action_type: "PATIENT_ACCESS_ENDED",
      access_channel: "web",
      details: "Patient supervised session ended during logout",
    });
  }

  if (currentStaff) {
    logAuditEvent({
      req,
      actor_name: currentStaff.full_name,
      actor_role: currentStaff.role,
      action_type: "STAFF_LOGOUT",
      access_channel: "web",
      details: "Staff logged out",
    });
  }

  if (currentPatient && currentPatientUser) {
    logAuditEvent({
      req,
      actor_name: currentPatientUser.full_name,
      actor_role: "patient",
      patient_code: currentPatient.patient_code,
      action_type: "PATIENT_LOGOUT",
      access_channel: "patient-portal",
      details: "Patient logged out from the self-service portal",
    });
  }

  req.session.destroy(() => res.redirect(redirectPath));
});



// ─────────────────────────────────────────────────────────────
// Staff Directory
// ─────────────────────────────────────────────────────────────
app.get("/staff-directory", requireStaff, (req, res) => {
  db.all(
    `
    SELECT id, full_name, email, national_id, role
    FROM users
    WHERE role IN ('staff', 'admin')
    ORDER BY full_name ASC
    `,
    [],
    (err, staffMembers) => {
      if (err) {
        console.error(err.message);
        return res.send("Error loading staff directory.");
      }

      const formattedStaffMembers = (staffMembers || []).map((member) => ({
        ...member,
        login_id: member.national_id,
      }));

      logAuditEvent({
        req,
        actor_name: req.session.staffUser.full_name,
        actor_role: req.session.staffUser.role,
        action_type: "STAFF_DIRECTORY_VIEW",
        access_channel: "staff-portal",
        details: "Viewed staff directory",
      });

      res.render("staff-directory.ejs", {
        title: "Staff Directory",
        staffMembers: formattedStaffMembers,
      });
    }
  );
});

app.get("/analytics-dashboard", requireStaff, requireNoActivePatientSession, async (req, res) => {
  try {
    const analytics = await buildSystemAnalyticsOverview();

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      action_type: "ANALYTICS_DASHBOARD_VIEW",
      access_channel: "staff-portal",
      details: "Viewed system analytics dashboard",
    });

    res.render("analytics-dashboard.ejs", {
      title: "Clinical Analytics Dashboard",
      analytics,
    });
  } catch (error) {
    console.error("Analytics dashboard error:", error.message);
    res.status(500).send("Could not load the analytics dashboard.");
  }
});

// ─────────────────────────────────────────────────────────────
// Patient Access (only after staff login)
// ─────────────────────────────────────────────────────────────
app.get("/patient-access", requireStaff, (req, res) => {
  res.render("patient-access.ejs", {
    title: "Patient Access",
    error: null,
    success: null,
    notice: req.query.notice || null,
    currentPatientSession: req.session.patientAccess || null,
  });
});

app.post("/patient-access/password", requireStaff, (req, res) => {
  if (req.session.patientAccess) {
    return res.redirect("/dashboard?notice=active-session-lock");
  }

  const identifier = normalizeLookupValue(req.body.identifier);
  const password = normalizeLookupValue(req.body.password);

  if (!identifier || !password) {
    return res.render("patient-access.ejs", {
      title: "Patient Access",
      error: "Please enter patient ID and password.",
      success: null,
      currentPatientSession: req.session.patientAccess || null,
    });
  }

  db.get(
    `
    SELECT
      u.id,
      u.national_id,
      p.id AS patient_id,
      p.patient_code,
      p.first_name,
      p.last_name,
      COALESCE(NULLIF(p.password, ''), u.password) AS patient_password
    FROM users u
    JOIN patients p ON p.user_id = u.id
    WHERE u.role = 'patient'
      AND (
        UPPER(COALESCE(p.patient_code, '')) = UPPER(?)
        OR UPPER(COALESCE(u.national_id, '')) = UPPER(?)
      )
    LIMIT 1
    `,
    [identifier, identifier],
    async (err, patientUser) => {
      if (err) {
        console.error(err.message);
        return res.render("patient-access.ejs", {
          title: "Patient Access",
          error: "Database error. Please try again.",
          success: null,
          currentPatientSession: req.session.patientAccess || null,
        });
      }

      const isValidPatientPassword = patientUser
        ? await comparePassword(password, patientUser.patient_password)
        : false;

      if (!patientUser || !isValidPatientPassword) {
        return res.render("patient-access.ejs", {
          title: "Patient Access",
          error: "Invalid patient ID or password.",
          success: null,
          currentPatientSession: req.session.patientAccess || null,
        });
      }

      setPatientAccessSession(req, {
        id: patientUser.patient_id,
        user_id: patientUser.id,
        patient_code: patientUser.patient_code,
        first_name: patientUser.first_name,
        last_name: patientUser.last_name,
      });


      res.redirect(`/patient-portal/${patientUser.patient_code}`);
    }
  );
});

app.post("/patient-access/qr", requireStaff, (req, res) => {
  if (req.session.patientAccess) {
    return res.redirect("/dashboard?notice=active-session-lock");
  }

  const patientCode = normalizePatientCode(parseQrPayload(req.body.qr_value, "patient"));

  if (!patientCode) {
    return res.render("patient-access.ejs", {
      title: "Patient Access",
      error: "Invalid patient QR value.",
      success: null,
      currentPatientSession: req.session.patientAccess || null,
    });
  }

  getPatientFullDataByCode(patientCode, (err, patient) => {
    if (err || !patient) {
      return res.render("patient-access.ejs", {
        title: "Patient Access",
        error: "Patient QR not recognized.",
        success: null,
        currentPatientSession: req.session.patientAccess || null,
      });
    }

    setPatientAccessSession(req, patient);

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: patient.patient_code,
      action_type: "PATIENT_QR_LOGIN_SUPERVISED",
      access_channel: "qr-scan",
      details: "Patient authenticated using QR under staff supervision",
    });

    res.redirect(`/patient-portal/${patient.patient_code}`);
  });
});

app.get("/patient-qr-login/:patientCode", requireStaff, requireNoActivePatientSession, (req, res) => {
  const patientCode = normalizePatientCode(decodeURIComponent(req.params.patientCode || ""));

  getPatientFullDataByCode(patientCode, (err, patient) => {
    if (err || !patient) {
      return res.redirect("/patient-access");
    }

    setPatientAccessSession(req, patient);

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: patient.patient_code,
      action_type: "PATIENT_QR_LOGIN_SUPERVISED",
      access_channel: "qr-direct-link",
      details: "Patient authenticated using QR direct link under staff supervision",
    });

    res.redirect(`/patient-portal/${patient.patient_code}`);
  });
});

app.post("/patient-access/logout", requireStaff, (req, res) => {
  const currentPatient = req.session.patientAccess;

  if (currentPatient) {
    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: currentPatient.patient_code,
      action_type: "PATIENT_ACCESS_ENDED",
      access_channel: "staff-portal",
      details: "Staff ended patient supervised session",
    });
  }

  clearPatientAccessSession(req);
  res.redirect("/patient-access");
});

app.get("/patient-portal{/:patientCode}", requirePatientAccess, async (req, res) => {
  const sessionPatient = req.session.patientAccess;
  const requestedCode = req.params.patientCode || sessionPatient.patient_code;

  if (requestedCode !== sessionPatient.patient_code) {
    return res.status(403).send("Access denied for this patient session.");
  }

  try {
    const patientData = await new Promise((resolve, reject) => {
      getPatientFullDataByCode(requestedCode, (err, patient) => {
        if (err) return reject(err);
        resolve(patient || null);
      });
    });

    if (!patientData) {
      return res.status(404).send("Patient not found.");
    }

    const familyMembers = await new Promise((resolve) => {
      getFamilyMembers(patientData.id, (err, rows) => resolve(err ? [] : rows || []));
    });
    const recentVitals = await getPatientVitalsAsync(patientData.id, 12).catch(() => []);
    const riskAssessment = buildRiskAssessment(patientData, familyMembers);
    const patientInsights = buildClinicalInsights(patientData, familyMembers, recentVitals, riskAssessment);
    const locationLinks = buildLocationLinks(patientData);

    const isSelfAccess = Boolean(req.session.patientUser);
    const portalActor = isSelfAccess
      ? {
          actor_name: req.session.patientUser.full_name,
          actor_role: "patient",
          action_type: "PATIENT_PORTAL_VIEW",
          access_channel: "patient-self-service-portal",
          details: "Viewed own medical record after patient login",
        }
      : {
          actor_name: req.session.staffUser.full_name,
          actor_role: req.session.staffUser.role,
          action_type: "PATIENT_PORTAL_VIEW",
          access_channel: "staff-supervised-patient-portal",
          details: "Viewed patient case after supervised patient authentication",
        };

    logAuditEvent({
      req,
      ...portalActor,
      patient_code: patientData.patient_code,
    });

    res.render("patient-portal.ejs", {
      title: `${isSelfAccess ? "My Medical Record" : "Patient Portal"} — ${patientData.first_name} ${patientData.last_name}`,
      staffUser: req.session.staffUser || null,
      patientUser: req.session.patientUser || null,
      isSelfAccess,
      patientData,
      familyCount: familyMembers.length,
      patientRiskAssessment: riskAssessment,
      familyMembers,
      recentVitals,
      patientInsights,
      locationLinks,
      vitalsSaved: req.query.vitals === "saved",
    });
  } catch (error) {
    console.error("Patient portal error:", error.message);
    return res.status(500).send("Could not load the patient portal.");
  }
});

app.post("/patient-vitals/:patientCode", requireStaff, enforceSessionPatientMatch, async (req, res) => {
  const { patientCode } = req.params;

  try {
    const patientData = await new Promise((resolve, reject) => {
      getPatientFullDataByCode(patientCode, (err, patient) => {
        if (err) return reject(err);
        resolve(patient || null);
      });
    });

    if (!patientData) {
      return res.status(404).send("Patient not found.");
    }

    const numericOrNull = (value, parser = Number) => {
      const trimmed = String(value || "").trim();
      if (!trimmed) return null;
      const parsed = parser(trimmed);
      return Number.isNaN(parsed) ? null : parsed;
    };

    const systolic_bp = numericOrNull(req.body.systolic_bp, Number.parseInt);
    const diastolic_bp = numericOrNull(req.body.diastolic_bp, Number.parseInt);
    const heart_rate = numericOrNull(req.body.heart_rate, Number.parseInt);
    const oxygen_saturation = numericOrNull(req.body.oxygen_saturation, Number.parseFloat);
    const temperature_c = numericOrNull(req.body.temperature_c, Number.parseFloat);
    const respiratory_rate = numericOrNull(req.body.respiratory_rate, Number.parseInt);
    const glucose_mg_dl = numericOrNull(req.body.glucose_mg_dl, Number.parseFloat);
    const notes = String(req.body.notes || "").trim();

    if (
      [
        systolic_bp,
        diastolic_bp,
        heart_rate,
        oxygen_saturation,
        temperature_c,
        respiratory_rate,
        glucose_mg_dl,
      ].every((value) => value === null)
    ) {
      return res.redirect(`/patient-portal/${patientCode}`);
    }

    await dbRunAsync(
      `
      INSERT INTO patient_vitals (
        patient_id,
        systolic_bp,
        diastolic_bp,
        heart_rate,
        oxygen_saturation,
        temperature_c,
        respiratory_rate,
        glucose_mg_dl,
        recorded_by,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        patientData.id,
        systolic_bp,
        diastolic_bp,
        heart_rate,
        oxygen_saturation,
        temperature_c,
        respiratory_rate,
        glucose_mg_dl,
        req.session.staffUser.full_name,
        notes,
      ]
    );

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: patientData.patient_code,
      action_type: "PATIENT_VITALS_RECORDED",
      access_channel: "staff-portal",
      details: "Recorded a new set of vital signs",
    });

    return res.redirect(`/patient-portal/${patientCode}?vitals=saved`);
  } catch (error) {
    console.error("Record vitals error:", error.message);
    return res.status(500).send("Could not save patient vitals.");
  }
});

// ─────────────────────────────────────────────────────────────
// Patient Management
// ─────────────────────────────────────────────────────────────
app.get("/manage-patients", requireStaff, requireNoActivePatientSession, (req, res) => {
  logAuditEvent({
    req,
    actor_name: req.session.staffUser.full_name,
    actor_role: req.session.staffUser.role,
    action_type: "PATIENT_DIRECTORY_RETIRED_REDIRECT",
    access_channel: "staff-portal",
    details: "Redirected from retired patient directory to supervised patient access flow",
  });

  return res.redirect("/patient-access?notice=directory-retired");
});

// ─────────────────────────────────────────────────────────────
// Edit Patient
// ─────────────────────────────────────────────────────────────
app.get("/edit-patient/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;
  const updated = req.query.updated || null;

  getPatientFullDataByCode(patientCode, (err, patient) => {
    if (err) {
      console.error("GET edit patient error:", err.message);
      return res.status(500).send("Error loading patient.");
    }

    if (!patient) {
      return res.status(404).send("Patient not found.");
    }

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: patient.patient_code,
      action_type: "PATIENT_EDIT_VIEW",
      access_channel: "staff-portal",
      details: "Opened patient edit page",
    });

    renderEditPatientPage(
      res,
      patient,
      null,
      updated ? "Patient record updated successfully." : null
    );
  });
});

app.post("/edit-patient/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;

  getPatientFullDataByCode(patientCode, (err, existingPatient) => {
    if (err) {
      console.error("POST edit patient fetch error:", err.message);
      return res.status(500).send("Error loading patient.");
    }

    if (!existingPatient) {
      return res.status(404).send("Patient not found.");
    }

    const patient = {
      ...existingPatient,
      ...req.body,
      patient_code: patientCode,
    };

    const {
      first_name,
      last_name,
      email,
      national_id,
      gender,
      date_of_birth,
      phone,
      address,
      blood_type,
      emergency_contact_name,
      emergency_contact_phone,
      diagnosis,
      allergies,
      medications,
      chronic_conditions,
      emergency_summary,
      risk_flags,
      priority_level,
      notes,
    } = req.body;

    const normalizedPatientPhone = normalizeLebanesePhone(phone, {
      required: false,
      label: "Patient phone number",
    });
    const normalizedEmergencyPhone = normalizeLebanesePhone(emergency_contact_phone, {
      required: true,
      label: "Emergency contact phone number",
    });

    patient.phone = normalizedPatientPhone.value || phone || "";
    patient.emergency_contact_phone =
      normalizedEmergencyPhone.value || emergency_contact_phone || "";

    if (
      !first_name ||
      !last_name ||
      !email ||
      !national_id ||
      !gender ||
      !date_of_birth ||
      !blood_type ||
      !emergency_contact_name ||
      !emergency_contact_phone
    ) {
      return renderEditPatientPage(
        res,
        patient,
        "Please fill in all required fields.",
        null
      );
    }

    if (normalizedPatientPhone.error || normalizedEmergencyPhone.error) {
      return renderEditPatientPage(
        res,
        patient,
        [normalizedPatientPhone.error, normalizedEmergencyPhone.error].filter(Boolean).join(" "),
        null
      );
    }

    db.get(
      `
      SELECT id FROM users
      WHERE (email = ? OR national_id = ?)
      AND id != ?
      `,
      [email, national_id, existingPatient.user_id],
      (err, duplicateUser) => {
        if (err) {
          console.error("Duplicate check error:", err.message);
          return renderEditPatientPage(
            res,
            patient,
            "Database error while checking duplicate email or national ID.",
            null
          );
        }

        if (duplicateUser) {
          return renderEditPatientPage(
            res,
            patient,
            "Another user already uses this email or national ID.",
            null
          );
        }

        const fullName = `${first_name} ${last_name}`;

        db.serialize(() => {
          db.run("BEGIN TRANSACTION", (beginErr) => {
            if (beginErr) {
              console.error("BEGIN TRANSACTION error:", beginErr.message);
              return renderEditPatientPage(
                res,
                patient,
                "Could not start update transaction.",
                null
              );
            }

            db.run(
              `
              UPDATE users
              SET full_name = ?, email = ?, national_id = ?
              WHERE id = ?
              `,
              [fullName, email, national_id, existingPatient.user_id],
              function (err) {
                if (err) {
                  console.error("Update users error:", err.message);
                  return db.run("ROLLBACK", () => {
                    renderEditPatientPage(
                      res,
                      patient,
                      "Could not update user account.",
                      null
                    );
                  });
                }

                db.run(
                  `
                  UPDATE patients
                  SET
                    first_name = ?,
                    last_name = ?,
                    gender = ?,
                    date_of_birth = ?,
                    phone = ?,
                    address = ?,
                    blood_type = ?,
                    emergency_contact_name = ?,
                    emergency_contact_phone = ?
                  WHERE id = ?
                  `,
                  [
                    first_name,
                    last_name,
                    gender,
                    date_of_birth,
                    normalizedPatientPhone.value,
                    address || "",
                    blood_type,
                    emergency_contact_name,
                    normalizedEmergencyPhone.value,
                    existingPatient.id,
                  ],
                  function (err) {
                    if (err) {
                      console.error("Update patients error:", err.message);
                      return db.run("ROLLBACK", () => {
                        renderEditPatientPage(
                          res,
                          patient,
                          "Could not update patient profile.",
                          null
                        );
                      });
                    }

                    const updateMedical = (callback) => {
                      if (existingPatient.medical_record_id) {
                        db.run(
                          `
                          UPDATE medical_records
                          SET
                            diagnosis = ?,
                            allergies = ?,
                            medications = ?,
                            chronic_conditions = ?,
                            last_visit_date = ?,
                            doctor_name = ?,
                            notes = ?
                          WHERE id = ?
                          `,
                          [
                            diagnosis || "",
                            allergies || "",
                            medications || "",
                            chronic_conditions || "",
                            new Date().toISOString().split("T")[0],
                            req.session.staffUser.full_name,
                            notes || "",
                            existingPatient.medical_record_id,
                          ],
                          callback
                        );
                      } else {
                        db.run(
                          `
                          INSERT INTO medical_records (
                            patient_id,
                            diagnosis,
                            allergies,
                            medications,
                            chronic_conditions,
                            last_visit_date,
                            doctor_name,
                            notes
                          )
                          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                          `,
                          [
                            existingPatient.id,
                            diagnosis || "",
                            allergies || "",
                            medications || "",
                            chronic_conditions || "",
                            new Date().toISOString().split("T")[0],
                            req.session.staffUser.full_name,
                            notes || "",
                          ],
                          callback
                        );
                      }
                    };

                    const updateEmergency = (callback) => {
                      if (existingPatient.emergency_note_id) {
                        db.run(
                          `
                          UPDATE emergency_notes
                          SET
                            emergency_summary = ?,
                            risk_flags = ?,
                            priority_level = ?
                          WHERE id = ?
                          `,
                          [
                            emergency_summary || "",
                            risk_flags || "",
                            priority_level || "medium",
                            existingPatient.emergency_note_id,
                          ],
                          callback
                        );
                      } else {
                        db.run(
                          `
                          INSERT INTO emergency_notes (
                            patient_id,
                            emergency_summary,
                            risk_flags,
                            priority_level
                          )
                          VALUES (?, ?, ?, ?)
                          `,
                          [
                            existingPatient.id,
                            emergency_summary || "",
                            risk_flags || "",
                            priority_level || "medium",
                          ],
                          callback
                        );
                      }
                    };

                    updateMedical((err) => {
                      if (err) {
                        console.error("Update medical error:", err.message);
                        return db.run("ROLLBACK", () => {
                          renderEditPatientPage(
                            res,
                            patient,
                            "Could not update medical record.",
                            null
                          );
                        });
                      }

                      updateEmergency((err) => {
                        if (err) {
                          console.error("Update emergency error:", err.message);
                          return db.run("ROLLBACK", () => {
                            renderEditPatientPage(
                              res,
                              patient,
                              "Could not update emergency summary.",
                              null
                            );
                          });
                        }

                        db.run("COMMIT", (err) => {
                          if (err) {
                            console.error("COMMIT error:", err.message);
                            return db.run("ROLLBACK", () => {
                              renderEditPatientPage(
                                res,
                                patient,
                                "Could not finalize update.",
                                null
                              );
                            });
                          }

                          logAuditEvent({
                            req,
                            actor_name: req.session.staffUser.full_name,
                            actor_role: req.session.staffUser.role,
                            patient_code: existingPatient.patient_code,
                            action_type: "PATIENT_UPDATED",
                            access_channel: "staff-portal",
                            details: `Updated patient record for ${fullName}`,
                          });

                          return res.redirect(`/edit-patient/${existingPatient.patient_code}?updated=1`);
                        });
                      });
                    });
                  }
                );
              }
            );
          });
        });
      }
    );
  });
});

// ─────────────────────────────────────────────────────────────
// Register Patient
// ─────────────────────────────────────────────────────────────
app.get("/register-patient", requireStaff, requireNoActivePatientSession, (req, res) => {
  renderRegisterPatientPage(res);
});

app.post("/register-patient", requireStaff, requireNoActivePatientSession, (req, res) => {
  const {
    first_name,
    last_name,
    email,
    national_id,
    gender,
    date_of_birth,
    phone,
    address,
    blood_type,
    emergency_contact_name,
    emergency_contact_phone,
    diagnosis,
    allergies,
    medications,
    chronic_conditions,
    emergency_summary,
    risk_flags,
    priority_level,
    notes,
  } = req.body;

  const formData = req.body;
  const normalizedPatientPhone = normalizeLebanesePhone(phone, {
    required: false,
    label: "Patient phone number",
  });
  const normalizedEmergencyPhone = normalizeLebanesePhone(emergency_contact_phone, {
    required: true,
    label: "Emergency contact phone number",
  });
  const normalizedFormData = {
    ...formData,
    phone: normalizedPatientPhone.value || phone || "",
    emergency_contact_phone: normalizedEmergencyPhone.value || emergency_contact_phone || "",
  };

  if (
    !first_name ||
    !last_name ||
    !email ||
    !gender ||
    !date_of_birth ||
    !blood_type ||
    !emergency_contact_name ||
    !emergency_contact_phone
  ) {
    return renderRegisterPatientPage(
      res,
      "Please fill in all required fields.",
      null,
      normalizedFormData
    );
  }

  if (normalizedPatientPhone.error || normalizedEmergencyPhone.error) {
    return renderRegisterPatientPage(
      res,
      [normalizedPatientPhone.error, normalizedEmergencyPhone.error].filter(Boolean).join(" "),
      null,
      normalizedFormData
    );
  }

  db.get(
    `SELECT * FROM users WHERE email = ?`,
    [email],
    async (err, existingUser) => {
      if (err) {
        console.error(err.message);
        return renderRegisterPatientPage(res, "Database error.", null, normalizedFormData);
      }

      if (existingUser) {
        return renderRegisterPatientPage(
          res,
          "A user with this email already exists.",
          null,
          normalizedFormData
        );
      }

      db.get(`SELECT id FROM patients ORDER BY id DESC LIMIT 1`, [], async (err, lastPatient) => {
        if (err) {
          console.error(err.message);
          return renderRegisterPatientPage(
            res,
            "Error generating patient code.",
            null,
            normalizedFormData
          );
        }

        const nextNumber = lastPatient ? lastPatient.id + 1 : 1;
        const patientCode = `P-${String(nextNumber).padStart(4, "0")}`;
        const generatedNationalId = buildGeneratedPatientNationalId(nextNumber);
        const generatedPassword = generateStructuredPassword("patient", first_name);
        const fullName = `${first_name} ${last_name}`;

        let storedGeneratedPassword = "";

        try {
          storedGeneratedPassword = await hashPassword(generatedPassword);
        } catch (passwordError) {
          console.error("Password preparation error:", passwordError.message);
          return renderRegisterPatientPage(
            res,
            "Could not prepare the patient password.",
            null,
            normalizedFormData
          );
        }

        db.run("BEGIN TRANSACTION");

        db.run(
          `
          INSERT INTO users (full_name, email, password, role, national_id)
          VALUES (?, ?, ?, ?, ?)
          `,
          [fullName, email, storedGeneratedPassword, "patient", generatedNationalId],
          function (err) {
            if (err) {
              console.error(err.message);
              return db.run("ROLLBACK", () =>
                renderRegisterPatientPage(
                  res,
                  "Could not create patient account.",
                  null,
                  normalizedFormData
                )
              );
            }

            const userId = this.lastID;

            db.run(
              `
              INSERT INTO patients (
                user_id,
                patient_code,
                password,
                qr_code,
                first_name,
                last_name,
                gender,
                date_of_birth,
                phone,
                address,
                blood_type,
                emergency_contact_name,
                emergency_contact_phone
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `,
              [
                userId,
                patientCode,
                storedGeneratedPassword,
                "",
                first_name,
                last_name,
                gender,
                date_of_birth,
                normalizedPatientPhone.value,
                address || "",
                blood_type,
                emergency_contact_name,
                normalizedEmergencyPhone.value,
              ],
              function (err) {
                if (err) {
                  console.error(err.message);
                  return db.run("ROLLBACK", () =>
                    renderRegisterPatientPage(
                      res,
                      "Could not create patient profile.",
                      null,
                      normalizedFormData
                    )
                  );
                }

                const patientId = this.lastID;

                db.run(
                  `
                  INSERT INTO medical_records (
                    patient_id,
                    diagnosis,
                    allergies,
                    medications,
                    chronic_conditions,
                    last_visit_date,
                    doctor_name,
                    notes
                  )
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  `,
                  [
                    patientId,
                    diagnosis || "",
                    allergies || "",
                    medications || "",
                    chronic_conditions || "",
                    new Date().toISOString().split("T")[0],
                    req.session.staffUser.full_name,
                    notes || "",
                  ],
                  function (err) {
                    if (err) {
                      console.error(err.message);
                      return db.run("ROLLBACK", () =>
                        renderRegisterPatientPage(
                          res,
                          "Could not save medical record.",
                          null,
                          normalizedFormData
                        )
                      );
                    }

                    db.run(
                      `
                      INSERT INTO emergency_notes (
                        patient_id,
                        emergency_summary,
                        risk_flags,
                        priority_level
                      )
                      VALUES (?, ?, ?, ?)
                      `,
                      [
                        patientId,
                        emergency_summary ||
                          `${fullName} registered. No emergency summary yet.`,
                        risk_flags || chronic_conditions || "None",
                        priority_level || "medium",
                      ],
                      function (err) {
                        if (err) {
                          console.error(err.message);
                          return db.run("ROLLBACK", () =>
                            renderRegisterPatientPage(
                              res,
                              "Could not save emergency note.",
                              null,
                              normalizedFormData
                            )
                          );
                        }

                        db.run("COMMIT", async (err) => {
                          if (err) {
                            console.error(err.message);
                            return db.run("ROLLBACK", () =>
                              renderRegisterPatientPage(
                                res,
                                "Error finalizing registration.",
                                null,
                                normalizedFormData
                              )
                            );
                          }

                          logAuditEvent({
                            req,
                            actor_name: req.session.staffUser.full_name,
                            actor_role: req.session.staffUser.role,
                            patient_code: patientCode,
                            action_type: "PATIENT_REGISTERED",
                            access_channel: "staff-portal",
                            details: `Registered new patient: ${fullName}`,
                          });

                          try {
                            const qrPath = await generateAndSaveQR(patientCode);

                            renderRegisterPatientPage(
                              res,
                              null,
                              `Patient registered successfully.`,
                              {},
                              {
                                patient_code: patientCode,
                                national_id: generatedNationalId,
                                generated_password: generatedPassword,
                                qr_path: qrPath,
                                qr_page: `/patient-qr/${patientCode}`,
                              }
                            );
                          } catch (qrErr) {
                            console.error(qrErr.message);
                            renderRegisterPatientPage(
                              res,
                              null,
                              `Patient registered, but QR generation failed.`,
                              {},
                              {
                                patient_code: patientCode,
                                national_id: generatedNationalId,
                                generated_password: generatedPassword,
                                qr_path: null,
                                qr_page: `/patient-qr/${patientCode}`,
                              }
                            );
                          }
                        });
                      }
                    );
                  }
                );
              }
            );
          }
        );
      });
    }
  );
});

// ─────────────────────────────────────────────────────────────
// Patient QR
// ─────────────────────────────────────────────────────────────
app.get("/patient-qr/:patientCode", requirePatientAccess, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;

  getPatientFullDataByCode(patientCode, async (err, patient) => {
    if (err || !patient) return res.status(404).send("Patient not found.");

    const qrFilePath = path.join(__dirname, "public", "qrcodes", `${patientCode}.png`);
    if (!fs.existsSync(qrFilePath)) {
      try {
        await generateAndSaveQR(patientCode);
        patient.qr_code = `/qrcodes/${patientCode}.png`;
      } catch (e) {
        console.error("QR generation error:", e.message);
      }
    }

    getFamilyMembers(patient.id, (familyErr, familyMembers) => {
      const riskAssessment = buildRiskAssessment(patient, familyMembers || []);
      const isSelfAccess = Boolean(req.session.patientUser);

      const qrActor = isSelfAccess
        ? {
            actor_name: req.session.patientUser.full_name,
            actor_role: "patient",
            action_type: "PATIENT_QR_VIEW",
            access_channel: "patient-self-service-portal",
            details: "Viewed own patient QR card",
          }
        : {
            actor_name: req.session.staffUser.full_name,
            actor_role: req.session.staffUser.role,
            action_type: "PATIENT_QR_VIEW",
            access_channel: "staff-portal",
            details: "Viewed patient QR card",
          };

      logAuditEvent({
        req,
        ...qrActor,
        patient_code: patient.patient_code,
      });

      res.render("patient-qr.ejs", {
        title: `Patient QR — ${patient.first_name} ${patient.last_name}`,
        patient,
        familyMembers: familyErr ? [] : familyMembers,
        riskAssessment,
        notice: req.query.notice || null,
      });
    });
  });
});

app.post("/regenerate-qr/:patientCode", requirePatientAccess, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;
  return res.redirect(`/patient-qr/${patientCode}?notice=qr-static`);
});


// ─────────────────────────────────────────────────────────────
// Risk Assessment
// ─────────────────────────────────────────────────────────────
app.get("/risk-assessment/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;

  getPatientFullDataByCode(patientCode, (err, patient) => {
    if (err || !patient) return res.status(404).send("Patient not found.");

    getFamilyMembers(patient.id, (familyErr, familyMembers) => {
      const riskAssessment = buildRiskAssessment(patient, familyMembers || []);

      logAuditEvent({
        req,
        actor_name: req.session.staffUser.full_name,
        actor_role: req.session.staffUser.role,
        patient_code: patient.patient_code,
        action_type: "RISK_ASSESSMENT_VIEW",
        access_channel: "staff-portal",
        details: "Viewed inherited risk assessment",
      });

      res.render("risk-assessment.ejs", {
        title: `Risk Assessment — ${patient.first_name} ${patient.last_name}`,
        patient,
        familyMembers: familyErr ? [] : familyMembers,
        riskAssessment,
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Room Device Dashboard
// ─────────────────────────────────────────────────────────────
app.get("/room-device", requireStaff, requireNoActivePatientSession, (req, res) => {
  const q = (req.query.q || "").trim();
  const selected = (req.query.selected || "").trim();

  const params = [];
  let whereClause = "";

  if (q) {
    const likeValue = `%${q}%`;
    whereClause = `
      WHERE (
        p.patient_code LIKE ?
        OR p.first_name LIKE ?
        OR p.last_name LIKE ?
        OR ${getFullNameSql("p")} LIKE ?
        OR u.national_id LIKE ?
      )
    `;
    params.push(likeValue, likeValue, likeValue, likeValue, likeValue);
  }

  const sql = `
    SELECT
      p.patient_code,
      p.first_name,
      p.last_name,
      p.blood_type,
      p.gender,
      p.date_of_birth,
      COALESCE(e.priority_level, 'medium') AS priority_level,
      COALESCE(e.risk_flags, 'None') AS risk_flags
    FROM patients p
    LEFT JOIN users u ON p.user_id = u.id
    LEFT JOIN emergency_notes e ON e.id = (
      SELECT id
      FROM emergency_notes
      WHERE patient_id = p.id
      ORDER BY id DESC
      LIMIT 1
    )
    ${whereClause}
    ORDER BY p.id DESC
    LIMIT 100
  `;

  db.all(sql, params, (err, patients) => {
    if (err) {
      console.error(err.message);
      return res.send("Error loading room device dashboard.");
    }

    const selectedCode = selected || (patients.length === 1 ? patients[0].patient_code : "");

    if (!selectedCode) {
      return res.render("room-device.ejs", {
        title: "Room Device Access",
        patients,
        selectedPatient: null,
        roomRiskAssessment: null,
        filters: { q },
      });
    }

    getPatientFullDataByCode(selectedCode, (err, selectedPatient) => {
      if (err || !selectedPatient) {
        return res.render("room-device.ejs", {
          title: "Room Device Access",
          patients,
          selectedPatient: null,
          roomRiskAssessment: null,
          filters: { q },
        });
      }

      getFamilyMembers(selectedPatient.id, (familyErr, familyMembers) => {
        const riskAssessment = buildRiskAssessment(selectedPatient, familyMembers || []);

        logAuditEvent({
          req,
          actor_name: req.session.staffUser.full_name,
          actor_role: req.session.staffUser.role,
          patient_code: selectedPatient.patient_code,
          action_type: "ROOM_DEVICE_DASHBOARD_VIEW",
          access_channel: "room-device-dashboard",
          details: "Staff loaded patient on room device dashboard",
        });

        res.render("room-device.ejs", {
          title: "Room Device Access",
          patients,
          selectedPatient,
          roomRiskAssessment: riskAssessment,
          filters: { q },
        });
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Room View
// ─────────────────────────────────────────────────────────────
app.get("/room-view/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;

  getPatientFullDataByCode(patientCode, (err, patient) => {
    if (err || !patient) {
      return res.status(404).render("room-view.ejs", {
        title: "Room Device View — Not Found",
        patient: null,
        familyMembers: [],
        riskAssessment: null,
        error: "Patient not found. This room display link may be invalid.",
      });
    }

    getFamilyMembers(patient.id, (familyErr, familyMembers) => {
      const riskAssessment = buildRiskAssessment(patient, familyMembers || []);

      logAuditEvent({
        req,
        actor_name: req.session.staffUser.full_name,
        actor_role: req.session.staffUser.role,
        patient_code: patient.patient_code,
        action_type: "ROOM_VIEW_OPEN",
        access_channel: "room-device",
        details: "Room display opened for patient",
      });

      res.render("room-view.ejs", {
        title: `Room Device View — ${patient.first_name} ${patient.last_name}`,
        patient,
        familyMembers: familyErr ? [] : familyMembers,
        riskAssessment,
        error: null,
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────
// Family Links
// ─────────────────────────────────────────────────────────────
app.get("/family-links/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;
  const added = req.query.added || null;
  const removed = req.query.removed || null;

  db.get(`SELECT * FROM patients WHERE patient_code = ?`, [patientCode], (err, patient) => {
    if (err || !patient) return res.status(404).send("Patient not found.");

    getFamilyMembers(patient.id, (familyErr, familyMembers) => {
      db.all(
        `
        SELECT patient_code, first_name, last_name, blood_type
        FROM patients
        WHERE id != ?
        ORDER BY first_name
        `,
        [patient.id],
        (allErr, allPatients) => {
          logAuditEvent({
            req,
            actor_name: req.session.staffUser.full_name,
            actor_role: req.session.staffUser.role,
            patient_code: patient.patient_code,
            action_type: "FAMILY_LINKS_VIEW",
            access_channel: "staff-portal",
            details: "Viewed family links page",
          });

          res.render("family-links.ejs", {
            title: `Family — ${patient.first_name} ${patient.last_name}`,
            patient,
            familyMembers: familyErr ? [] : familyMembers,
            allPatients: allErr ? [] : allPatients,
            error: null,
            success: added
              ? "Family member linked successfully."
              : removed
              ? "Family link removed."
              : null,
          });
        }
      );
    });
  });
});

app.post("/family-links/:patientCode", requireStaff, enforceSessionPatientMatch, (req, res) => {
  const { patientCode } = req.params;
  const { related_patient_code, relationship } = req.body;

  if (!related_patient_code || !relationship) {
    return res.redirect(`/family-links/${patientCode}`);
  }

  db.get(`SELECT * FROM patients WHERE patient_code = ?`, [patientCode], (err, patient) => {
    if (err || !patient) return res.status(404).send("Patient not found.");

    db.get(
      `SELECT * FROM patients WHERE patient_code = ?`,
      [related_patient_code.trim().toUpperCase()],
      (err, related) => {
        if (err || !related) {
          return res.render("family-links.ejs", {
            title: `Family — ${patient.first_name} ${patient.last_name}`,
            patient,
            familyMembers: [],
            allPatients: [],
            error: `Patient code "${related_patient_code}" not found.`,
            success: null,
          });
        }

        if (patient.id === related.id) {
          return res.render("family-links.ejs", {
            title: `Family — ${patient.first_name} ${patient.last_name}`,
            patient,
            familyMembers: [],
            allPatients: [],
            error: "A patient cannot be linked to themselves.",
            success: null,
          });
        }

        const dupSql = `
          SELECT id FROM family_links
          WHERE (patient_id = ? AND related_patient_id = ?)
             OR (patient_id = ? AND related_patient_id = ?)
        `;

        db.get(dupSql, [patient.id, related.id, related.id, patient.id], (err, existing) => {
          if (existing) {
            return res.render("family-links.ejs", {
              title: `Family — ${patient.first_name} ${patient.last_name}`,
              patient,
              familyMembers: [],
              allPatients: [],
              error: `${related.first_name} ${related.last_name} is already linked.`,
              success: null,
            });
          }

          db.run(
            `
            INSERT INTO family_links (patient_id, related_patient_id, relationship)
            VALUES (?, ?, ?)
            `,
            [patient.id, related.id, relationship],
            (err) => {
              if (err) {
                console.error(err.message);
                return res.redirect(`/family-links/${patientCode}`);
              }

              logAuditEvent({
                req,
                actor_name: req.session.staffUser.full_name,
                actor_role: req.session.staffUser.role,
                patient_code: patient.patient_code,
                action_type: "FAMILY_LINK_ADDED",
                access_channel: "staff-portal",
                details: `Linked ${patient.patient_code} to ${related.patient_code} as ${relationship}`,
              });

              res.redirect(`/family-links/${patientCode}?added=1`);
            }
          );
        });
      }
    );
  });
});

app.post("/remove-family-link/:linkId", requireStaff, (req, res) => {
  const { linkId } = req.params;
  const { patientCode } = req.body;

  db.run(`DELETE FROM family_links WHERE id = ?`, [linkId], (err) => {
    if (err) console.error(err.message);

    logAuditEvent({
      req,
      actor_name: req.session.staffUser.full_name,
      actor_role: req.session.staffUser.role,
      patient_code: patientCode,
      action_type: "FAMILY_LINK_REMOVED",
      access_channel: "staff-portal",
      details: `Removed family link ID ${linkId}`,
    });

    res.redirect(`/family-links/${patientCode}?removed=1`);
  });
});

// ─────────────────────────────────────────────────────────────
// QR Scanner Page
// ─────────────────────────────────────────────────────────────
app.get("/scan-qr", requireStaff, requireNoActivePatientSession, (req, res) => {
  logAuditEvent({
    req,
    actor_name: req.session.staffUser.full_name,
    actor_role: req.session.staffUser.role,
    action_type: "SCAN_QR_PAGE_VIEW",
    access_channel: "staff-portal",
    details: "Opened in-app QR scanner page",
  });

  res.render("scan-qr.ejs", {
    title: "Scan QR Code",
  });
});

// ─────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  await startNgrok({ port: PORT, projectRoot: __dirname });
});
