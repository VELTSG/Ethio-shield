// ======= Config: keywords & weights =======
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

// ======= URL heuristics =======
function scoreUrl(hostname) {
  let s = 0;
  if ((hostname.match(/-/g) || []).length >= 2) s += 1.5;
  if (/[0-9]/.test(hostname)) s += 0.5;
  if (/[^\x00-\x7F]/.test(hostname)) s += 1.5;
  if (hostname.split(".").slice(-2)[0].length <= 3) s += 0.5;
  if (/\b(login|secure|verify|update)\b/i.test(hostname)) s += 1;
  return s;
}

// ======= Text & forms =======
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
function scoreForms() {
  let s = 0;
  const forms = Array.from(document.querySelectorAll("form"));
  for (const f of forms) {
    const inputs = Array.from(f.querySelectorAll("input[type='password'], input[type='email'], input[type='text']"));
    if (inputs.length >= 2) s += 0.5;
    const action = (f.getAttribute("action") || "").trim();
    if (action && !action.startsWith("/") && !action.includes(location.hostname)) s += 1.0;
  }
  return s;
}

// ======= Risk =======
function computeRisk() {
  const hostname = location.hostname;
  const urlScore = scoreUrl(hostname);
  const text = getPageText();
  const amh = countMatches(text, AMHARIC_KEYWORDS);
  const eng = countMatches(text, EN_KEYWORDS);
  const brands = countMatches(text, BRAND_CUES);
  const textScore = amh * 1.2 + eng * 0.8 + brands * 1.0;
  const formScore = scoreForms();
  let total = urlScore + textScore + formScore;
  if (total > 10) total = 10;

  const level = total >= 7 ? "High" : total >= 4 ? "Medium" : total >= 2 ? "Guarded" : "Low";
  return {
    total,
    level,
    breakdown: { urlScore, textScore, formScore, amh, eng, brands },
    sampleText: text.slice(0, 600)
  };
}

// ======= Storage helpers (reports + history) =======
function saveReport(payload) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ phish_reports: [] }, (data) => {
      const arr = Array.isArray(data.phish_reports) ? data.phish_reports : [];
      arr.unshift(payload);
      chrome.storage.local.set({ phish_reports: arr.slice(0, 200) }, () => resolve(true));
    });
  });
}

function upsertScanHistory(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get({ scan_history: [] }, (data) => {
      let list = Array.isArray(data.scan_history) ? data.scan_history : [];
      // upsert by hostname
      const i = list.findIndex(x => x.hostname === entry.hostname);
      if (i >= 0) list[i] = entry; else list.unshift(entry);
      list = list.slice(0, 100);
      chrome.storage.local.set({ scan_history: list }, () => resolve(list));
    });
  });
}
function getScanHistory() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ scan_history: [] }, (data) => resolve(Array.isArray(data.scan_history) ? data.scan_history : []));
  });
}

