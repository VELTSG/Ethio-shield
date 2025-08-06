/* =========================
   Ethio Shield (compiled)
   ========================= */

// ---------- Config: keywords ----------
const AMHARIC_KEYWORDS = [
  "ነፃ","በነፃ","ማግኘት","እንዲያገኙ","ይግቡ","መግባት","ይመዝገቡ","ይንቁ",
  "የሚጠፋ","አሁን","አስቸኳይ","የመለያ ማረጋገጫ","መክፈያ","የባንክ መለያ",
  "የካርድ ቁጥር","ይጫኑ","አስገባ","እዚህ ጠቅ ያድርጉ"
];
const EN_KEYWORDS = [
  "free","urgent","verify account","confirm password","update billing",
  "login now","click here","limited time","unlock","win","reset password",
  "security alert","suspend","reactivate","gift","prize"
];
const BRAND_CUES = [
  "ethiopian airlines","commercial bank of ethiopia","telebirr","ethio telecom",
  "dashen bank","bank of abyssinia","awash bank"
];

// ---------- Default allowlist (plus user-added) ----------
const DEFAULT_ALLOWLIST = new Set([
  "chat.openai.com","openai.com","www.google.com","accounts.google.com",
  "github.com","www.youtube.com","youtube.com","docs.google.com"
]);

// ---------- Heuristics ----------
function scoreUrl(hostname) {
  let s = 0;
  if ((hostname.match(/-/g) || []).length >= 2) s += 1.5;
  if (/[0-9]/.test(hostname)) s += 0.5;
  if (/[^\x00-\x7F]/.test(hostname)) s += 1.5;            // unicode/puny-looking
  if (hostname.split(".").slice(-2)[0].length <= 3) s += 0.5;
  if (/\b(login|secure|verify|update)\b/i.test(hostname)) s += 1;
  return s;
}

function getPageText() {
  const t = document.body ? (document.body.innerText || "") : "";
  return t.slice(0, 50000);
}
function countMatches(text, list) {
  let c = 0;
  const low = text.toLowerCase();
  for (const w of list) if (low.includes(w.toLowerCase())) c++;
  return c;
}

// Safer form scoring: only likely credential forms; cross-origin posts weigh more
function scoreForms() {
  let s = 0;
  const forms = document.querySelectorAll("form");
  for (const f of forms) {
    const pw = f.querySelector("input[type='password']");
    const userLike = f.querySelector("input[type='email'], input[name*='user'], input[name*='login']");
    if (!(pw || userLike)) continue; // ignore non-auth forms

    const action = (f.getAttribute("action") || "").trim();
    const isSameOrigin = !action || action.startsWith("/") || action.includes(location.hostname);
    if (!isSameOrigin) s += 1.0;   // possible credential exfil
    else s += 0.2;                 // tiny bump for auth-looking forms
  }
  return s;
}

// Safer text scoring: require multiple cues; cap brand weight on non-financial
const TEXT_BASE = 0.4;
const AMH_WEIGHT = 1.0;
const ENG_WEIGHT = 0.6;
const BRAND_WEIGHT = 0.8;
const FIN_HOST_HINT = /(bank|payment|pay|card|wallet|telebirr|finance|billing)/i;

function textScoreFromCounts(amh, eng, brands, hostname) {
  let brandsCapped = brands;
  const hostLooksFinancial = FIN_HOST_HINT.test(hostname);
  if (!hostLooksFinancial) brandsCapped = Math.min(brands, 1); // cap on non-financial hosts

  let score = 0;
  const signals = (amh > 0) + (eng > 0) + (brandsCapped > 0);
  if (signals >= 1) score += TEXT_BASE;
  if (amh >= 2) score += AMH_WEIGHT * Math.min(amh, 6) / 2;
  if (eng >= 2) score += ENG_WEIGHT * Math.min(eng, 6) / 2;
  if (brandsCapped >= 1) score += BRAND_WEIGHT * Math.min(brandsCapped, 4) / 2;
  return score;
}

