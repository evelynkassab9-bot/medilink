function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function splitClinicalItems(value) {
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

function buildHereditaryNarrative(familyMembers = [], riskAssessment = null) {
  if (!familyMembers.length) {
    return "No linked family members are available, so hereditary analysis is limited.";
  }

  if (!riskAssessment || !riskAssessment.alert_count) {
    return `The patient has ${familyMembers.length} linked family member(s), but no strong hereditary cluster is currently detected.`;
  }

  const topAlerts = (riskAssessment.alerts || [])
    .slice()
    .sort((a, b) => (b.relative_count || 0) - (a.relative_count || 0))
    .slice(0, 2)
    .map((alert) => `${alert.condition} (${alert.level})`);

  if (!topAlerts.length) {
    return `The patient has ${familyMembers.length} linked family member(s), and hereditary review should continue as more records are connected.`;
  }

  return `Family history suggests attention to ${topAlerts.join(" and ")} across ${familyMembers.length} linked relative(s).`;
}

function evaluateVitals(vitals = []) {
  const latest = vitals[0] || null;
  const alerts = [];
  const trendNotes = [];

  if (!latest) {
    return {
      latest: null,
      alerts,
      trendNotes: ["No vital signs have been recorded yet."],
    };
  }

  const heartRate = Number(latest.heart_rate || 0);
  const oxygen = Number(latest.oxygen_saturation || 0);
  const temperature = Number(latest.temperature_c || 0);
  const systolic = Number(latest.systolic_bp || 0);
  const diastolic = Number(latest.diastolic_bp || 0);
  const respiratoryRate = Number(latest.respiratory_rate || 0);
  const glucose = Number(latest.glucose_mg_dl || 0);

  if (heartRate && (heartRate < 50 || heartRate > 120)) {
    alerts.push(`Latest heart rate is outside the typical monitoring range (${heartRate} bpm).`);
  }

  if (oxygen && oxygen < 92) {
    alerts.push(`Latest oxygen saturation is low (${oxygen}%).`);
  }

  if (temperature && temperature >= 38) {
    alerts.push(`Latest temperature indicates fever (${temperature.toFixed(1)}°C).`);
  }

  if (systolic && diastolic && (systolic >= 140 || diastolic >= 90)) {
    alerts.push(`Latest blood pressure is elevated (${systolic}/${diastolic} mmHg).`);
  }

  if (respiratoryRate && respiratoryRate > 24) {
    alerts.push(`Latest respiratory rate is elevated (${respiratoryRate} breaths/min).`);
  }

  if (glucose && glucose >= 180) {
    alerts.push(`Latest glucose reading is elevated (${glucose} mg/dL).`);
  }

  if (vitals.length >= 2) {
    const previous = vitals[1] || {};
    const previousHeartRate = Number(previous.heart_rate || 0);
    const previousOxygen = Number(previous.oxygen_saturation || 0);
    const previousTemperature = Number(previous.temperature_c || 0);

    if (heartRate && previousHeartRate && Math.abs(heartRate - previousHeartRate) >= 15) {
      trendNotes.push(`Heart rate changed noticeably from ${previousHeartRate} to ${heartRate} bpm.`);
    }

    if (oxygen && previousOxygen && oxygen < previousOxygen - 2) {
      trendNotes.push(`Oxygen saturation dropped from ${previousOxygen}% to ${oxygen}%.`);
    }

    if (temperature && previousTemperature && temperature > previousTemperature + 0.5) {
      trendNotes.push(`Temperature increased from ${previousTemperature.toFixed(1)}°C to ${temperature.toFixed(1)}°C.`);
    }
  }

  if (!trendNotes.length) {
    trendNotes.push("Recent vital signs are relatively stable compared with the previous reading.");
  }

  return {
    latest,
    alerts,
    trendNotes,
  };
}

function buildClinicalInsights(patient = {}, familyMembers = [], vitals = [], riskAssessment = null) {
  const age = calculateAge(patient.date_of_birth);
  const diagnosisItems = splitClinicalItems(patient.diagnosis);
  const chronicItems = splitClinicalItems(patient.chronic_conditions);
  const medicationItems = splitClinicalItems(patient.medications);
  const allergyItems = splitClinicalItems(patient.allergies);
  const riskFlags = splitClinicalItems(patient.risk_flags);
  const vitalsAnalysis = evaluateVitals(vitals);

  let careScore = 8;

  const priority = normalizeText(patient.priority_level || "medium");
  if (priority === "high") careScore += 28;
  else if (priority === "medium") careScore += 14;

  careScore += Math.min(chronicItems.length * 6, 24);
  careScore += Math.min(riskFlags.length * 5, 20);
  careScore += Math.min(allergyItems.length * 4, 12);
  careScore += Math.min(medicationItems.length * 2, 10);
  careScore += Math.min((riskAssessment?.hereditary_score || 0) * 2, 18);

  if (age !== null && age >= 65) careScore += 10;
  if (age !== null && age <= 12) careScore += 6;
  if (vitalsAnalysis.alerts.length) careScore += Math.min(vitalsAnalysis.alerts.length * 8, 24);

  careScore = Math.min(careScore, 100);

  let careBand = "low";
  if (careScore >= 70) careBand = "high";
  else if (careScore >= 40) careBand = "medium";

  const summaryParts = [];
  summaryParts.push(`${patient.first_name || "Patient"} ${patient.last_name || ""}`.trim());

  if (diagnosisItems.length) {
    summaryParts.push(`currently has documented issues including ${diagnosisItems.slice(0, 2).join(", ")}`);
  } else if (chronicItems.length) {
    summaryParts.push(`has ongoing chronic conditions such as ${chronicItems.slice(0, 2).join(", ")}`);
  } else {
    summaryParts.push("has limited structured diagnosis data in the current chart");
  }

  if (riskFlags.length) {
    summaryParts.push(`with active risk flags of ${riskFlags.slice(0, 2).join(", ")}`);
  }

  if (vitalsAnalysis.alerts.length) {
    summaryParts.push(`and recent monitoring alerts that need follow-up`);
  }

  const recommendations = [];
  const monitoringFocus = [];

  if (priority === "high") {
    recommendations.push("Maintain rapid-response readiness and ensure the emergency summary stays current.");
    monitoringFocus.push("Emergency readiness and escalation pathway");
  }

  if (chronicItems.length) {
    recommendations.push(`Review chronic disease management for ${chronicItems.slice(0, 2).join(" and ")}.`);
    monitoringFocus.push("Chronic condition follow-up");
  }

  if (allergyItems.length) {
    recommendations.push("Verify allergy reconciliation before prescribing or triage handoff.");
    monitoringFocus.push("Allergy safety checks");
  }

  if (riskAssessment?.alert_count) {
    recommendations.push("Use the hereditary risk review when planning screening and preventive follow-up.");
    monitoringFocus.push("Family-linked hereditary surveillance");
  }

  vitalsAnalysis.alerts.forEach((alert) => recommendations.push(alert));
  vitalsAnalysis.trendNotes.forEach((note) => monitoringFocus.push(note));

  if (!recommendations.length) {
    recommendations.push("Continue routine monitoring and keep the record updated after each visit.");
  }

  const emergencyRiskLabel = careBand === "high" ? "Elevated" : careBand === "medium" ? "Moderate" : "Baseline";

  return {
    generated_at: new Date().toISOString(),
    age,
    care_score: careScore,
    care_band: careBand,
    emergency_risk_label: emergencyRiskLabel,
    summary: `${summaryParts.join(" ")}.`,
    hereditary_story: buildHereditaryNarrative(familyMembers, riskAssessment),
    recommendations: Array.from(new Set(recommendations)).slice(0, 6),
    monitoring_focus: Array.from(new Set(monitoringFocus)).slice(0, 6),
    vitals_summary: vitalsAnalysis,
  };
}

module.exports = {
  calculateAge,
  buildClinicalInsights,
};
