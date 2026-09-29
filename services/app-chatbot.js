function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatList(items = []) {
  const cleaned = items.filter(Boolean);
  if (!cleaned.length) return "";
  if (cleaned.length === 1) return cleaned[0];
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(", ")}, and ${cleaned[cleaned.length - 1]}`;
}

function splitItems(value) {
  return String(value || "")
    .split(/[\n,;|]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return null;

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;

  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDifference = now.getMonth() - dob.getMonth();

  if (monthDifference < 0 || (monthDifference === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }

  return age;
}

function getPageLabel(pathname = "") {
  const path = String(pathname || "").trim();

  if (!path || path === "/") return "Home";
  if (path.startsWith("/login")) return "Staff Login";
  if (path.startsWith("/patient-access")) return "Patient Access";
  if (path.startsWith("/patient-login")) return "Staff Login";
  if (path.startsWith("/patient-portal")) return "My Medical Record";
  if (path.startsWith("/patient-qr")) return "Patient QR Card";
  if (path.startsWith("/dashboard")) return "Dashboard";
  return "Current Page";
}

function getAvailableDataSections(patientData, familyMembers = [], recentVitals = []) {
  if (!patientData) return [];

  const sections = [];
  const sectionDefinitions = [
    { label: "identity details", values: [patientData.first_name, patientData.last_name, patientData.patient_code, patientData.national_id] },
    { label: "contact details", values: [patientData.address, patientData.email, patientData.phone, patientData.emergency_contact_name, patientData.emergency_contact_phone] },
    { label: "clinical summary", values: [patientData.diagnosis, patientData.chronic_conditions, patientData.notes] },
    { label: "medication history", values: [patientData.medications] },
    { label: "allergy information", values: [patientData.allergies] },
    { label: "emergency notes", values: [patientData.emergency_summary, patientData.risk_flags, patientData.priority_level] },
    { label: "visit details", values: [patientData.last_visit_date, patientData.doctor_name] },
  ];

  sectionDefinitions.forEach((section) => {
    if (section.values.some((value) => String(value || "").trim())) {
      sections.push(section.label);
    }
  });

  if (familyMembers.length) {
    sections.push("family links");
  }

  if (recentVitals.length) {
    sections.push("recent vital signs");
  }

  return sections;
}

function buildVitalsSummary(recentVitals = []) {
  const latest = recentVitals[0];
  if (!latest) return null;

  const items = [];
  if (latest.systolic_bp && latest.diastolic_bp) items.push(`blood pressure ${latest.systolic_bp}/${latest.diastolic_bp} mmHg`);
  if (latest.heart_rate) items.push(`heart rate ${latest.heart_rate} bpm`);
  if (latest.oxygen_saturation) items.push(`oxygen ${latest.oxygen_saturation}%`);
  if (latest.temperature_c) items.push(`temperature ${latest.temperature_c}°C`);
  if (latest.respiratory_rate) items.push(`respiratory rate ${latest.respiratory_rate}/min`);
  if (latest.glucose_mg_dl) items.push(`glucose ${latest.glucose_mg_dl} mg/dL`);

  if (!items.length) return null;

  const recordedAt = latest.created_at ? ` recorded on ${String(latest.created_at).slice(0, 16).replace("T", " ")}` : "";
  return `Latest recorded update${recordedAt}: ${formatList(items)}.`;
}

function buildPatientSummary(patientData, familyMembers = [], recentVitals = []) {
  if (!patientData) {
    return "No patient record is open yet. Sign in with your patient ID or national ID and password to view your medical record.";
  }

  const identity = `${patientData.first_name || "Patient"} ${patientData.last_name || ""}`.trim();
  const baseParts = [`Record for ${identity}`, `code ${patientData.patient_code || "N/A"}`];

  if (patientData.blood_type) {
    baseParts.push(`blood type ${patientData.blood_type}`);
  }

  if (patientData.priority_level) {
    baseParts.push(`priority ${String(patientData.priority_level).toUpperCase()}`);
  }

  const diagnosisItems = splitItems(patientData.diagnosis);
  const allergyItems = splitItems(patientData.allergies);
  const medicationItems = splitItems(patientData.medications);
  const chronicItems = splitItems(patientData.chronic_conditions);
  const sections = getAvailableDataSections(patientData, familyMembers, recentVitals);
  const age = calculateAge(patientData.date_of_birth);
  const extras = [];

  if (age !== null) {
    extras.push(`age ${age}`);
  }

  if (diagnosisItems.length) {
    extras.push(`diagnosis ${formatList(diagnosisItems.slice(0, 3))}`);
  }

  if (allergyItems.length) {
    extras.push(`allergies ${formatList(allergyItems.slice(0, 3))}`);
  }

  if (medicationItems.length) {
    extras.push(`medications ${formatList(medicationItems.slice(0, 3))}`);
  }

  if (chronicItems.length) {
    extras.push(`chronic conditions ${formatList(chronicItems.slice(0, 3))}`);
  }

  if (familyMembers.length) {
    extras.push(`${familyMembers.length} linked family member(s)`);
  }

  let summary = `${baseParts.join(" · ")}.`;

  if (extras.length) {
    summary += ` Available context includes ${formatList(extras)}.`;
  }

  if (sections.length) {
    summary += ` I can help you review ${formatList(sections)}.`;
  }

  const vitalsSummary = buildVitalsSummary(recentVitals);
  if (vitalsSummary) {
    summary += ` ${vitalsSummary}`;
  }

  return summary;
}

function buildLoginReply() {
  return {
    reply:
      "The login flow is staff login first, then patient authentication from Patient Access, and then the read-only medical record opens with the assistant available for search, summaries, and explanations.",
    suggestions: ["Explain current page", "Summarize my record", "Show important information"],
  };
}

function buildCapabilitiesReply(patientData, familyMembers, recentVitals) {
  const sections = getAvailableDataSections(patientData, familyMembers, recentVitals);
  const dataSentence = sections.length
    ? ` I can currently work with ${formatList(sections)} from your record.`
    : " After you sign in, I can use the data available in your record.";

  return {
    reply:
      "I can help you search your record using natural language, generate concise summaries, explain fields and statuses in simple language, guide you to the right page, and highlight missing or important information. I can also provide limited informational insights about patterns or unusual values already present in the system data. I do not provide medical diagnosis, treatment recommendations, or professional medical advice." +
      dataSentence,
    suggestions: ["Explain current page", "Summarize my record", "Show available record data"],
  };
}

function buildNavigationReply(pathname, patientData) {
  const pageLabel = getPageLabel(pathname);

  if (pageLabel === "Staff Login") {
    return {
      reply: "You are on the Staff Login page. Staff signs in first, then patient authentication is completed from Patient Access before the record opens.",
      suggestions: ["What can you do", "Explain current page", "Show important information"],
    };
  }

  if (pageLabel === "Patient Access") {
    return {
      reply: "You are on Patient Access. This is the supervised step where staff authenticates the patient before opening the read-only medical record.",
      suggestions: ["What can you do", "Explain current page", "Show important information"],
    };
  }

  if (pageLabel === "My Medical Record") {
    const patientHint = patientData
      ? ` You are viewing the record for ${patientData.first_name} ${patientData.last_name} (${patientData.patient_code}).`
      : "";

    return {
      reply:
        `You are on ${pageLabel}.${patientHint} You can review the record sections on this page, ask me to summarize data, explain terms, or highlight important and missing information.`,
      suggestions: ["Summarize my record", "Show important information", "Show available record data"],
    };
  }

  return {
    reply: `You are on ${pageLabel}. Ask me if you want help understanding this page or finding the most relevant information in your record.`,
    suggestions: ["Explain current page", "What can you do", "Show important information"],
  };
}

function buildFieldExplanationReply(query) {
  const q = normalizeText(query);
  const explanations = [
    {
      matches: ["priority", "priority level"],
      reply:
        "Priority level is a system label used to mark how urgent or important the record should be treated inside the application. It is informational and should not be interpreted as a diagnosis or treatment plan.",
    },
    {
      matches: ["risk flag", "risk flags"],
      reply:
        "Risk flags are short record markers used to highlight important issues already documented in the system, such as allergies, chronic conditions, or emergency concerns. They are informational reminders, not medical advice.",
    },
    {
      matches: ["diagnosis"],
      reply:
        "Diagnosis is the condition or problem documented in the record by the healthcare team. I can explain the field itself, but I do not diagnose or give treatment advice.",
    },
    {
      matches: ["allergy", "allergies"],
      reply:
        "Allergies lists substances that have been recorded as causing an allergic reaction or concern for this patient.",
    },
    {
      matches: ["medication", "medications"],
      reply:
        "Medications shows the medicines already recorded in the system for this patient record.",
    },
    {
      matches: ["chronic", "chronic condition"],
      reply:
        "Chronic conditions are long-term health conditions documented in the record.",
    },
    {
      matches: ["emergency summary"],
      reply:
        "Emergency summary is a short record note intended to surface urgent background information that may matter during emergency access.",
    },
    {
      matches: ["read-only"],
      reply:
        "Read-only means you can view the information in the record but cannot change or delete it from this portal.",
    },
    {
      matches: ["patient code", "patient id"],
      reply:
        "Patient code is the internal identifier used by the application to locate the correct record.",
    },
  ];

  const matched = explanations.find((item) => item.matches.some((keyword) => q.includes(keyword)));
  return matched || null;
}

function buildImportantHighlights(patientData, recentVitals = []) {
  if (!patientData) {
    return ["Sign in first to view record highlights."];
  }

  const highlights = [];

  if (patientData.priority_level) {
    highlights.push(`priority is marked as ${String(patientData.priority_level).toUpperCase()}`);
  }

  if (patientData.risk_flags) {
    highlights.push(`risk flags: ${patientData.risk_flags}`);
  }

  if (patientData.allergies) {
    highlights.push(`allergies recorded: ${patientData.allergies}`);
  }

  if (patientData.emergency_summary) {
    highlights.push(`emergency summary available`);
  }

  const latest = recentVitals[0];
  if (latest) {
    if (latest.oxygen_saturation && Number(latest.oxygen_saturation) < 92) highlights.push(`latest oxygen saturation is ${latest.oxygen_saturation}%`);
    if (latest.temperature_c && Number(latest.temperature_c) >= 38) highlights.push(`latest temperature is ${latest.temperature_c}°C`);
    if (latest.systolic_bp && Number(latest.systolic_bp) >= 140) highlights.push(`latest systolic blood pressure is ${latest.systolic_bp} mmHg`);
    if (latest.diastolic_bp && Number(latest.diastolic_bp) >= 90) highlights.push(`latest diastolic blood pressure is ${latest.diastolic_bp} mmHg`);
    if (latest.heart_rate && (Number(latest.heart_rate) < 60 || Number(latest.heart_rate) > 100)) highlights.push(`latest heart rate is ${latest.heart_rate} bpm`);
    if (latest.glucose_mg_dl && (Number(latest.glucose_mg_dl) < 70 || Number(latest.glucose_mg_dl) > 180)) highlights.push(`latest glucose is ${latest.glucose_mg_dl} mg/dL`);
  }

  return highlights;
}

function buildMissingDataReply(patientData) {
  if (!patientData) {
    return {
      reply: "No patient record is open yet. Sign in first so I can review missing or incomplete information.",
      suggestions: ["Explain current page", "What can you do", "Show important information"],
    };
  }

  const missing = [];
  const fields = [
    ["address", patientData.address],
    ["phone number", patientData.phone],
    ["email", patientData.email],
    ["emergency contact name", patientData.emergency_contact_name],
    ["emergency contact phone", patientData.emergency_contact_phone],
    ["diagnosis", patientData.diagnosis],
    ["allergies", patientData.allergies],
    ["medications", patientData.medications],
    ["doctor", patientData.doctor_name],
    ["last visit date", patientData.last_visit_date],
  ];

  fields.forEach(([label, value]) => {
    if (!String(value || "").trim()) {
      missing.push(label);
    }
  });

  const important = buildImportantHighlights(patientData).slice(0, 4);
  const parts = [];

  if (missing.length) {
    parts.push(`Missing or incomplete fields include ${formatList(missing.slice(0, 6))}.`);
  } else {
    parts.push("The main patient record fields shown in this portal appear to be filled in.");
  }

  if (important.length) {
    parts.push(`Important highlights already present in the record: ${formatList(important)}.`);
  }

  parts.push("These highlights are informational only and should not be treated as diagnosis or treatment advice.");

  return {
    reply: parts.join(" "),
    suggestions: ["Summarize my record", "Show available record data", "Explain current page"],
  };
}

function buildInsightReply(patientData, recentVitals = []) {
  if (!patientData) {
    return {
      reply: "No patient record is open yet. Sign in first so I can review informational insights from the available system data.",
      suggestions: ["Explain current page", "What can you do", "Summarize my record"],
    };
  }

  const highlights = buildImportantHighlights(patientData, recentVitals);

  if (!highlights.length) {
    return {
      reply:
        "I do not see any standout informational highlights from the currently loaded record data. If more record details or recent vitals are added, I can summarize them here. This feature is informational only and does not provide medical advice.",
      suggestions: ["Summarize my record", "Show available record data", "Explain current page"],
    };
  }

  return {
    reply:
      `Informational insight from the current system data: ${formatList(highlights.slice(0, 6))}. This is a high-level record highlight only and not medical advice, diagnosis, or treatment guidance.`,
    suggestions: ["Show important information", "Summarize my record", "Show available record data"],
  };
}

function buildPatientFieldReply(query, patientData, familyMembers = [], recentVitals = []) {
  if (!patientData) {
    return {
      reply: "No patient record is open right now. Sign in first so I can answer questions about your medical record.",
      suggestions: ["Explain current page", "What can you do", "Show important information"],
    };
  }

  const q = normalizeText(query);
  const termExplanation = buildFieldExplanationReply(query);
  if (termExplanation && (q.includes("what") || q.includes("mean") || q.includes("explain") || q.includes("status") || q.includes("field"))) {
    return {
      reply: termExplanation.reply,
      suggestions: ["Summarize my record", "Show important information", "Show available record data"],
    };
  }

  const fieldChecks = [
    {
      matches: ["diagnosis", "condition", "clinical summary"],
      reply: patientData.diagnosis
        ? `Current diagnosis details: ${patientData.diagnosis}.`
        : "There is no diagnosis text available in the current record.",
    },
    {
      matches: ["allergy", "allergies"],
      reply: patientData.allergies
        ? `Recorded allergies: ${patientData.allergies}.`
        : "No allergy information is currently recorded.",
    },
    {
      matches: ["medication", "medications", "medicine", "drug"],
      reply: patientData.medications
        ? `Recorded medications: ${patientData.medications}.`
        : "No medication information is currently recorded.",
    },
    {
      matches: ["risk", "risk flag", "priority", "emergency"],
      reply:
        patientData.risk_flags || patientData.priority_level || patientData.emergency_summary
          ? `Important record context: priority ${String(patientData.priority_level || "medium").toUpperCase()}, risk flags ${patientData.risk_flags || "None"}, emergency summary ${patientData.emergency_summary || "No emergency summary available."}`
          : "No emergency note details are currently available.",
    },
    {
      matches: ["family", "relative", "hereditary"],
      reply: familyMembers.length
        ? `There are ${familyMembers.length} linked family member(s) in this record.`
        : "No linked family members are currently available.",
    },
    {
      matches: ["vital", "vitals", "blood pressure", "heart rate", "oxygen", "temperature", "glucose", "recent", "latest", "update"],
      reply: buildVitalsSummary(recentVitals) || "No recent vital signs are currently available for this patient.",
    },
    {
      matches: ["contact", "phone", "address", "email"],
      reply:
        patientData.address || patientData.email || patientData.emergency_contact_name || patientData.emergency_contact_phone
          ? `Available contact details: address ${patientData.address || "N/A"}; email ${patientData.email || "N/A"}; emergency contact ${patientData.emergency_contact_name || "N/A"}; emergency phone ${patientData.emergency_contact_phone || "N/A"}.`
          : "No contact details are currently available.",
    },
    {
      matches: ["age", "dob", "date of birth", "birth"],
      reply: patientData.date_of_birth
        ? `Date of birth: ${patientData.date_of_birth}. Age: ${calculateAge(patientData.date_of_birth) ?? "N/A"}.`
        : "Date of birth is not currently available.",
    },
  ];

  const matched = fieldChecks.find((item) => item.matches.some((keyword) => q.includes(keyword)));
  if (matched) {
    return {
      reply: matched.reply,
      suggestions: ["Summarize my record", "Show available record data", "Show important information"],
    };
  }

  return {
    reply: buildPatientSummary(patientData, familyMembers, recentVitals),
    suggestions: ["Show available record data", "Show important information", "Explain current page"],
  };
}

function createAssistantReply({ message, pathname, patientData, familyMembers = [], recentVitals = [] }) {
  const query = String(message || "").trim();
  const normalizedQuery = normalizeText(query);

  if (!normalizedQuery) {
    return {
      reply:
        "Ask me to summarize your record, explain a field or status, help you navigate the page, or highlight important or missing information from the data currently available in MediLink.",
      suggestions: ["Explain current page", "Summarize my record", "Show important information"],
    };
  }

  if (normalizedQuery.includes("login") || normalizedQuery.includes("workflow") || normalizedQuery.includes("flow")) {
    return buildLoginReply();
  }

  if (
    normalizedQuery.includes("what can you do") ||
    normalizedQuery.includes("help") ||
    normalizedQuery.includes("capabilities")
  ) {
    return buildCapabilitiesReply(patientData, familyMembers, recentVitals);
  }

  if (
    normalizedQuery.includes("current page") ||
    normalizedQuery.includes("where am i") ||
    normalizedQuery.includes("where to go") ||
    normalizedQuery.includes("navigate")
  ) {
    return buildNavigationReply(pathname, patientData);
  }

  if (
    normalizedQuery.includes("missing") ||
    normalizedQuery.includes("incomplete") ||
    normalizedQuery.includes("important information") ||
    normalizedQuery.includes("important") ||
    normalizedQuery.includes("highlight")
  ) {
    return buildMissingDataReply(patientData);
  }

  if (
    normalizedQuery.includes("insight") ||
    normalizedQuery.includes("trend") ||
    normalizedQuery.includes("pattern") ||
    normalizedQuery.includes("anomal")
  ) {
    return buildInsightReply(patientData, recentVitals);
  }

  if (
    normalizedQuery.includes("patient") ||
    normalizedQuery.includes("record") ||
    normalizedQuery.includes("summary") ||
    normalizedQuery.includes("diagnosis") ||
    normalizedQuery.includes("allerg") ||
    normalizedQuery.includes("medication") ||
    normalizedQuery.includes("risk") ||
    normalizedQuery.includes("vital") ||
    normalizedQuery.includes("family") ||
    normalizedQuery.includes("contact") ||
    normalizedQuery.includes("age") ||
    normalizedQuery.includes("field") ||
    normalizedQuery.includes("status") ||
    normalizedQuery.includes("mean") ||
    normalizedQuery.includes("explain")
  ) {
    return buildPatientFieldReply(query, patientData, familyMembers, recentVitals);
  }

  return {
    reply:
      `I am the MediLink assistant for this patient portal. You are on ${getPageLabel(pathname)}. ` +
      buildPatientSummary(patientData, familyMembers, recentVitals),
    suggestions: ["Explain current page", "Summarize my record", "Show important information"],
  };
}

module.exports = {
  createAssistantReply,
};
