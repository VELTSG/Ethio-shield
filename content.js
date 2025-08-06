// ======= Config: keywords & weights =======
const AMHARIC_KEYWORDS = [
  "ነፃ", "በነፃ", "ማግኘት", "እንዲያገኙ", "ይግቡ", "መግባት", "ይመዝገቡ", "ይንቁ",
  "የሚጠፋ", "አሁን", "አስቸኳይ", "የመለያ ማረጋገጫ", "መክፈያ", "የኪስ ማስጠንቀቂያ",
  "የባንክ መለያ", "የካርድ ቁጥር", "ይጫኑ", "አስገባ", "የዚህ መለያ እርምጃ", "እዚህ ጠቅ ያድርጉ"
];

const EN_KEYWORDS = [
  "free", "urgent", "verify account", "confirm password", "update billing",
  "login now", "click here", "limited time", "unlock", "win", "reset password",
  "security alert", "suspend", "reactivate", "gift", "prize"
];

// Words that hint at brand impersonation (add local brands/services)
const BRAND_CUES = [
  "ethiopian airlines", "commercial bank of ethiopia", "telebirr",
  "ethio telecom", "dashen bank", "bank of abyssinia", "awash bank"
];

// ======= URL heuristics =======
function scoreUrl(hostname) {
  let s = 0;
  if ((hostname.match(/-/g) || []).length >= 2) s += 1.5;              // many hyphens
  if (/[0-9]/.test(hostname)) s += 0.5;                                 // numbers in domain
  if (/[^\x00-\x7F]/.test(hostname)) s += 1.5;                          // punycode/unicode-ish
  if (hostname.split(".").slice(-2)[0].length <= 3) s += 0.5;           // short weird SLD
  if (/\b(login|secure|verify|update)\b/i.test(hostname)) s += 1;       // bait words in domain
  return s;
}

// ======= Text scan =======
function getPageText() {
  // Take a slice to avoid massive strings; enough for signals
  const t = document.body ? document.body.innerText || "" : "";
  return t.slice(0, 50000); // cap for performance
}

function countMatches(text, list) {
  let c = 0;
  for (const w of list) {
    // simple contains; we can upgrade to word-boundaries for English later
    if (text.includes(w) || text.includes(w.toUpperCase())) c++;
  }
  return c;
}

// ======= Form checks =======
function scoreForms() {
  let s = 0;
  const forms = Array.from(document.querySelectorAll("form"));
  for (const f of forms) {
    const inputs = Array.from(f.querySelectorAll("input[type='password'], input[type='email'], input[type='text']"));
    if (inputs.length >= 2) s += 0.5; // looks like login/credential collection
    const action = (f.getAttribute("action") || "").trim();
    if (action && !action.startsWith("/") && !action.includes(location.hostname)) {
      s += 1.0; // posts off-site
    }
  }
  return s;
}

// ======= Risk aggregation =======
function computeRisk() {
  const hostname = location.hostname;
  const urlScore = scoreUrl(hostname);

  const text = getPageText();
  const amh = countMatches(text, AMHARIC_KEYWORDS);
  const eng = countMatches(text, EN_KEYWORDS);
  const brands = countMatches(text.toLowerCase(), BRAND_CUES);

  const textScore = amh * 1.2 + eng * 0.8 + brands * 1.0;
  const formScore = scoreForms();

  // Basic weighted sum
  let total = urlScore + textScore + formScore;

  // Normalize roughly into 0–10
  if (total > 10) total = 10;

  return {
    total,
    breakdown: { urlScore, textScore, formScore, amh, eng, brands }
  };
}

// ======= Banner UI =======
function ensureBanner() {
  const id = "phishshield-banner";
  if (document.getElementById(id)) return document.getElementById(id);

  const bar = document.createElement("div");
  bar.id = id;
  bar.style.position = "fixed";
  bar.style.zIndex = "2147483647";
  bar.style.left = 0;
  bar.style.right = 0;
  bar.style.top = 0;
  bar.style.padding = "10px 14px";
  bar.style.fontFamily = "system-ui, Arial, sans-serif";
  bar.style.fontSize = "14px";
  bar.style.color = "#0b0b0b";
  bar.style.display = "flex";
  bar.style.alignItems = "center";
  bar.style.gap = "10px";
  bar.style.boxShadow = "0 2px 10px rgba(0,0,0,.15)";
  bar.style.background = "#fffbe6"; // default (warning)

  const dot = document.createElement("span");
  dot.style.width = "10px";
  dot.style.height = "10px";
  dot.style.borderRadius = "50%";
  dot.style.display = "inline-block";

  const text = document.createElement("span");
  text.style.flex = "1";

  const close = document.createElement("button");
  close.textContent = "Dismiss";
  close.style.border = "1px solid #ccc";
  close.style.background = "white";
  close.style.padding = "4px 8px";
  close.style.cursor = "pointer";
  close.onclick = () => bar.remove();

  bar.append(dot, text, close);
  document.documentElement.appendChild(bar);

  return bar;
}

function setBanner(risk) {
  const bar = ensureBanner();
  const dot = bar.children[0];
  const text = bar.children[1];

  let level = "Low";
  let bg = "#e8fff1";  // greenish
  let dotColor = "#2ecc71";

  if (risk.total >= 3 && risk.total < 6) {
    level = "Medium";
    bg = "#fffbe6";    // yellowish
    dotColor = "#f1c40f";
  } else if (risk.total >= 6) {
    level = "High";
    bg = "#ffecec";    // reddish
    dotColor = "#e74c3c";
  }

  bar.style.background = bg;
  dot.style.background = dotColor;

  const { urlScore, textScore, formScore, amh, eng, brands } = risk.breakdown;
  text.textContent = `PhishShield: Risk ${level} (${risk.total.toFixed(1)}/10)
   | URL:${urlScore.toFixed(1)} Text:${textScore.toFixed(1)} Forms:${formScore.toFixed(1)}
   | አማርኛ:${amh} EN:${eng} Brands:${brands}`;
}

// ======= Run & observe =======
function scanAndRender() {
  try {
    const risk = computeRisk();
    setBanner(risk);
  } catch (e) {
    // Fail safe: don't break the page
    // console.error("PhishShield error:", e);
  }
}

scanAndRender();

const obs = new MutationObserver(() => {
  // Debounce simple: rescan after DOM changes
  clearTimeout(window.__phishshield_t);
  window.__phishshield_t = setTimeout(scanAndRender, 400);
});
obs.observe(document.documentElement, { childList: true, subtree: true });