async function getUserAllowlist() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ ethio_allow: [] }, (d) => resolve(new Set(d.ethio_allow || [])));
  });
}
async function addToUserAllowlist(hostname) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ ethio_allow: [] }, (d) => {
      const set = new Set(d.ethio_allow || []);
      set.add(hostname);
      chrome.storage.local.set({ ethio_allow: [...set] }, () => resolve(true));
    });
  });
}

// ---------- Risk ----------
function computeRiskRaw() {
  const hostname = location.hostname;
  const urlScore = scoreUrl(hostname);
  const text = getPageText();
  const amh = countMatches(text, AMHARIC_KEYWORDS);
  const eng = countMatches(text, EN_KEYWORDS);
  const brands = countMatches(text, BRAND_CUES);
  const textScore = textScoreFromCounts(amh, eng, brands, hostname);
  const formScore = scoreForms();
  let total = urlScore + textScore + formScore;
  if (total > 10) total = 10;

  const level = total >= 7 ? "High" : total >= 4 ? "Medium" : total >= 2 ? "Guarded" : "Low";
  return {
    total, level,
    breakdown: { urlScore, textScore, formScore, amh, eng, brands },
    sampleText: text.slice(0, 600)
  };
}

async function applyAllowlistAdjustments(risk) {
  const hostname = location.hostname;
  const userAllow = await getUserAllowlist();
  const trusted = userAllow.has(hostname) || DEFAULT_ALLOWLIST.has(hostname);
  if (trusted) {
    // So trusted sites don't look scary. Cap to Guarded max.
    risk.total = Math.min(risk.total, 3.5);
    risk.level = risk.total >= 2 ? (risk.total >= 3.5 ? "Guarded" : "Guarded") : "Low";
    risk.trusted = true;
  }
  return risk;
}

async function computeRisk() {
  const base = computeRiskRaw();
  return await applyAllowlistAdjustments(base);
}

// ---------- Storage (reports + history + theme) ----------
function saveReport(payload) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ phish_reports: [] }, (data) => {
      const arr = Array.isArray(data.phish_reports) ? data.phish_reports : [];
      arr.unshift(payload);
      chrome.storage.local.set({ phish_reports: arr.slice(0, 300) }, () => resolve(true));
    });
  });
}
function getReports() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ phish_reports: [] }, (d) => resolve(Array.isArray(d.phish_reports) ? d.phish_reports : []));
  });
}
function upsertScanHistory(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ scan_history: [] }, (data) => {
      let list = Array.isArray(data.scan_history) ? data.scan_history : [];
      const i = list.findIndex(x => x.hostname === entry.hostname);
      if (i >= 0) list[i] = entry; else list.unshift(entry);
      chrome.storage.local.set({ scan_history: list.slice(0, 150) }, () => resolve(list));
    });
  });
}
function getScanHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ scan_history: [] }, (d) => resolve(Array.isArray(d.scan_history) ? d.scan_history : []));
  });
}
function getTheme() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ ethio_theme: "light" }, (d) => resolve(d.ethio_theme || "light"));
  });
}
function setTheme(mode) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ ethio_theme: mode }, () => resolve(true));
  });
}

// ---------- Colors (calm palette) ----------
function colorsFor(level) {
  switch (level) {
    case "Low":     return { bg: "#e8fff1", text: "#0b5137", dot: "#2ecc71", icon: "👍" };
    case "Guarded": return { bg: "#eef7ff", text: "#0b3d91", dot: "#3fa7ff", icon: "🛡️" };
    case "Medium":  return { bg: "#fff7e0", text: "#7c5a00", dot: "#f1c40f", icon: "⚠️" };
    case "High":    return { bg: "#ffe6e6", text: "#7c1616", dot: "#e74c3c", icon: "❗" };
    default:        return { bg: "#eef7ff", text: "#0b3d91", dot: "#3fa7ff", icon: "🛡️" };
  }
}
const palette = {
  light: { surface: "rgba(255,255,255,0.95)", border: "rgba(0,0,0,0.18)", text: "#111",
           controlBg: "#ffffff", controlText: "#111", subtle: "#f6f6f6" },
  dark:  { surface: "rgba(22,22,22,0.92)", border: "rgba(255,255,255,0.22)", text: "#f2f2f2",
           controlBg: "#2a2a2a", controlText: "#f2f2f2", subtle: "#1f1f1f" }
};

