function getReports() {
  return new Promise((resolve) => {
    chrome.storage.local.get({ phish_reports: [] }, (d) => resolve(d.phish_reports || []));
  });
}
function setReports(arr) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ phish_reports: arr }, () => resolve(true));
  });
}

function renderList(reports) {
  const list = document.getElementById("list");
  if (!reports.length) {
    list.textContent = "No reports yet.";
    return;
  }
  list.innerHTML = "";
  for (const r of reports) {
    const div = document.createElement("div");
    div.className = "item";
    div.innerHTML = `
      <div class="url">${r.url}</div>
      <div class="small">${new Date(r.when).toLocaleString()} | host: ${r.hostname}</div>
      <div class="risk">Risk: ${r.risk?.toFixed ? r.risk.toFixed(1) : r.risk}/10</div>
      <div class="small">Breakdown: URL ${r.breakdown?.urlScore?.toFixed?.(1)}, Text ${r.breakdown?.textScore?.toFixed?.(1)}, Forms ${r.breakdown?.formScore?.toFixed?.(1)}</div>
    `;
    list.appendChild(div);
  }
}

async function init() {
  const reports = await getReports();
  renderList(reports);

  document.getElementById("copy").onclick = async () => {
    const data = await getReports();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
  };

  document.getElementById("export").onclick = async () => {
    const data = await getReports();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `phish-reports-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  document.getElementById("clear").onclick = async () => {
    await setReports([]);
    renderList([]);
  };
}
init();
