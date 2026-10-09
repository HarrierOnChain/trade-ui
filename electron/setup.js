"use strict";
(() => {
  const q = new URLSearchParams(window.location.search);
  const firstRun = q.get("firstRun") === "1";
  const hasKey = q.get("hasKey") === "1";
  const envKey = q.get("envKey") === "1";
  const $ = (id) => document.getElementById(id);

  if (firstRun) {
    $("eyebrow").textContent = "First run";
    $("title").textContent = "Connect to Raze";
    $("cancel").textContent = "Quit";
  } else {
    $("save").textContent = "Save and restart";
    $("lead").textContent = "Changes restart Trade UI's server, which locks the vault: you will enter your password again.";
    if (hasKey || envKey) {
      $("apiKey").placeholder = envKey ? "Set by the RAZE_API_KEY environment variable" : "Keep the current key";
      $("keyHint").textContent = "Leave it empty to keep the current key.";
    }
  }
  $("rpcUrl").value = q.get("rpcUrl") || "";

  for (const a of document.querySelectorAll("a[data-href]")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.tradeUiSettings.openExternal(a.getAttribute("data-href"));
    });
  }

  $("cancel").addEventListener("click", () => window.tradeUiSettings.cancel());
  $("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("error").textContent = "";
    $("save").disabled = true;
    const label = $("save").textContent;
    $("save").textContent = "Checking…";
    try {
      const r = await window.tradeUiSettings.save({ apiKey: $("apiKey").value, rpcUrl: $("rpcUrl").value });
      if (!r || !r.ok) $("error").textContent = (r && r.error) || "Not saved.";
    } catch (err) {
      $("error").textContent = String(err && err.message ? err.message : err);
    } finally {
      $("save").disabled = false;
      $("save").textContent = label;
    }
  });
  $("apiKey").focus();
})();
