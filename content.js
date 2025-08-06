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
  for (const w of list) if (text.toLowerCase().includes(w.toLowerCase())) c++;
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
  return { total, breakdown: { urlScore, textScore, formScore, amh, eng, brands }, sampleText: text.slice(0, 800) };
}

// ======= Banner UI =======
function ensureBanner() {
  const id = "phishshield-banner";
  let bar = document.getElementById(id);
  if (bar) return bar;

  bar = document.createElement("div");
  bar.id = id;
  Object.assign(bar.style, {
    position: "fixed", zIndex: 2147483647, left: 0, right: 0, top: 0,
    padding: "10px 14px", fontFamily: "system-ui, Arial, sans-serif",
    fontSize: "14px", color: "#0b0b0b", display: "flex", alignItems: "center",
    gap: "10px", boxShadow: "0 2px 10px rgba(0,0,0,.15)", background: "#fffbe6"
  });

  const dot = document.createElement("span");
  Object.assign(dot.style, { width: "10px", height: "10px", borderRadius: "50%", display: "inline-block" });

  const text = document.createElement("span"); text.style.flex = "1";

  const report = document.createElement("button");
  report.textContent = "Report as phishing";
  Object.assign(report.style, { border: "1px solid #ccc", background: "white", padding: "4px 8px", cursor: "pointer" });

  const close = document.createElement("button");
  close.textContent = "Dismiss";
  Object.assign(close.style, { border: "1px solid #ccc", background: "white", padding: "4px 8px", cursor: "pointer" });
  close.onclick = () => bar.remove();

  bar.append(dot, text, report, close);
  document.documentElement.appendChild(bar);

  // attach click later after first scan so it captures risk snapshot
  bar.__phish_report_btn = report;
  bar.__phish_text_node = text;
  bar.__phish_dot = dot;
  return bar;
}

async function saveReport(payload) {
  // Append to storage array "phish_reports"
  return new Promise((resolve) => {
    chrome.storage.local.get({ phish_reports: [] }, (data) => {
      const arr = Array.isArray(data.phish_reports) ? data.phish_reports : [];
      arr.unshift(payload);
      // keep last 200
      const trimmed = arr.slice(0, 200);
      chrome.storage.local.set({ phish_reports: trimmed }, () => resolve(true));
    });
  });
}

function setBanner(risk) {
  const bar = ensureBanner();
  const dot = bar.__phish_dot;
  const textNode = bar.__phish_text_node;
  let level = "Low", bg = "#e8fff1", dotColor = "#2ecc71";
  if (risk.total >= 3 && risk.total < 6) { level = "Medium"; bg = "#fffbe6"; dotColor = "#f1c40f"; }
  else if (risk.total >= 6) { level = "High"; bg = "#ffecec"; dotColor = "#e74c3c"; }
  bar.style.background = bg; dot.style.background = dotColor;

  const { urlScore, textScore, formScore, amh, eng, brands } = risk.breakdown;
  textNode.textContent = `PhishShield: Risk ${level} (${risk.total.toFixed(1)}/10) | URL:${urlScore.toFixed(1)} Text:${textScore.toFixed(1)} Forms:${formScore.toFixed(1)} | አማርኛ:${amh} EN:${eng} Brands:${brands}`;

  // wire up report button (snapshot current page state)
  if (!bar.__wired_report) {
    bar.__wired_report = true;
    bar.__phish_report_btn.onclick = async () => {
      const payload = {
        url: location.href,
        hostname: location.hostname,
        when: new Date().toISOString(),
        risk: risk.total,
        breakdown: risk.breakdown,
        sampleText: risk.sampleText
      };
      await saveReport(payload);
      bar.__phish_report_btn.textContent = "Reported ✓";
      bar.__phish_report_btn.disabled = true;
      setTimeout(() => {
        bar.__phish_report_btn.textContent = "Report as phishing";
        bar.__phish_report_btn.disabled = false;
      }, 1500);
    };
  }
}

// ======= Run & observe =======
function scanAndRender() {
  try {
    const risk = computeRisk();
    setBanner(risk);
  } catch {}
}
scanAndRender();
const obs = new MutationObserver(() => {
  clearTimeout(window.__phishshield_t);
  window.__phishshield_t = setTimeout(scanAndRender, 400);
});
obs.observe(document.documentElement, { childList: true, subtree: true });