// ---------- UI: pill (minimal) ----------
function ensurePill(logoUrl) {
  const id = "ethioshield-pill";
  let pill = document.getElementById(id);
  if (pill) return pill;

  pill = document.createElement("div");
  pill.id = id;
  Object.assign(pill.style, {
    position: "fixed",
    right: "12px",
    bottom: "12px",
    zIndex: 2147483647,
    fontFamily: "system-ui, Arial, sans-serif",
    fontSize: "13px",
    color: "#111",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    background: "rgba(255,255,255,0.95)",
    border: "1px solid rgba(0,0,0,0.1)",
    borderRadius: "999px",
    boxShadow: "0 6px 20px rgba(0,0,0,.15)",
    padding: "6px 10px",
    cursor: "pointer",
    backdropFilter: "saturate(180%) blur(8px)",
    userSelect: "none",
    maxWidth: "70vw"
  });

  // Optional logo in pill
  if (logoUrl) {
    const logo = document.createElement("img");
    logo.src = logoUrl;
    logo.alt = "Ethio Shield";
    Object.assign(logo.style, { width: "16px", height: "16px", borderRadius: "4px", flexShrink: "0" });
    pill.appendChild(logo);
  }

  const dot = document.createElement("span");
  Object.assign(dot.style, { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", flexShrink: "0" });

  const label = document.createElement("span");
  label.textContent = "Ethio Shield";
  label.style.fontWeight = "600";

  const chev = document.createElement("span");
  chev.textContent = "▸";
  chev.style.opacity = "0.7";

  pill.append(dot, label, chev);
  document.documentElement.appendChild(pill);
  pill.__dot = dot;
  pill.__chev = chev;
  return pill;
}

// ---------- UI: panel (expanded) ----------
function ensurePanel() {
  const id = "ethioshield-panel";
  let panel = document.getElementById(id);
  if (panel) return panel;

  panel = document.createElement("div");
  panel.id = id;
  Object.assign(panel.style, {
    position: "fixed",
    right: "12px",
    bottom: "56px",
    zIndex: 2147483647,
    width: "min(420px, 92vw)",
    maxHeight: "65vh",
    overflow: "auto",
    background: palette.light.surface,
    border: `1px solid ${palette.light.border}`,
    borderRadius: "14px",
    boxShadow: "0 12px 28px rgba(0,0,0,.22)",
    padding: "12px",
    display: "none",
    color: palette.light.text
  });

  // Badge
  const badge = document.createElement("div");
  Object.assign(badge.style, {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px", borderRadius: "12px", marginBottom: "8px",
    fontWeight: "700", fontSize: "16px"
  });
  const icon = document.createElement("span"); icon.style.fontSize = "18px";
  const badgeText = document.createElement("span");

  // Subline
  const sub = document.createElement("div");
  Object.assign(sub.style, { marginTop: "6px", fontSize: "12px", opacity: "0.9" });

  // Dropdown row
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px", alignItems: "center", margin: "10px 0" });

  const select = document.createElement("select");
  Object.assign(select.style, {
    flex: "1", padding: "8px", borderRadius: "10px",
    border: `1px solid ${palette.light.border}`, outline: "none",
    background: palette.light.controlBg, color: palette.light.controlText
  });

  // Details box
  const detailsBox = document.createElement("div");
  Object.assign(detailsBox.style, {
    padding: "10px", borderRadius: "10px",
    border: `1px solid ${palette.light.border}`,
    background: palette.light.subtle,
    fontSize: "12px", lineHeight: "1.4",
    display: "none", whiteSpace: "pre-wrap", color: palette.light.text
  });

  // Actions
  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" });

  function mkBtn(text) {
    const b = document.createElement("button");
    b.textContent = text;
    Object.assign(b.style, {
      padding: "8px 12px", borderRadius: "10px", cursor: "pointer", fontWeight: "600",
      border: `1px solid ${palette.light.border}`,
      background: palette.light.controlBg,
      color: palette.light.controlText
    });
    b.onmouseenter = () => b.style.filter = "brightness(0.96)";
    b.onmouseleave = () => b.style.filter = "none";
    return b;
  }

  const viewBtn   = mkBtn("View");
  const reportBtn = mkBtn("Report page");
  const reportsBtn= mkBtn("View reports");
  const trustBtn  = mkBtn("Mark this site safe"); // NEW
  const themeBtn  = mkBtn("Dark mode");
  const closeBtn  = mkBtn("Dismiss");

  const reportList = document.createElement("div");
  Object.assign(reportList.style, {
    marginTop: "8px", padding: "10px", borderRadius: "10px",
    border: `1px solid ${palette.light.border}`, background: palette.light.subtle,
    display: "none", maxHeight: "220px", overflow: "auto",
    fontSize: "12px", lineHeight: "1.4", color: palette.light.text
  });

  actions.append(viewBtn, reportBtn, reportsBtn, trustBtn, themeBtn, closeBtn);
  const badgeWrap = document.createElement("div");
  badgeWrap.append(badge, sub);
  badge.append(icon, badgeText);
  row.append(select);
  panel.append(badgeWrap, row, detailsBox, actions, reportList);
  document.documentElement.appendChild(panel);

  // Theme handling
  function applyTheme(mode) {
    const p = palette[mode];
    panel.style.background = p.surface; panel.style.borderColor = p.border; panel.style.color = p.text;
    select.style.background = p.controlBg; select.style.color = p.controlText; select.style.borderColor = p.border;
    [detailsBox, reportList].forEach(el => { el.style.background = p.subtle; el.style.color = p.text; el.style.borderColor = p.border; });
    [viewBtn, reportBtn, reportsBtn, trustBtn, themeBtn, closeBtn].forEach(b => {
      b.style.background = p.controlBg; b.style.color = p.controlText; b.style.borderColor = p.border;
    });
    themeBtn.textContent = mode === "light" ? "Dark mode" : "Light mode";
  }
  getTheme().then(applyTheme);

  panel.__applyTheme = applyTheme;
  panel.__refs = { badge, icon, badgeText, sub, select, detailsBox, viewBtn, reportBtn, reportsBtn, trustBtn, themeBtn, closeBtn, reportList };
  return panel;
}

// ---------- Dropdown population ----------
async function populateDropdown(select) {
  const list = await getScanHistory();
  select.innerHTML = "";
  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "No sites scanned yet";
    select.appendChild(opt); return;
  }
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.hostname;
    opt.textContent = `${item.hostname} — ${item.level}`;
    select.appendChild(opt);
  }
}