// ======= UI (Bottom-right pill + expandable panel) =======
function ensureUI() {
  const id = "ethioshield-pill";
  let pill = document.getElementById(id);
  if (pill) return pill;

  // Pill (minimal)
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

  const dot = document.createElement("span");
  Object.assign(dot.style, { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block", flexShrink: "0" });

  const label = document.createElement("span");
  label.textContent = "Ethio Shield";
  label.style.fontWeight = "600";

  const chev = document.createElement("span");
  chev.textContent = "▸";
  chev.style.opacity = "0.7";

  // Panel
  const panel = document.createElement("div");
  panel.id = "ethioshield-panel";
  Object.assign(panel.style, {
    position: "fixed",
    right: "12px",
    bottom: "56px",
    zIndex: 2147483647,
    width: "min(420px, 92vw)",
    maxHeight: "65vh",
    overflow: "auto",
    background: "#ffffff",
    border: "1px solid rgba(0,0,0,0.12)",
    borderRadius: "14px",
    boxShadow: "0 12px 28px rgba(0,0,0,.22)",
    padding: "12px",
    display: "none"
  });

  // Top badge (big risk + icon)
  const badge = document.createElement("div");
  Object.assign(badge.style, {
    display: "flex", alignItems: "center", gap: "10px",
    padding: "12px", borderRadius: "12px", marginBottom: "10px",
    fontWeight: "700", fontSize: "16px"
  });
  const icon = document.createElement("span"); // 👍 ⚠️ ❗
  icon.style.fontSize = "18px";
  const badgeText = document.createElement("span");

  // Dropdown (sites scanned)
  const row = document.createElement("div");
  Object.assign(row.style, { display: "flex", gap: "8px", alignItems: "center", marginBottom: "8px" });

  const select = document.createElement("select");
  Object.assign(select.style, { flex: "1", padding: "6px", borderRadius: "8px", border: "1px solid #ddd", background: "#fff" });
  const viewBtn = document.createElement("button");
  viewBtn.textContent = "View";
  Object.assign(viewBtn.style, { padding: "6px 10px", border: "1px solid #ccc", background: "#fff", borderRadius: "8px", cursor: "pointer" });

  // Details area (collapsed info – not overwhelming)
  const detailsBox = document.createElement("div");
  Object.assign(detailsBox.style, {
    padding: "10px",
    borderRadius: "10px",
    background: "#fafafa",
    border: "1px solid #eee",
    fontSize: "12px",
    lineHeight: "1.4",
    color: "#333",
    display: "none", // hidden until "View" is clicked
    whiteSpace: "pre-wrap"
  });

  // Action row
  const actions = document.createElement("div");
  Object.assign(actions.style, { display: "flex", gap: "8px", marginTop: "10px" });

  const reportBtn = document.createElement("button");
  reportBtn.textContent = "Report page";
  Object.assign(reportBtn.style, { padding: "6px 10px", border: "1px solid #ccc", background: "#fff", borderRadius: "8px", cursor: "pointer" });

  const closeBtn = document.createElement("button");
  closeBtn.textContent = "Dismiss";
  Object.assign(closeBtn.style, { padding: "6px 10px", border: "1px solid #ccc", background: "#fff", borderRadius: "8px", cursor: "pointer" });

  row.append(select, viewBtn);
  actions.append(reportBtn, closeBtn);
  panel.append(badge, row, detailsBox, actions);

  pill.append(dot, label, chev);
  document.documentElement.appendChild(pill);
  document.documentElement.appendChild(panel);

  // Behavior
  let open = false;
  pill.addEventListener("click", async () => {
    open = !open;
    panel.style.display = open ? "block" : "none";
    chev.textContent = open ? "▾" : "▸";
    if (open) populateDropdown(select); // refresh history when opened
  });
  closeBtn.addEventListener("click", () => {
    panel.style.display = "none";
    open = false;
    chev.textContent = "▸";
  });

  // Keep references
  pill.__dot = dot;
  pill.__panel = panel;
  pill.__badge = badge;
  pill.__badgeText = badgeText;
  pill.__badgeIcon = icon;
  pill.__select = select;
  pill.__viewBtn = viewBtn;
  pill.__details = detailsBox;
  pill.__reportBtn = reportBtn;

  // Insert badge children
  badge.append(icon, badgeText);

  // View button behavior
  viewBtn.addEventListener("click", async () => {
    const val = select.value;
    if (!val) return;
    const list = await getScanHistory();
    const item = list.find(x => x.hostname === val);
    if (!item) return;
    detailsBox.style.display = "block";
    const b = item.breakdown || {};
    detailsBox.textContent =
`Host: ${item.hostname}
Last URL: ${item.url}
Risk: ${item.level} (${item.total?.toFixed ? item.total.toFixed(1) : item.total}/10)
URL Score: ${b.urlScore?.toFixed ? b.urlScore.toFixed(1) : b.urlScore} | Text: ${b.textScore?.toFixed ? b.textScore.toFixed(1) : b.textScore} | Forms: ${b.formScore?.toFixed ? b.formScore.toFixed(1) : b.formScore}
Amharic: ${b.amh} | English: ${b.eng} | Brands: ${b.brands}`;
  });

  // Report current page
  reportBtn.addEventListener("click", async () => {
    const risk = computeRisk();
    await saveReport({
      url: location.href,
      hostname: location.hostname,
      when: new Date().toISOString(),
      risk: risk.total,
      level: risk.level,
      breakdown: risk.breakdown,
      sampleText: risk.sampleText
    });
    reportBtn.textContent = "Reported ✓";
    reportBtn.disabled = true;
    setTimeout(() => { reportBtn.textContent = "Report page"; reportBtn.disabled = false; }, 1500);
  });

  return pill;
}

async function populateDropdown(select) {
  const list = await getScanHistory();
  select.innerHTML = "";
  if (!list.length) {
    const opt = document.createElement("option");
    opt.value = ""; opt.textContent = "No sites scanned yet";
    select.appendChild(opt);
    return;
  }
  for (const item of list) {
    const opt = document.createElement("option");
    opt.value = item.hostname;
    opt.textContent = `${item.hostname} — ${item.level}`;
    select.appendChild(opt);
  }
}

// Color systems for badge & dot
function colorsFor(level) {
  switch (level) {
    case "Low":     return { bg: "#e8fff1", text: "#0b5137", dot: "#2ecc71", icon: "👍" };
    case "Guarded": return { bg: "#eef7ff", text: "#0b3d91", dot: "#3fa7ff", icon: "🛡️" };
    case "Medium":  return { bg: "#fffbe6", text: "#7c5a00", dot: "#f1c40f", icon: "⚠️" };
    case "High":    return { bg: "#ffecec", text: "#7c1616", dot: "#e74c3c", icon: "❗" };
    default:        return { bg: "#eef7ff", text: "#0b3d91", dot: "#3fa7ff", icon: "🛡️" };
  }
}

function applyRiskUI(risk) {
  const pill = ensureUI();
  const { __dot: dot, __panel: panel, __badge: badge, __badgeText: badgeText, __badgeIcon: icon } = pill;

  // Minimal view: color dot only
  const c = colorsFor(risk.level);
  dot.style.background = c.dot;

  // Expanded: big badge with color + icon + simple label only
  badge.style.background = c.bg;
  badge.style.color = c.text;
  icon.textContent = c.icon;
  badgeText.textContent = `${risk.level} risk on this page`;

  // Save to history (hostname-level)
  upsertScanHistory({
    hostname: location.hostname,
    url: location.href,
    total: risk.total,
    level: risk.level,
    breakdown: risk.breakdown,
    when: Date.now()
  });
}

// ======= Run & observe =======
function scanAndRender() {
  try {
    const risk = computeRisk();
    applyRiskUI(risk);
  } catch {}
}
scanAndRender();

const obs = new MutationObserver(() => {
  clearTimeout(window.__ethioshield_t);
  window.__ethioshield_t = setTimeout(scanAndRender, 400);
});
obs.observe(document.documentElement, { childList: true, subtree: true });
