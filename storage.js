/* ============================================================
   storage.js — localStorage-backed async KV, "loadlog:" prefix.
   Corruption-proof: an unparseable value is deleted and treated
   as absent, so one bad write can never permanently brick the app.
   Exposes window.GymStore = { sGet, sSet, sDel, available }.
   ============================================================ */
(function () {
  const SKEY = k => "loadlog:" + k;
  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function available() {
    const ls = store();
    if (!ls) return false;
    try { ls.setItem("loadlog:__probe", "1"); ls.removeItem("loadlog:__probe"); return true; }
    catch (e) { return false; }
  }
  async function sGet(k) {
    const ls = store();
    if (!ls) return null;
    let raw;
    try { raw = ls.getItem(SKEY(k)); } catch (e) { return null; }
    if (raw == null) return null;
    try { return JSON.parse(raw); }
    catch (e) {
      try { ls.removeItem(SKEY(k)); } catch (e2) {}
      return null;
    }
  }
  async function sSet(k, v) {
    const ls = store();
    if (!ls) return;
    try { ls.setItem(SKEY(k), JSON.stringify(v)); } catch (e) {}
  }
  async function sDel(k) {
    const ls = store();
    if (!ls) return;
    try { ls.removeItem(SKEY(k)); } catch (e) {}
  }
  window.GymStore = { sGet, sSet, sDel, available };
})();