// ---------- Apply risk to UI ----------
async function applyRiskUI(risk) {
  const logoUrl = chrome.runtime.getURL("ui/logo.svg"); // or .png
  const pill = ensurePill(logoUrl);
  const panel = ensurePanel();
  const { badge, icon, badgeText, sub } = panel.__refs;

  // Minimal pill: color dot only
  const c = colorsFor(risk.level);
  pill.__dot.style.background = c.dot;

  // Badge
  badge.style.background = c.bg;
  badge.style.color = c.text;
  icon.textContent = c.icon;
  badgeText.textContent = `${risk.level} risk on this page${risk.trusted ? " — Trusted site" : ""}`;

  // Dynamic subline
  const b = risk.breakdown;
  sub.textContent = `URL ${b.urlScore.toFixed(1)} • Text ${b.textScore.toFixed(1)} • Forms ${b.formScore.toFixed(1)} → ${risk.total.toFixed(1)}/10`;

  // Save to history
  upsertScanHistory({
    hostname: location.hostname,
    url: location.href,
    total: risk.total,
    level: risk.level,
    breakdown: risk.breakdown,
    when: Date.now()
  });

  // Open/close behavior
  if (!pill.__wired) {
    pill.__wired = true;
    pill.addEventListener("click", async () => {
      const open = panel.style.display !== "block";
      panel.style.display = open ? "block" : "none";
      pill.__chev.textContent = open ? "▾" : "▸";
      if (open) populateDropdown(panel.__refs.select);
    });
  }

  const { select, detailsBox, viewBtn, reportBtn, reportsBtn, trustBtn, themeBtn, closeBtn, reportList } = panel.__refs;

  if (!panel.__actionsWired) {
    panel.__actionsWired = true;

    viewBtn.addEventListener("click", async () => {
      const val = select.value;
      if (!val) return;
      const list = await getScanHistory();
      const item = list.find(x => x.hostname === val);
      if (!item) return;
      const d = item.breakdown || {};
      detailsBox.style.display = "block";
      detailsBox.textContent =
`Host: ${item.hostname}
Last URL: ${item.url}
Risk: ${item.level} (${item.total?.toFixed ? item.total.toFixed(1) : item.total}/10)
URL: ${d.urlScore?.toFixed ? d.urlScore.toFixed(1) : d.urlScore} • Text: ${d.textScore?.toFixed ? d.textScore.toFixed(1) : d.textScore} • Forms: ${d.formScore?.toFixed ? d.formScore.toFixed(1) : d.formScore}
Amharic: ${d.amh} • English: ${d.eng} • Brands: ${d.brands}`;
    });

    reportBtn.addEventListener("click", async () => {
      const r = await computeRisk(); // include allowlist status in snapshot
      await saveReport({
        url: location.href,
        hostname: location.hostname,
        when: new Date().toISOString(),
        risk: r.total,
        level: r.level,
        breakdown: r.breakdown,
        sampleText: r.sampleText,
        trusted: !!r.trusted
      });
      reportBtn.textContent = "Reported ✓";
      reportBtn.disabled = true;
      setTimeout(() => { reportBtn.textContent = "Report page"; reportBtn.disabled = false; }, 1500);
    });

    reportsBtn.addEventListener("click", async () => {
      if (reportList.style.display !== "block") {
        const all = await getReports();
        reportList.style.display = "block";
        reportList.innerHTML = "";
        if (!all.length) {
          reportList.textContent = "No reports yet.";
        } else {
          const theme = await getTheme();
          const border = theme === "light" ? palette.light.border : palette.dark.border;
          for (const r of all) {
            const row = document.createElement("div");
            row.style.padding = "6px 0";
            row.style.borderBottom = `1px solid ${border}`;
            const a = document.createElement("a");
            a.href = r.url; a.target = "_blank"; a.textContent = r.url;
            a.style.textDecoration = "underline";
            a.style.color = "inherit";
            row.appendChild(a);
            const meta = document.createElement("div");
            meta.textContent = `${new Date(r.when).toLocaleString()} — ${r.level} (${r.risk?.toFixed ? r.risk.toFixed(1) : r.risk}/10)${r.trusted ? " • Trusted" : ""}`;
            meta.style.opacity = "0.85"; meta.style.fontSize = "11.5px";
            row.appendChild(meta);
            reportList.appendChild(row);
          }
        }
      } else {
        reportList.style.display = "none";
      }
    });

    trustBtn.addEventListener("click", async () => {
      await addToUserAllowlist(location.hostname);
      trustBtn.textContent = "Marked safe ✓";
      trustBtn.disabled = true;
      // Recompute to reflect new trust
      const updated = await computeRisk();
      await applyRiskUI(updated);
    });

    themeBtn.addEventListener("click", async () => {
      const cur = await getTheme();
      const next = cur === "light" ? "dark" : "light";
      await setTheme(next);
      panel.__applyTheme(next);
    });

    closeBtn.addEventListener("click", () => {
      panel.style.display = "none";
      pill.__chev.textContent = "▸";
    });
  }
}

// ---------- Run & observe ----------
async function scanAndRender() {
  try {
    const risk = await computeRisk();
    await applyRiskUI(risk);
  } catch (e) {
    // console.error("Ethio Shield error:", e);
  }
}
scanAndRender();

const obs = new MutationObserver(() => {
  clearTimeout(window.__ethioshield_t);
  window.__ethioshield_t = setTimeout(scanAndRender, 400);
});
obs.observe(document.documentElement, { childList: true, subtree: true });
  