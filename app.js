/* ============================================================
   app.js — Load/Log gym tracker (JSX, compiled in-browser by Babel)
   Depends on: window.GymData, window.GymStore
   ============================================================ */
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { MUSCLES, LIB, T, rpHint, defaultProgram,
        GOALS, SPLITS, splitsForDays, generateProgram, applyWeek, mesoStatus,
        seedWeight, volumeBand, LANDMARKS, roundLoad, MUSCLE_WEIGHT, EWS,
        suggestNext, incFor, generate531 } = window.GymData;
const { sGet, sSet, sDel, available } = window.GymStore;

/* ---------- theme ---------- */
const C = {
  bg: "#0E1116", panel: "#151A21", panel2: "#1C232C", line: "#2A323C",
  ink: "#E7ECF2", dim: "#7C8794", acc: "#4DD6A6", blue: "#5BA8F5",
  warn: "#E56B6B", knee: "#E56B6B", gold: "#E5B86B"
};
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginTop: 12 };
const inp = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 16, width: "100%", textAlign: "center", outline: "none" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontWeight: 600, width: "100%", cursor: "pointer" });
const T_LABEL = { wr: "weight×reps", rep: "reps", time: "hold", wd: "load+dist", cardio: "cardio" };

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const TODAY = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const e1rm = (w, r) => (!w || !r) ? 0 : w * (1 + r / 30); // Epley
/* ---- drop sets / loaded bodyweight helpers ----
   A set with drop:true is a no-rest continuation of the row above it. For
   volume (RP landmarks) a top set + its drops = ONE set, so counts use
   workSets(). For progression the engine already ignores rows under 90% of
   the top weight, but we strip drops first so they never inflate nSets.
   Bodyweight ("rep") sets carry an optional add (kg): +10 = weighted,
   -10 = assisted (machine assist / band). e1RM for those needs bodyweight:
   load = bw + add. */
const workSets = sets => (sets || []).filter(s => !s.drop);
const isLoadedSet = s => s && s.add != null && Number(s.add) !== 0;
const fmtAdd = add => add == null || Number(add) === 0 ? "" : (Number(add) > 0 ? "+" : "-") + Math.abs(Number(add)) + "kg";
/* bodyweight for a session: its own, else the nearest session that has one
   (previous preferred). null if nothing is known anywhere. */
function bwForSession(sessions, idx) {
  const at = sessions[idx];
  if (at && at.bodyweight) return at.bodyweight;
  for (let i = idx - 1; i >= 0; i--) if (sessions[i].bodyweight) return sessions[i].bodyweight;
  for (let i = idx + 1; i < sessions.length; i++) if (sessions[i].bodyweight) return sessions[i].bodyweight;
  return null;
}
/* e1RM of a loaded bodyweight set; 0 if bodyweight unknown or set unloaded */
const repE1rm = (s, bw) => (!bw || !isLoadedSet(s)) ? 0 : e1rm(bw + Number(s.add), s.r);
const SS_COLORS = ["#4DD6A6", "#6BA6E5", "#E5B96B", "#C98BE5", "#E56B9E"];
const fmtDur = min => min == null ? "" : min >= 60 ? `${Math.floor(min/60)}h ${min%60}m` : `${min}m`;
const fmtSec = s => `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
const daysAgo = dateStr => {
  const d = new Date(dateStr + "T00:00:00"), t = new Date(TODAY() + "T00:00:00");
  return Math.round((t - d) / 86400000);
};
// best e1RM for an exercise key across sessions, optionally excluding one session id
function bestE1rmBefore(sessions, key, excludeId) {
  let best = 0;
  sessions.forEach(s => {
    if (s.id === excludeId) return;
    const e = s.entries.find(x => x.key === key);
    if (e && e.t === "wr") e.sets.forEach(x => { const v = e1rm(x.w, x.r); if (v > best) best = v; });
    if (e && e.t === "rep") { const bw = bwForSession(sessions, sessions.indexOf(s)); e.sets.forEach(x => { const v = repE1rm(x, bw); if (v > best) best = v; }); }
  });
  return best;
}
function blankSet(t) {
  const b = { wr:{w:"",r:"",rpe:""}, rep:{r:"",add:"",rpe:""}, time:{sec:""}, wd:{w:"",dist:""}, cardio:{sec:"",dist:""} }[t];
  return { ...b, done: false };
}
function isoWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const ys = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - ys) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, "0")}`;
}
// migrate old day shape { exIds:[key] } -> { items:[{key,target}] }
function migrate(prog) {
  if (!prog || !prog.days) return prog;
  let changed = false;
  const days = prog.days.map(d => {
    if (d.items) return d;
    changed = true;
    return { id: d.id, name: d.name, items: (d.exIds || []).map(k => ({ key: k, target: T(3,8,12,null) })) };
  });
  return changed ? { ...prog, days } : prog;
}
// migrate old single-knee session -> injuries[]; keep knee for back-compat reads
function migrateSession(s) {
  if (!s) return s;
  if (!s.injuries) {
    const inj = [];
    if (s.knee && (s.knee.pain > 0 || s.knee.swelling || s.knee.note)) {
      inj.push({ name: "Knee", pain: s.knee.pain || 0, swelling: !!s.knee.swelling, note: s.knee.note || "" });
    }
    s = { ...s, injuries: inj };
  }
  // ensure entries can carry a note
  s.entries = (s.entries || []).map(e => ("note" in e ? e : { ...e, note: "" }));
  // session-level readiness/feel rating (1-10, higher = fresher); null if never set
  if (!("feel" in s)) s = { ...s, feel: null };
  return s;
}

/* ============================================================
   Rest timer preferences + alerts
   prefs:rest = { len, step, notify, sound, vibrate, byEx:{ [exKey]: sec } }
   Alerts fire from the page. There is no web API that schedules a local
   notification while the page is suspended, so on iPhone the alert lands
   while the app is on screen (or for a few seconds after backgrounding);
   if the phone locks, it fires the moment the app is reopened.
   ============================================================ */
const REST_DEFAULTS = { len: 120, step: 30, notify: false, sound: true, vibrate: true, byEx: {} };
const REST_PRESETS = [0, 60, 90, 120, 150, 180, 240, 300];
const notifSupported = () => typeof Notification !== "undefined" && "requestPermission" in Notification;
const notifState = () => notifSupported() ? Notification.permission : "unsupported";
let _audio = null;
function ensureAudio() {
  // must be called from a user gesture so iOS lets the context run
  try {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    if (!_audio) _audio = new AC();
    if (_audio.state === "suspended") _audio.resume();
  } catch (e) {}
}
function beep() {
  try {
    if (!_audio) return;
    const t0 = _audio.currentTime;
    [0, 0.22, 0.44].forEach((d, i) => {
      const o = _audio.createOscillator(), g = _audio.createGain();
      o.type = "sine"; o.frequency.value = i === 2 ? 1046 : 784;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.16);
      o.connect(g); g.connect(_audio.destination); o.start(t0 + d); o.stop(t0 + d + 0.18);
    });
  } catch (e) {}
}
async function showRestNotification(body) {
  if (notifState() !== "granted") return;
  const opts = { body, tag: "rest-timer", renotify: true, silent: false };
  try {
    if (navigator.serviceWorker) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg && reg.showNotification) { await reg.showNotification("Rest over", opts); return; }
    }
  } catch (e) {}
  try { new Notification("Rest over", opts); } catch (e) {}
}
function fireRestAlert(prefs, body) {
  if (prefs.vibrate && navigator.vibrate) navigator.vibrate([180, 80, 180]);
  if (prefs.sound) beep();
  if (prefs.notify) showRestNotification(body);
}
const fmtRest = sec => !sec ? "off" : (sec >= 60 ? `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}` : `${sec}s`);

const exMapFromLib = () => { const m = new Map(); LIB.forEach(e => m.set(e.key, e)); return m; };

/* ============================================================
   EWS — Estimated Workout Score
   ------------------------------------------------------------
   Unbounded: more quality work = higher score, always.

   score = BASE + IMPROVE + PR

   BASE   = Σ sets  perSet × muscleWeight × quality
     quality (first rule that applies):
       drop row                       -> dropCredit (0.5)      not junk, but half a set
       RPE logged  ≥ 7                -> 1.0
       RPE logged  = 6                -> 0.6
       RPE logged  ≤ 5                -> 0.25                  you said it was easy
       load < 50% of exercise top     -> junkCredit (0.15)     warm-up / junk
       load 50–70% of top             -> lightCredit (0.6)
       reps < 50% of program repLo    -> junkCredit             nowhere near target
       load < 50% of program target w -> junkCredit
       otherwise                      -> 1.0
   IMPROVE = Σ exercises  base_ex × lastK × h(%Δ best e1RM vs the previous
             session containing that exercise), floored at lastFloorPct.
   PR      = Σ exercises  base_ex × prK × h(% over prior all-time best), only
             when the session sets a new best and the exercise has at least
             prMinPrior prior sessions.
   h(p) = sign(p) × ln(1 + |p| / pctScale): concave, uncapped. Scaling by the
   exercise's own base means a jump on one rehab set can't outscore a whole
   session, which is what the first linear version did (calibrated on 32
   real sessions: leg-day PR bonus averaged 83 on a base of 37).
   e1RM scale: wr = Epley; rep-only = Epley on bodyweight (reps move the
   1+r/30 term only); holds = 1 + sec/120. All exercises move on the same %.
   ============================================================ */
function exMetricBest(entry, bw) {
  /* single comparable number for an entry, all on an e1RM-like % scale:
       wr            Epley e1RM of the best set
       rep (loaded)  Epley on (bodyweight + load)
       rep (plain)   Epley on bodyweight (or 1.0 if unknown): reps only move the
                     (1 + r/30) term, so 8→10 reps is +5%, same as it would be
                     on the bar, not +25%
       time          1 + sec/120, so 60→90 s is +17%, not +50%
       wd / cardio   no metric */
  if (!entry.sets.length) return 0;
  if (entry.t === "wr") return Math.max(0, ...entry.sets.map(x => e1rm(x.w, x.r)));
  if (entry.t === "rep") {
    const base = bw || 1;
    return Math.max(0, ...entry.sets.map(x => e1rm(base + (Number(x.add) || 0), x.r)));
  }
  if (entry.t === "time") return Math.max(0, ...entry.sets.map(x => x.sec ? 1 + x.sec / 120 : 0));
  return 0;
}
function setQuality(set, entry, topW, target) {
  if (set.drop) return { q: EWS.dropCredit, why: "drop" };
  if (set.rpe != null && set.rpe !== "") {
    const r = Number(set.rpe);
    if (r >= EWS.rpe.hard) return { q: 1, why: "" };
    if (r >= EWS.rpe.mid) return { q: EWS.rpe.midCredit, why: "RPE " + r };
    return { q: EWS.rpe.easyCredit, why: "easy" };
  }
  const load = entry.t === "wr" ? (set.w || 0) : null;
  if (load != null && topW > 0) {
    if (load <= topW * 0.5) return { q: EWS.junkCredit, why: "junk" };
    if (load < topW * 0.7) return { q: EWS.lightCredit, why: "light" };
  }
  if (target) {
    if (target.repLo && (set.r || 0) < target.repLo * 0.5 && entry.t !== "time") return { q: EWS.junkCredit, why: "junk" };
    if (target.w && load != null && load < target.w * 0.5) return { q: EWS.junkCredit, why: "junk" };
  }
  return { q: 1, why: "" };
}
/* sessions: full list (any order). programDays: to find the day's targets.
   Returns { total, base, improve, pr, ex:[{name,key,muscle,weight,base,improve,pr,sets:[{q,why}],junk}] } */
function scoreSession(session, sessions, exResolve, programDays) {
  const byDate = sessions.filter(s => s.id !== session.id && s.date <= session.date)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const bw = session.bodyweight || bwForSession(sessions, sessions.indexOf(session));
  const day = programDays ? programDays.find(d => d.id === session.dayId) : null;
  const out = { total: 0, base: 0, improve: 0, pr: 0, ex: [] };
  session.entries.forEach(e => {
    const ex = exResolve(e.key);
    const muscle = ex ? ex.m : null;
    const w = muscle && MUSCLE_WEIGHT[muscle] != null ? MUSCLE_WEIGHT[muscle] : 1;
    const target = day ? (day.items.find(it => it.key === e.key) || {}).target : null;
    const topW = e.t === "wr" ? Math.max(0, ...e.sets.map(x => x.w || 0)) : 0;
    const sets = e.sets.map(s => setQuality(s, e, topW, target));
    const base = sets.reduce((a, q) => a + EWS.perSet * w * q.q, 0);
    // improvement vs last session with this exercise, and vs all-time best
    let improve = 0, pr = 0, note = "";
    const now = exMetricBest(e, bw);
    if (now > 0 && (e.t === "wr" || e.t === "rep" || e.t === "time")) {
      let last = 0, best = 0, nPrior = 0;
      byDate.forEach((s, i) => {
        const pe = s.entries.find(x => x.key === e.key);
        if (!pe || !pe.sets.length) return;
        const m = exMetricBest(pe, s.bodyweight || bwForSession(byDate, i));
        if (m > 0) { last = m; nPrior++; if (m > best) best = m; }
      });
      const h = p => Math.sign(p) * Math.log(1 + Math.abs(p) / EWS.pctScale);
      if (last > 0) {
        const pct = Math.max(EWS.lastFloorPct, (now - last) / last * 100);
        improve = base * EWS.lastK * h(pct);
        note = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "% vs last";
      }
      if (best > 0 && now > best && nPrior >= EWS.prMinPrior) {
        const pct = (now - best) / best * 100;
        pr = base * EWS.prK * h(pct);
        note += (note ? " · " : "") + "PR +" + pct.toFixed(1) + "%";
      } else if (best > 0 && now > best) {
        note += (note ? " · " : "") + "new best (PR bonus from session " + (EWS.prMinPrior + 1) + ")";
      }
    }
    const junk = sets.filter(q => q.why === "junk").length;
    out.ex.push({ key: e.key, name: e.name, muscle, weight: w, base, improve, pr, sets, junk, note });
    out.base += base; out.improve += improve; out.pr += pr;
  });
  out.total = out.base + out.improve + out.pr;
  return out;
}
const fmtEws = v => String(Math.round(v));
const EWS_COLOR = "#E5B96B";


/* ============================================================
   App
   ============================================================ */
function App() {
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [program, setProgram] = useState(null);
  const [custom, setCustom] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [injuries, setInjuries] = useState([]); // active/closed injury definitions
  const [tab, setTab] = useState("log");
  const [activeDayId, setActiveDayId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [viewSession, setViewSession] = useState(null); // read-only past session
  const [toast, setToast] = useState("");
  const [picker, setPicker] = useState(null);
  const [gyms, setGyms] = useState([]);          // known gym names
  const lastGym = useRef(null);                   // most recently used gym

  const flash = useCallback(m => { setToast(m); setTimeout(() => setToast(""), m.length > 30 ? 3200 : 1800); }, []);
  const allEx = useMemo(() => [...LIB, ...custom], [custom]);
  const exByKey = useCallback(k => allEx.find(e => e.key === k), [allEx]);

  const saveProgram = useCallback(async p => { setProgram(p); await sSet("program:current", p); }, []);
  const [restPrefs, setRestPrefs] = useState(REST_DEFAULTS);
  const saveRestPrefs = useCallback(patch => setRestPrefs(prev => { const next = { ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }; sSet("prefs:rest", next); return next; }), []);
  /* EWS for any session against the current session list + program targets */
  const scoreOf = useCallback(s => scoreSession(s, sessions, exByKey, program ? program.days : null), [sessions, exByKey, program]);

  /* ---- draft persistence: survive PWA kill / accidental close ---- */
  const draftReady = useRef(false);
  useEffect(() => {
    if (!draftReady.current) return;
    const t = setTimeout(() => { if (draft) sSet("draft:current", draft); }, 400);
    return () => clearTimeout(t);
  }, [draft]);

  /* ---- initial load with watchdog ---- */
  useEffect(() => {
    let done = false;
    const watchdog = setTimeout(() => {
      if (!done) {
        setLoadErr("Load timed out after 2.5s. Storage may be blocked (private mode / disabled). Opened with defaults — saved data may not have loaded.");
        setProgram(p => p || defaultProgram());
        setActiveDayId(a => a ?? null);
        setLoading(false);
      }
    }, 2500);
    (async () => {
      try {
        if (!available()) setLoadErr("Storage is unavailable (private mode or blocked). The app works this session but won't save.");
        let p = await sGet("program:current");
        if (!p || !p.days || !Array.isArray(p.days)) { p = defaultProgram(); await sSet("program:current", p); }
        else { const mig = migrate(p); if (mig !== p) { p = mig; await sSet("program:current", p); } }
        setProgram(p);
        setActiveDayId(p.days[0]?.id ?? null);
        setCustom((await sGet("library:custom")) || []);
        setInjuries((await sGet("injuries:list")) || []);
        setGyms((await sGet("gyms:list")) || []);
        lastGym.current = (await sGet("gyms:last")) || null;
        {
          const rp = await sGet("prefs:rest");
          const legacy = await sGet("prefs:restLen"); // pre-Sep-2026 single value
          setRestPrefs({ ...REST_DEFAULTS, ...(rp || {}), ...(rp == null && legacy != null ? { len: legacy } : {}) });
        }
        const idx = (await sGet("sessions:index")) || [];
        const out = [];
        for (const id of idx) { const s = await sGet(`session:${id}`); if (s) out.push(migrateSession(s)); }
        setSessions(out);
        // resume an in-progress session if the app was killed mid-log
        const savedDraft = await sGet("draft:current");
        if (savedDraft && savedDraft.entries) { setDraft(savedDraft); setTab("log"); }
      } catch (e) {
        setLoadErr((e && e.message) ? ("Load error: " + e.message) : ("Load error: " + String(e)));
        const p = defaultProgram();
        setProgram(p); setActiveDayId(p.days[0].id); setCustom([]); setSessions([]); setInjuries([]);
      } finally { done = true; clearTimeout(watchdog); setLoading(false); draftReady.current = true; }
    })();
    return () => clearTimeout(watchdog);
  }, []);

  /* ---- derived ---- */
  const lastForExercise = useCallback(key => {
    for (let i = sessions.length - 1; i >= 0; i--) {
      const e = sessions[i].entries.find(x => x.key === key);
      if (e && e.sets.length) return e.sets;
    }
    return null;
  }, [sessions]);

  /* Anchor sets for weight-progression suggestions (wr only).
     Window = last 4 sessions containing the exercise. Up to two
     consecutive sessions below the recent best are treated as off days
     and ignored (anchor to the best recent session instead). Three
     consecutive sessions below the recent best = genuine regression, so
     accept the reset and anchor to the most recent session.
     lastForExercise stays as-is for display. */
  const refSetsForExercise = useCallback(key => {
    const recent = []; // newest first, up to 4
    for (let i = sessions.length - 1; i >= 0 && recent.length < 4; i--) {
      const e = sessions[i].entries.find(x => x.key === key);
      if (e && e.sets.length) recent.push(e.sets);
    }
    if (!recent.length) return null;
    const topW = sets => Math.max(0, ...sets.map(s => s.w || 0));
    if (recent.length === 1) return { sets: recent[0], offDay: false };
    const w = recent.map(topW);
    const refW = Math.max(...w);
    if (!(refW > 0)) return { sets: recent[0], offDay: false };
    const TOL = 0.95;
    // last session at (or near) the recent best -> normal
    if (w[0] >= refW * TOL) return { sets: recent[0], offDay: false };
    // count consecutive misses ending at the most recent session
    let misses = 0;
    while (misses < w.length && w[misses] < refW * TOL) misses++;
    // three or more in a row -> consistent, accept the reset
    if (misses >= 3) return { sets: recent[0], offDay: false };
    // one or two off days -> anchor to the best recent session instead
    const bestIdx = w.indexOf(refW);
    return { sets: recent[bestIdx], offDay: true, refW };
  }, [sessions]);

  /* ---- prefill model ----
     For a given exercise key + its program target, produce the ghost values
     shown as input placeholders, plus a corrected target. Sources, in order:
       1. last logged session for this exercise -> ghost from last top set,
          weight nudged up if last session hit top of rep range (overload),
          held flat on a deload week (sets are cut elsewhere, load stays).
       2. program target.w (if any) -> ghost weight = target.w
       3. population seed (seedWeight) for known library movements
       4. blank
     Returns { target, ghostW, ghostR, est } where ghostW/ghostR are strings
     for placeholders (or "" when unknown). target keeps sets/repLo/repHi. */
  const mesoDeload = useMemo(() => {
    const st = program && mesoStatus(program);
    return !!(st && st.isDeload);
  }, [program]);

  const mesoStats = useMemo(() => (program && program.meso && program.meso.stats) || {}, [program]);

  // most recent logged bodyweight, for bodyweight-fraction seeds
  const lastBodyweight = useMemo(() => {
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i].bodyweight != null) return sessions[i].bodyweight;
    }
    return mesoStats.bodyweight || null;
  }, [sessions, mesoStats]);

  // program-level "work down" pref: back-off sets after the top set (default on)
  const workDown = !program || program.workDown !== false;

  /* opts.wrIndex: this exercise's position among weight exercises in the day.
     Used ONLY to fatigue-discount seeded (no-history) weights — history-based
     suggestions already embed where the exercise sits in the workout. */
  const prefillFor = useCallback((key, target, exType, exName, opts) => {
    const t = target ? { ...target } : null;
    const ex = exByKey(key);
    let ghostW = "", ghostR = "", est = false;
    const nSets = (t && t.sets) || null;

    // 1) fixed percent plan (5/3/1 main lifts) — authoritative, never overridden
    if (t && t.plan && t.plan.length) {
      const plan = t.plan.map(p => ({
        w: p.w != null ? String(p.w) : "",
        r: p.r != null ? String(p.r) + (p.plus ? "+" : "") : ""
      }));
      return { target: t, ghostW: plan[0].w, ghostR: plan[0].r, est: false, plan,
               progNote: t.plan.map(p => p.w).join(" / ") + " kg" + (t.plan.some(p => p.plus) ? " · last set AMRAP" : "") };
    }

    const prev = lastForExercise(key);
    if (prev && prev.length) {
      // 2) history → double progression with per-set plan
      if (exType === "wr") {
        const band = t ? { repLo: t.repLo, repHi: t.repHi } : null;
        const ref = refSetsForExercise(key) || { sets: prev, offDay: false };
        const refWork = workSets(ref.sets).length ? workSets(ref.sets) : ref.sets;
        const sug = suggestNext(refWork, ex, band, {
          deload: mesoDeload, nSets: nSets || refWork.length, workDown
        });
        if (sug) {
          const plan = sug.plan.map(p => ({ w: String(p.w), r: String(p.r) }));
          if (t) t.w = sug.topW;
          const note = ref.offDay ? `off day ignored — back to ${sug.topW}kg` : sug.reason;
          return { target: t, ghostW: plan[0].w, ghostR: plan[0].r, est: false, plan, progNote: note };
        }
      }
      if (exType === "wd") {
        const ref = prev.reduce((a, s) => (s.w || 0) >= (a.w || 0) ? s : a, prev[0]);
        ghostW = ref.w != null ? String(ref.w) : "";
        return { target: t, ghostW, ghostR, est: false, plan: null, progNote: "" };
      }
      if (exType === "rep") {
        const pw = workSets(prev).length ? workSets(prev) : prev;
        // anchor on the heaviest loading; among equal loads, the most reps
        const ref = pw.reduce((a, s) => {
          const la = Number(a.add) || 0, ls = Number(s.add) || 0;
          if (ls > la) return s;
          if (ls === la && (s.r || 0) >= (a.r || 0)) return s;
          return a;
        }, pw[0]);
        const cap = (t && t.repHi) || null;
        const next = (ref.r || 0) + 1;
        ghostR = String(cap ? Math.min(next, cap) : next);
        const ghostAdd = ref.add != null && Number(ref.add) !== 0 ? String(ref.add) : "";
        const addStr = fmtAdd(ref.add);
        return { target: t, ghostW, ghostR, ghostAdd, est: false, plan: null,
                 progNote: ref.r ? `last ${ref.r}${addStr ? " " + addStr : ""} — try ${ghostR}` : "" };
      }
      if (exType === "time") {
        const ref = prev.reduce((a, s) => (s.sec || 0) >= (a.sec || 0) ? s : a, prev[0]);
        ghostR = ref.sec != null ? String(ref.sec) : "";
        return { target: t, ghostW, ghostR, est: false, plan: null, progNote: "" };
      }
      return { target: t, ghostW, ghostR, est: false, plan: null, progNote: "" };
    }

    // 3) no history -> program target weight
    if (t && t.w != null) {
      ghostW = String(t.w);
      ghostR = t.repLo != null ? String(t.repLo) : "";
      return { target: t, ghostW, ghostR, est: !!(t && t._seeded), plan: null, progNote: "" };
    }

    // 4) no history, no target weight -> population seed, fatigue-discounted
    //    by position in the workout (later exercises start a touch lighter)
    if ((exType === "wr") && exName) {
      const reps = (t && t.repLo) ? t.repLo : 8;
      const seeded = seedWeight(exName, reps, { ...mesoStats, bodyweight: lastBodyweight || mesoStats.bodyweight });
      if (seeded && seeded.w != null) {
        const fat = Math.max(0.9, 1 - 0.025 * ((opts && opts.wrIndex) || 0));
        const w = Math.round(seeded.w * fat * 2) / 2;
        ghostW = String(w);
        ghostR = String(reps);
        if (t) t.w = w;
        return { target: t, ghostW, ghostR, est: true, plan: null, progNote: "" };
      }
    }

    // fall through: reps ghost from target if present
    if (t && t.repLo != null) ghostR = String(t.repLo);
    return { target: t, ghostW, ghostR, est, plan: null, progNote: "" };
  }, [lastForExercise, refSetsForExercise, mesoDeload, mesoStats, lastBodyweight, exByKey, workDown]);

  /* ---- session lifecycle ---- */
  const startSession = useCallback(() => {
    const day = program.days.find(d => d.id === activeDayId);
    if (!day) return;
    let wrIndex = 0;
    setDraft({
      id: uid(), date: TODAY(), dayId: day.id, dayName: day.name, bodyweight: "", feel: null, startedAt: Date.now(),
      gym: lastGym.current || null,
      injuries: injuries.filter(i => !i.closed).map(i => ({ name: i.name, pain: 0, swelling: false, note: "" })),
      entries: day.items.map(it => {
        const ex = exByKey(it.key); if (!ex) return null;
        const pf = prefillFor(it.key, it.target, ex.t, ex.n, { wrIndex });
        if (ex.t === "wr") wrIndex++;
        const nSets = it.target?.sets || 1;
        return { eid: uid(), key: it.key, name: ex.n, t: ex.t, note: "", group: null,
          est: pf.est, target: pf.target, ghostW: pf.ghostW, ghostR: pf.ghostR, ghostAdd: pf.ghostAdd || "",
          plan: pf.plan || null, progNote: pf.progNote || "",
          sets: Array.from({ length: nSets }, () => blankSet(ex.t)) };
      }).filter(Boolean)
    });
    setViewSession(null); setTab("log");
  }, [program, activeDayId, exByKey, prefillFor, injuries]);

  const addExerciseToDraft = useCallback(exKey => {
    const ex = exByKey(exKey); if (!ex) return;
    setDraft(d => {
      const wrIndex = d.entries.filter(e => e.t === "wr").length;
      const pf = prefillFor(exKey, null, ex.t, ex.n, { wrIndex });
      const nSets = pf.plan ? pf.plan.length : 1;
      return { ...d, entries: [...d.entries, { eid: uid(), key: exKey, name: ex.n, t: ex.t, note: "", group: null,
        target: pf.target, ghostW: pf.ghostW, ghostR: pf.ghostR, ghostAdd: pf.ghostAdd || "", est: pf.est,
        plan: pf.plan || null, progNote: pf.progNote || "",
        sets: Array.from({ length: nSets }, () => blankSet(ex.t)) }] };
    });
  }, [exByKey, prefillFor]);

  const saveSession = useCallback(async () => {
    const notEmpty = (t, s) => ({
      wr: () => s.w !== "" || s.r !== "", rep: () => s.r !== "" || (s.add !== "" && s.add != null),
      time: () => s.sec !== "", wd: () => s.w !== "" || s.dist !== "",
      cardio: () => s.sec !== "" || s.dist !== ""
    })[t]();
    const num = v => v === "" ? 0 : Number(v) || 0;
    const clean = {
      ...draft,
      gym: (draft.gym && String(draft.gym).trim()) || null,
      bodyweight: draft.bodyweight === "" ? null : Number(draft.bodyweight),
      feel: (draft.feel == null || draft.feel === "") ? null : Math.max(1, Math.min(10, Number(draft.feel))),
      injuries: (draft.injuries || []).filter(i => i.pain > 0 || i.swelling || i.note),
      entries: draft.entries.map(e => ({
        key: e.key, name: e.name, t: e.t, note: e.note || "",
        ...(e.group ? { group: e.group } : {}),
        sets: e.sets.filter(s => notEmpty(e.t, s)).map(s => {
          const dropFlag = s.drop ? { drop: true } : {};
          if (e.t === "wr") return { w: num(s.w), r: num(s.r), rpe: s.rpe === "" ? null : Number(s.rpe), ...dropFlag };
          if (e.t === "rep") return { r: num(s.r), add: (s.add === "" || s.add == null) ? null : (Number(s.add) || 0), rpe: s.rpe === "" ? null : Number(s.rpe), ...dropFlag };
          if (e.t === "time") return { sec: num(s.sec) };
          if (e.t === "wd") return { w: num(s.w), dist: num(s.dist) };
          return { sec: num(s.sec), dist: num(s.dist) };
        })
      })).filter(e => e.sets.length > 0 || e.note)
    };
    // a superset needs two members; drop the tag if only one survived cleanup
    const gCount = {};
    clean.entries.forEach(e => { if (e.group) gCount[e.group] = (gCount[e.group] || 0) + 1; });
    clean.entries = clean.entries.map(e => (e.group && gCount[e.group] < 2) ? (({ group, ...rest }) => rest)(e) : e);
    if (clean.entries.length === 0 && clean.injuries.length === 0) { flash("Nothing logged."); return; }
    // duration: from live timer on new sessions, preserved on edits
    clean.durationMin = draft.startedAt
      ? Math.max(1, Math.round((Date.now() - draft.startedAt) / 60000))
      : (draft.durationMin ?? null);
    delete clean.startedAt;
    // PR scan: any wr exercise whose best e1RM beats all prior history
    let prCount = 0;
    clean.entries.forEach(e => {
      let best = 0;
      if (e.t === "wr") best = Math.max(0, ...e.sets.map(s => e1rm(s.w, s.r)));
      else if (e.t === "rep" && clean.bodyweight) best = Math.max(0, ...e.sets.map(s => repE1rm(s, clean.bodyweight)));
      else return;
      if (!best) return;
      const prior = bestE1rmBefore(sessions, e.key, clean.id);
      if (prior > 0 && best > prior) prCount++;
    });
    const existingIdx = sessions.findIndex(s => s.id === clean.id);
    let next;
    if (existingIdx >= 0) {
      next = sessions.map((s, i) => i === existingIdx ? clean : s);
    } else {
      next = [...sessions, clean];
    }
    setSessions(next);
    await sSet(`session:${clean.id}`, clean);
    await sSet("sessions:index", next.map(s => s.id));
    if (clean.gym) {
      lastGym.current = clean.gym;
      await sSet("gyms:last", clean.gym);
      if (!gyms.includes(clean.gym)) {
        const g = [...gyms, clean.gym]; setGyms(g); await sSet("gyms:list", g);
      }
    }
    await sDel("draft:current");
    setDraft(null); setTab("history");
    // EWS readout: score, and delta vs the previous session of the same program day
    const ews = scoreSession(clean, next, exByKey, program ? program.days : null);
    const prevSame = sessions.filter(s => s.id !== clean.id && s.dayId === clean.dayId && s.date <= clean.date)
      .sort((a, b) => a.date < b.date ? 1 : -1)[0];
    let ewsMsg = ` EWS ${fmtEws(ews.total)}`;
    if (prevSame) { const d = ews.total - scoreSession(prevSame, next, exByKey, program ? program.days : null).total; ewsMsg += ` (${d >= 0 ? "+" : ""}${fmtEws(d)})`; }
    flash((existingIdx >= 0 ? "Updated." : "Saved.") + (prCount ? ` ${prCount} PR${prCount > 1 ? "s" : ""}.` : "") + ewsMsg + ".");
  }, [draft, sessions, gyms, flash, exByKey, program]);

  const discardDraft = useCallback(async () => {
    await sDel("draft:current");
    setDraft(null);
  }, []);

  const deleteSession = useCallback(async id => {
    const next = sessions.filter(s => s.id !== id);
    setSessions(next);
    await sDel(`session:${id}`);
    await sSet("sessions:index", next.map(s => s.id));
    setViewSession(null); flash("Deleted.");
  }, [sessions, flash]);

  // hydrate a saved session back into editable draft shape (values -> strings)
  const editSession = useCallback(session => {
    const toStr = v => (v == null ? "" : String(v));
    // injuries already logged on this session, plus any currently-active injury
    // not already present (so you can add a check-in retroactively while editing)
    const logged = (session.injuries || []).map(i => ({ name: i.name, pain: i.pain || 0, swelling: !!i.swelling, note: i.note || "" }));
    const loggedNames = new Set(logged.map(i => i.name));
    const extra = injuries.filter(i => !i.closed && !loggedNames.has(i.name))
      .map(i => ({ name: i.name, pain: 0, swelling: false, note: "" }));
    const draftFromSession = {
      id: session.id, date: session.date, dayId: session.dayId, dayName: session.dayName,
      gym: session.gym || null,
      bodyweight: toStr(session.bodyweight),
      durationMin: session.durationMin ?? null,
      feel: session.feel == null ? null : session.feel,
      injuries: [...logged, ...extra],
      entries: session.entries.map(e => ({
        eid: uid(), key: e.key, name: e.name, t: e.t, note: e.note || "", target: null, ghostW: "", ghostR: "", ghostAdd: "",
        group: e.group || null,
        sets: (e.sets.length ? e.sets : [blankSet(e.t)]).map(s => {
          const dropFlag = s.drop ? { drop: true } : {};
          if (e.t === "wr") return { w: toStr(s.w), r: toStr(s.r), rpe: toStr(s.rpe), ...dropFlag };
          if (e.t === "rep") return { r: toStr(s.r), add: toStr(s.add), rpe: toStr(s.rpe), ...dropFlag };
          if (e.t === "time") return { sec: toStr(s.sec) };
          if (e.t === "wd") return { w: toStr(s.w), dist: toStr(s.dist) };
          return { sec: toStr(s.sec), dist: toStr(s.dist) };
        })
      }))
    };
    setViewSession(null); setDraft(draftFromSession); setTab("log");
  }, [injuries]);

  /* ---- custom exercises ---- */
  const addCustom = useCallback(async ex => {
    const key = "cus:" + ex.n + ":" + uid();
    const row = { key, n: ex.n, m: ex.m, e: ex.e, t: ex.t, role: ex.role || "compound", rp: ex.rp || [8,12] };
    const next = [...custom, row]; setCustom(next); await sSet("library:custom", next); return key;
  }, [custom]);
  const updateCustom = useCallback(async (key, ex) => {
    // keep the key so program items + logged history stay bound to this exercise
    const next = custom.map(c => c.key === key
      ? { ...c, n: ex.n, m: ex.m, e: ex.e, t: ex.t, role: ex.role || "compound", rp: ex.rp || [8,12] }
      : c);
    setCustom(next); await sSet("library:custom", next);
  }, [custom]);
  const removeCustom = useCallback(async key => {
    const next = custom.filter(c => c.key !== key); setCustom(next); await sSet("library:custom", next);
  }, [custom]);

  /* ---- injuries ---- */
  const saveInjuries = useCallback(async list => { setInjuries(list); await sSet("injuries:list", list); }, []);

  /* ---- import/export ---- */
  const exportJson = useCallback(() => {
    const data = { program, custom, sessions, injuries, gyms, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `gym-backup-${TODAY()}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }, [program, custom, sessions, injuries, gyms]);
  const importJson = useCallback(async file => {
    try {
      const d = JSON.parse(await file.text());
      if (d.program && d.program.days) { const p = migrate(d.program); setProgram(p); setActiveDayId(p.days[0]?.id ?? null); await sSet("program:current", p); }
      if (Array.isArray(d.custom)) { setCustom(d.custom); await sSet("library:custom", d.custom); }
      if (Array.isArray(d.injuries)) { setInjuries(d.injuries); await sSet("injuries:list", d.injuries); }
      if (Array.isArray(d.gyms)) { setGyms(d.gyms); await sSet("gyms:list", d.gyms); }
      if (Array.isArray(d.sessions)) {
        const migrated = d.sessions.map(migrateSession);
        setSessions(migrated);
        for (const s of migrated) await sSet(`session:${s.id}`, s);
        await sSet("sessions:index", migrated.map(s => s.id));
      }
      flash("Imported.");
    } catch (e) { flash("Import failed: bad file."); }
  }, [flash]);

  const resetProgram = useCallback(async () => { const fresh = defaultProgram(); await saveProgram(fresh); setActiveDayId(fresh.days[0].id); flash("Program reset."); }, [saveProgram, flash]);

  /* ---- generated mesocycle program ---- */
  const installGenerated = useCallback(async prog => {
    const p = { ...prog };
    if (p.meso) p.meso.startedOn = TODAY();
    await saveProgram(p);
    setActiveDayId(p.days[0]?.id ?? null);
    setTab("log");
    flash("Program installed.");
  }, [saveProgram, flash]);

  const advanceWeek = useCallback(async () => {
    if (!program || !program.meso) return;
    const next = Math.min(program.meso.week + 1, program.meso.totalWeeks);
    const updated = applyWeek(program, next);
    await saveProgram(updated);
    const st = mesoStatus(updated);
    flash(st && st.isDeload ? "Deload week — back off." : `Advanced to week ${next}.`);
  }, [program, saveProgram, flash]);

  const exitMeso = useCallback(async () => {
    if (!program) return;
    const { meso, generated, ...rest } = program;
    const stripped = { ...rest, days: program.days.map(d => { const { blueprint, ...dd } = d; return { ...dd, items: d.items.map(it => { const { tier, est, ...ii } = it; return ii; }) }; }) };
    await saveProgram(stripped);
    flash("Mesocycle ended — program kept as editable.");
  }, [program, saveProgram, flash]);

  const openPicker = useCallback((onPick, initialQ) => setPicker({ onPick, initialQ: initialQ || "" }), []);

  if (loading) return <Shell><div style={{ color: C.dim, padding: 40, textAlign: "center" }}>Loading…</div></Shell>;

  const errBanner = loadErr ? (
    <div style={{ background:"#2A1416", border:`1px solid ${C.warn}`, color:"#E56B6B", borderRadius:8, padding:"10px 12px", margin:"10px 14px 0", fontSize:12, lineHeight:1.45, display:"flex", gap:8, alignItems:"flex-start" }}>
      <div style={{ flex:1 }}>{loadErr}</div>
      <button onClick={() => setLoadErr("")} style={{ background:"transparent", border:"none", color:"#E56B6B", cursor:"pointer", fontSize:16, lineHeight:1, padding:0 }}>×</button>
    </div>
  ) : null;

  return (
    <Shell>
      <TopBar program={program} />
      {errBanner}
      <div style={{ padding: "0 14px 120px" }}>
        {tab === "log" && (
          draft
            ? <DraftView draft={draft} setDraft={setDraft} onSave={saveSession} onDiscard={discardDraft} restPrefs={restPrefs} saveRestPrefs={saveRestPrefs}
                lastForExercise={lastForExercise} exByKey={exByKey} gyms={gyms}
                onAddExercise={() => openPicker(k => { addExerciseToDraft(k); setPicker(null); })} />
            : <StartView program={program} activeDayId={activeDayId} setActiveDayId={setActiveDayId} onStart={startSession} sessions={sessions} />
        )}
        {tab === "history" && (
          viewSession
            ? <SessionDetail session={viewSession} onBack={() => setViewSession(null)} onDelete={deleteSession} onEdit={editSession} exByKey={exByKey} scoreOf={scoreOf} />
            : <HistoryList sessions={sessions} onOpen={setViewSession} scoreOf={scoreOf} />
        )}
        {tab === "trends" && <Trends sessions={sessions} allEx={allEx} exResolve={exByKey} scoreOf={scoreOf} />}
        {tab === "injury" && <InjuryTab injuries={injuries} saveInjuries={saveInjuries} sessions={sessions} />}
        {tab === "goals" && <GoalsTab onInstall={installGenerated} current={program} setTab={setTab} />}
        {tab === "program" && <ProgramEditor program={program} setProgram={saveProgram} exByKey={exByKey}
          openPicker={openPicker} custom={custom} removeCustom={removeCustom} updateCustom={updateCustom}
          exportJson={exportJson} importJson={importJson} onReset={resetProgram}
          onAdvanceWeek={advanceWeek} onExitMeso={exitMeso} restPrefs={restPrefs} saveRestPrefs={saveRestPrefs} />}
      </div>
      {picker && <Picker custom={custom} onAddCustom={addCustom} onPick={picker.onPick} initialQ={picker.initialQ} onClose={() => setPicker(null)} />}
      {toast && <div style={{ position:"fixed", bottom:"calc(76px + env(safe-area-inset-bottom))", left:"50%", transform:"translateX(-50%)", background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:20, padding:"8px 18px", fontSize:13, zIndex:70, whiteSpace:"nowrap" }}>{toast}</div>}
      <BottomNav tab={tab} setTab={t => { setViewSession(null); setTab(t); }} logging={!!draft} />
    </Shell>
  );
}

/* ============================================================
   Shell + nav
   ============================================================ */
function Shell({ children }) {
  return <div style={{ maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui,-apple-system,sans-serif" }}>{children}</div>;
}
function TopBar({ program }) {
  const st = program ? mesoStatus(program) : null;
  return (
    <div style={{ position:"sticky", top:0, zIndex:40, background:"rgba(14,17,22,.92)", backdropFilter:"blur(8px)", WebkitBackdropFilter:"blur(8px)", borderBottom:`1px solid ${C.line}`,
      display:"flex", alignItems:"center", justifyContent:"space-between", padding:"12px 16px" }}>
      <div style={{ fontSize:18, fontWeight:800, letterSpacing:1.5 }}>GYM<span style={{ color:C.acc }}>.</span></div>
      {st && (
        <div style={{ fontSize:11, fontWeight:700, color: st.isDeload ? C.gold : C.acc,
          background:C.panel2, border:`1px solid ${C.line}`, borderRadius:14, padding:"4px 10px" }}>
          {st.label}{st.rir ? ` · RIR ${st.rir.lo}–${st.rir.hi}` : ""}
        </div>
      )}
    </div>
  );
}

const NAV_ICONS = {
  log: <path d="M3 9v6M6 6v12M18 6v12M21 9v6M6 12h12" />,
  history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>,
  trends: <path d="M3 17l5-5 4 4 8-9M20 7h-5M20 7v5" />,
  injury: <path d="M12 4v16M4 12h16" />,
  goals: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>,
  program: <path d="M4 6h16M4 12h16M4 18h10" />
};
function NavIcon({ k }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {NAV_ICONS[k]}
    </svg>
  );
}
function BottomNav({ tab, setTab, logging }) {
  const tabs = [["log","Log"],["history","History"],["trends","Trends"],["injury","Injury"],["goals","Goals"],["program","Program"]];
  return (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, zIndex:50, display:"flex", justifyContent:"center",
      background:"rgba(21,26,33,.96)", backdropFilter:"blur(10px)", WebkitBackdropFilter:"blur(10px)", borderTop:`1px solid ${C.line}` }}>
      <div style={{ display:"flex", width:"100%", maxWidth:520, paddingBottom:"env(safe-area-inset-bottom)" }}>
        {tabs.map(([k, label]) => {
          const on = tab === k;
          return (
            <button key={k} onClick={() => setTab(k)} style={{
              flex:1, background:"transparent", border:"none", cursor:"pointer",
              color: on ? C.acc : C.dim, padding:"8px 0 7px",
              display:"flex", flexDirection:"column", alignItems:"center", gap:2, position:"relative" }}>
              {k === "log" && logging && !on && <span style={{ position:"absolute", top:6, right:"calc(50% - 16px)", width:6, height:6, borderRadius:3, background:C.acc, animation:"pulse 1.6s infinite" }} />}
              <NavIcon k={k} />
              <span style={{ fontSize:9, fontWeight: on ? 700 : 500, letterSpacing:0.2 }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
function Empty({ msg }) { return <div style={{ color:C.dim, fontSize:13, textAlign:"center", padding:30 }}>{msg}</div>; }

/* ============================================================
   Start view (pick day → begin)
   ============================================================ */
function StartView({ program, activeDayId, setActiveDayId, onStart, sessions }) {
  const thisWeek = isoWeek(TODAY());
  const doneThisWeek = sessions.filter(s => isoWeek(s.date) === thisWeek).length;
  const st = mesoStatus(program);
  const lastByDay = useMemo(() => {
    const m = {};
    sessions.forEach(s => { if (s.dayId && (!m[s.dayId] || s.date > m[s.dayId])) m[s.dayId] = s.date; });
    return m;
  }, [sessions]);
  const pct = program.target > 0 ? Math.min(100, (doneThisWeek / program.target) * 100) : 0;
  return (
    <div>
      {st && (
        <div style={{ ...card, borderColor: st.isDeload ? C.gold : C.acc, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:13, fontWeight:700, color: st.isDeload ? C.gold : C.acc }}>{st.label}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{st.splitName} · {st.goalLabel}</div>
          </div>
          <div style={{ textAlign:"right" }}>
            {st.rir
              ? <><div style={{ fontSize:18, fontWeight:700 }}>RIR {st.rir.lo}–{st.rir.hi}</div>
                  <div style={{ fontSize:10, color:C.dim }}>reps in reserve</div></>
              : <><div style={{ fontSize:18, fontWeight:700 }}>{st.week}/{st.total}</div>
                  <div style={{ fontSize:10, color:C.dim }}>week</div></>}
          </div>
        </div>
      )}
      <div style={{ ...card }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div><div style={{ fontSize:13, color:C.dim }}>This week</div>
            <div style={{ fontSize:22, fontWeight:700 }}>{doneThisWeek}<span style={{ fontSize:14, color:C.dim }}> / {program.target}</span></div></div>
          <div style={{ fontSize:11, color:C.dim, textAlign:"right" }}>sessions logged<br/>vs weekly target</div>
        </div>
        <div style={{ height:6, background:C.bg, border:`1px solid ${C.line}`, borderRadius:3, overflow:"hidden", marginTop:10 }}>
          <div style={{ height:"100%", width:`${pct}%`, background: pct >= 100 ? C.acc : C.blue, transition:"width .3s" }} />
        </div>
      </div>
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Start a session</div>
        {program.days.map(d => {
          const last = lastByDay[d.id];
          const ago = last != null ? daysAgo(last) : null;
          return (
            <button key={d.id} onClick={() => setActiveDayId(d.id)} style={{
              display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%",
              background: activeDayId===d.id ? C.panel2 : C.bg, color:C.ink,
              border:`1px solid ${activeDayId===d.id ? C.acc : C.line}`, borderRadius:10, padding:"12px 14px",
              marginBottom:8, cursor:"pointer", textAlign:"left" }}>
              <span style={{ fontWeight:600 }}>{d.name}</span>
              <span style={{ fontSize:11, color:C.dim, textAlign:"right" }}>
                {d.items.length} exercises
                {ago != null && <><br/>{ago === 0 ? "done today" : `last ${ago}d ago`}</>}
              </span>
            </button>
          );
        })}
        <button onClick={onStart} style={{ ...btn(C.acc, "#04150E"), marginTop:6 }}>Begin {program.days.find(d=>d.id===activeDayId)?.name || ""}</button>
      </div>
    </div>
  );
}

/* ============================================================
   Draft (logging) — with drag reorder + per-exercise notes
   ============================================================ */
function DraftView({ draft, setDraft, onSave, onDiscard, lastForExercise, exByKey, onAddExercise, gyms, restPrefs, saveRestPrefs }) {
  // ensure every entry has a stable id (handles drafts created before eid existed)
  useEffect(() => {
    if ((draft.entries || []).some(e => !e.eid)) {
      setDraft(d => ({ ...d, entries: d.entries.map(e => e.eid ? e : { ...e, eid: uid() }) }));
    }
  }, [draft.entries, setDraft]);
  const setEntry = (eid, fn) => setDraft(d => ({ ...d, entries: d.entries.map(e => e.eid === eid ? fn(e) : e) }));
  const rmEntry = eid => setDraft(d => ({ ...d, entries: d.entries.filter(e => e.eid !== eid) }));
  const moveEntry = (from, to) => setDraft(d => {
    const a = [...d.entries]; if (to < 0 || to >= a.length) return d;
    const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...d, entries: a };
  });

  /* elapsed session clock (only for live sessions, not edits) */
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!draft.startedAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(t);
  }, [draft.startedAt]);
  const elapsedMin = draft.startedAt ? Math.max(0, Math.round((nowTick - draft.startedAt) / 60000)) : null;

  /* rest timer: fires when a set is marked done. Length = per-exercise
     override if set, else the default from settings. Alerts (notification /
     sound / vibrate) fire from a setTimeout at the exact end, plus a
     late-fire check when the page comes back to the foreground. */
  const [restEnd, setRestEnd] = useState(null);
  const [restFor, setRestFor] = useState(""); // exercise name shown in the alert
  const [picker, setPicker] = useState(null); // null | { scope:"default" } | { scope:"ex", key, name }
  const prefsRef = useRef(restPrefs);
  useEffect(() => { prefsRef.current = restPrefs; }, [restPrefs]);
  const restLenFor = key => { const o = restPrefs.byEx && restPrefs.byEx[key]; return o != null ? o : restPrefs.len; };
  const startRest = useCallback((entry) => {
    const p = prefsRef.current;
    const o = entry && p.byEx && p.byEx[entry.key];
    const len = o != null ? o : p.len;
    if (len > 0) { setRestEnd(Date.now() + len * 1000); setRestFor(entry ? entry.name : ""); }
  }, []);
  const alerted = useRef(null);
  useEffect(() => {
    if (!restEnd) { alerted.current = null; return; }
    const fire = () => { if (alerted.current === restEnd) return; alerted.current = restEnd; fireRestAlert(prefsRef.current, restFor ? `${restFor}: next set` : "Next set"); };
    const ms = restEnd - Date.now();
    if (ms <= 0) { fire(); return; }
    const t = setTimeout(fire, ms);
    const onVis = () => { if (document.visibilityState === "visible" && Date.now() >= restEnd) fire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearTimeout(t); document.removeEventListener("visibilitychange", onVis); };
  }, [restEnd, restFor]);
  const draftRef = useRef(draft);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  /* Rest only fires when the block is actually over:
       - not if the next row of this exercise is a drop (no rest inside a drop set)
       - not if this exercise is followed by another member of its superset */
  const onSetDone = useCallback((entry, setIdx) => {
    const nextRow = entry.sets[setIdx + 1];
    if (nextRow && nextRow.drop) return;
    if (entry.group) {
      const ents = draftRef.current.entries;
      const at = ents.findIndex(e => e.eid === entry.eid);
      if (ents.some((e, j) => j > at && e.group === entry.group)) return;
    }
    ensureAudio(); // user gesture: unlock audio for the beep later
    startRest(entry);
  }, [startRest]);

  /* ---- supersets (ad hoc, per session) ----
     pairing = eid of the card that started a pair. Tapping "pair" on a second
     card joins them (reusing either card's existing group), then the joined
     card is moved to sit directly after the group so the log flows A1, A2. */
  const [pairing, setPairing] = useState(null);
  const groupLabels = useMemo(() => {
    const m = {}; let n = 0;
    draft.entries.forEach(e => { if (e.group && !(e.group in m)) m[e.group] = n++; });
    return m; // group id -> ordinal (0 = A)
  }, [draft.entries]);
  const groupInfo = e => {
    if (!e.group || !(e.group in groupLabels)) return null;
    const ord = groupLabels[e.group];
    const members = draft.entries.filter(x => x.group === e.group);
    const idx = members.findIndex(x => x.eid === e.eid);
    return { letter: String.fromCharCode(65 + ord), idx: idx + 1, color: SS_COLORS[ord % SS_COLORS.length], size: members.length };
  };
  const pairWith = eid => {
    const first = pairing; setPairing(null);
    if (!first || first === eid) return;
    setDraft(d => {
      const a = d.entries.find(e => e.eid === first), b = d.entries.find(e => e.eid === eid);
      if (!a || !b) return d;
      const gid = a.group || b.group || uid();
      let ents = d.entries.map(e => (e.eid === first || e.eid === eid || (a.group && e.group === a.group) || (b.group && e.group === b.group)) ? { ...e, group: gid } : e);
      // keep the group contiguous: pull the newly joined card in behind the group's last member
      const joined = ents.find(e => e.eid === eid);
      ents = ents.filter(e => e.eid !== eid);
      let lastIdx = -1; ents.forEach((e, i) => { if (e.group === gid) lastIdx = i; });
      ents.splice(lastIdx + 1, 0, joined);
      return { ...d, entries: ents };
    });
  };
  const unlink = eid => setDraft(d => {
    const me = d.entries.find(e => e.eid === eid); if (!me || !me.group) return d;
    const left = d.entries.filter(e => e.group === me.group && e.eid !== eid);
    return { ...d, entries: d.entries.map(e => {
      if (e.eid === eid) return { ...e, group: null };
      if (left.length < 2 && e.group === me.group) return { ...e, group: null }; // a group of one is not a superset
      return e;
    }) };
  });

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const totalSets = draft.entries.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = draft.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);

  return (
    <div>
      <div style={{ ...card }}>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <div style={{ flex:1 }}>
            <input style={{ ...inp, textAlign:"left", fontWeight:700, fontSize:16, padding:"4px 8px" }} value={draft.dayName}
              onChange={e => setDraft(d => ({ ...d, dayName: e.target.value }))} />
          </div>
          <div style={{ width:110 }}>
            <label style={{ fontSize:10, color:C.dim }}>bodyweight kg</label>
            <input style={inp} inputMode="decimal" value={draft.bodyweight} placeholder="—"
              onChange={e => setDraft(d => ({ ...d, bodyweight: e.target.value }))} />
          </div>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:8 }}>
          <div style={{ fontSize:11, color:C.dim }}>
            {draft.date}
            {elapsedMin != null && <> · <span style={{ color:C.ink, fontWeight:600 }}>{fmtDur(elapsedMin)}</span></>}
            {totalSets > 0 && <> · {doneSets}/{totalSets} sets done</>}
          </div>
          <button onClick={() => setPicker({ scope:"default" })} style={{ background:C.bg, border:`1px solid ${C.line}`, color: restPrefs.len ? C.acc : C.dim, borderRadius:12, padding:"3px 10px", fontSize:11, fontWeight:600, cursor:"pointer" }}>
            rest {fmtRest(restPrefs.len)}
          </button>
        </div>
        <GymPicker gym={draft.gym} gyms={gyms || []} onSet={g => setDraft(d => ({ ...d, gym: g }))} />
        <div style={{ fontSize:10, color:C.dim, marginTop:4 }}>tap a set number to mark it done · long-press ⠿ to reorder · ↓ = drop set (no rest) · SS = superset</div>
      </div>

      <DragList
        items={draft.entries}
        keyOf={e => e.eid || e.key}
        onMove={moveEntry}
        render={(e, i, dragHandle) => (
          <ExerciseCard entry={e} setEntry={setEntry} rmEntry={rmEntry} prev={lastForExercise(e.key)} ex={exByKey(e.key)} dragHandle={dragHandle} onSetDone={onSetDone}
            ss={groupInfo(e)} pairing={pairing}
            restOverride={restPrefs.byEx && restPrefs.byEx[e.key]}
            onRestPick={() => setPicker({ scope:"ex", key: e.key, name: e.name })}
            onPairStart={() => setPairing(p => p === e.eid ? null : e.eid)}
            onPairWith={() => pairWith(e.eid)}
            onUnlink={() => unlink(e.eid)} />
        )}
      />

      <button onClick={onAddExercise} style={{ ...btn(C.panel2, C.acc), marginTop:12, border:`1px dashed ${C.line}` }}>+ add exercise from library</button>

      <FeelRating draft={draft} setDraft={setDraft} />

      <DraftInjuries draft={draft} setDraft={setDraft} />

      {!confirmDiscard ? (
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button style={{ ...btn(C.panel2, C.dim), flex:"0 0 90px" }} onClick={() => setConfirmDiscard(true)}>Discard</button>
          <button style={btn(C.acc, "#04150E")} onClick={onSave}>Save session</button>
        </div>
      ) : (
        <div style={{ ...card, borderColor:C.warn }}>
          <div style={{ fontSize:13, marginBottom:10 }}>Discard this session? Everything entered will be lost.</div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={() => setConfirmDiscard(false)} style={btn(C.panel2, C.dim)}>Keep logging</button>
            <button onClick={onDiscard} style={btn(C.warn, "#1A0E0E")}>Discard</button>
          </div>
        </div>
      )}

      {restEnd && <RestPill endAt={restEnd} step={restPrefs.step || 30} label={restFor} onExtend={() => setRestEnd(t => t + (restPrefs.step || 30) * 1000)} onClear={() => setRestEnd(null)} />}
      {picker && (
        <RestPicker
          title={picker.scope === "ex" ? picker.name : "Default rest"}
          value={picker.scope === "ex" ? (restPrefs.byEx && restPrefs.byEx[picker.key] != null ? restPrefs.byEx[picker.key] : null) : restPrefs.len}
          fallback={picker.scope === "ex" ? restPrefs.len : null}
          onPick={v => {
            if (picker.scope === "ex") saveRestPrefs(p => { const byEx = { ...(p.byEx || {}) }; if (v == null) delete byEx[picker.key]; else byEx[picker.key] = v; return { byEx }; });
            else { saveRestPrefs({ len: v }); if (v === 0) setRestEnd(null); }
            setPicker(null);
          }}
          onClose={() => setPicker(null)} />
      )}
    </div>
  );
}

/* gym selector: chips for known gyms + inline add-new */
function GymPicker({ gym, gyms, onSet }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const chip = (on) => ({ background: on ? C.panel2 : "transparent", color: on ? C.acc : C.dim,
    border:`1px solid ${on ? C.acc : C.line}`, borderRadius:12, padding:"4px 10px", fontSize:11,
    fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" });
  const commit = () => {
    const n = name.trim();
    if (n) onSet(n);
    setName(""); setAdding(false);
  };
  // show current gym even if it's not in the saved list yet
  const list = gym && !gyms.includes(gym) ? [...gyms, gym] : gyms;
  return (
    <div style={{ marginTop:8 }}>
      <div style={{ display:"flex", gap:6, alignItems:"center", overflowX:"auto", WebkitOverflowScrolling:"touch", paddingBottom:2 }}>
        <span style={{ fontSize:10, color:C.dim, flexShrink:0 }}>gym</span>
        <button onClick={() => onSet(null)} style={chip(!gym)}>none</button>
        {list.map(g => <button key={g} onClick={() => onSet(g)} style={chip(gym === g)}>{g}</button>)}
        {!adding && <button onClick={() => setAdding(true)} style={{ ...chip(false), borderStyle:"dashed" }}>+ new</button>}
      </div>
      {adding && (
        <div style={{ display:"flex", gap:6, marginTop:6 }}>
          <input style={{ ...inp, textAlign:"left", fontSize:13, padding:"6px 10px" }} value={name} autoFocus
            placeholder="gym name" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && commit()} />
          <button onClick={commit} style={{ background:C.acc, color:"#04150E", border:"none", borderRadius:8, padding:"0 14px", fontSize:12, fontWeight:700, cursor:"pointer" }}>Add</button>
          <button onClick={() => { setAdding(false); setName(""); }} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:8, padding:"0 10px", fontSize:12, cursor:"pointer" }}>×</button>
        </div>
      )}
    </div>
  );
}

/* floating rest countdown, sits above the bottom nav */
function RestPill({ endAt, onExtend, onClear, step, label }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const rem = Math.max(0, Math.ceil((endAt - now) / 1000));
  const finished = rem === 0;
  // alerts (vibrate / sound / notification) fire from DraftView's timeout, not here
  return (
    <div style={{ position:"fixed", bottom:"calc(64px + env(safe-area-inset-bottom))", left:"50%", transform:"translateX(-50%)",
      display:"flex", alignItems:"center", gap:12, zIndex:60,
      background: finished ? C.acc : C.panel2, color: finished ? "#04150E" : C.ink,
      border:`1px solid ${finished ? C.acc : C.line}`, borderRadius:24, padding:"9px 16px",
      boxShadow:"0 4px 16px rgba(0,0,0,.5)", animation: finished ? "pulse 1.2s infinite" : "none" }}>
      <span style={{ fontSize:15, fontWeight:800, fontVariantNumeric:"tabular-nums", minWidth:44 }}>
        {finished ? "GO" : fmtSec(rem)}
      </span>
      {!finished && label && <span style={{ fontSize:11, color:C.dim, maxWidth:110, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>}
      {!finished && <button onClick={onExtend} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.ink, borderRadius:12, padding:"2px 10px", fontSize:12, fontWeight:600, cursor:"pointer" }}>+{step}s</button>}
      <button onClick={onClear} style={{ background:"transparent", border:"none", color:"inherit", fontSize:17, cursor:"pointer", padding:0, lineHeight:1 }}>×</button>
    </div>
  );
}

/* bottom sheet: presets + 15 s stepper. value null = "use default" (per-exercise scope) */
function RestPicker({ title, value, fallback, onPick, onClose }) {
  const [v, setV] = useState(value == null ? (fallback != null ? fallback : 120) : value);
  const chip = (sec, on) => ({ background: on ? C.acc : C.bg, color: on ? "#04150E" : C.ink, border:`1px solid ${on ? C.acc : C.line}`, borderRadius:12, padding:"7px 0", fontSize:13, fontWeight:700, cursor:"pointer", flex:"1 1 21%", minWidth:60 });
  const stepBtn = { background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:10, width:52, height:44, fontSize:20, fontWeight:700, cursor:"pointer" };
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.55)", zIndex:80, display:"flex", alignItems:"flex-end" }}>
      <div onClick={e => e.stopPropagation()} style={{ background:C.panel, borderTop:`1px solid ${C.line}`, borderRadius:"16px 16px 0 0", padding:"14px 16px calc(18px + env(safe-area-inset-bottom))", width:"100%" }}>
        <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between" }}>
          <div style={{ fontSize:14, fontWeight:700 }}>{title}</div>
          <div style={{ fontSize:11, color:C.dim }}>{fallback != null ? `default ${fmtRest(fallback)}` : "rest between sets"}</div>
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:14, margin:"14px 0" }}>
          <button onClick={() => setV(x => Math.max(0, x - 15))} style={stepBtn}>−</button>
          <div style={{ fontSize:34, fontWeight:800, fontVariantNumeric:"tabular-nums", minWidth:110, textAlign:"center", color: v ? C.ink : C.dim }}>{fmtRest(v)}</div>
          <button onClick={() => setV(x => Math.min(900, x + 15))} style={stepBtn}>+</button>
        </div>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
          {REST_PRESETS.map(sec => <button key={sec} onClick={() => setV(sec)} style={chip(sec, sec === v)}>{fmtRest(sec)}</button>)}
        </div>
        <div style={{ display:"flex", gap:8, marginTop:14 }}>
          {fallback != null && <button onClick={() => onPick(null)} style={{ ...btn(C.panel2, C.ink), flex:1 }}>Use default</button>}
          <button onClick={() => onPick(v)} style={{ ...btn(C.acc, "#04150E"), flex:2 }}>Set {fmtRest(v)}</button>
        </div>
      </div>
    </div>
  );
}

/* settings card for the rest timer + alerts (lives in the Program tab) */
function RestSettings({ prefs, save }) {
  const [perm, setPerm] = useState(notifState());
  const [picker, setPicker] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const row = { display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 0", borderBottom:`1px solid ${C.line}` };
  const Toggle = ({ on, onChange, disabled }) => (
    <button disabled={disabled} onClick={() => onChange(!on)} style={{ width:46, height:26, borderRadius:13, border:"none", cursor: disabled ? "default" : "pointer", opacity: disabled ? .4 : 1, background: on ? C.acc : C.line, position:"relative", padding:0 }}>
      <span style={{ position:"absolute", top:3, left: on ? 23 : 3, width:20, height:20, borderRadius:10, background: on ? "#04150E" : C.ink, transition:"left .15s" }} />
    </button>
  );
  const enableNotify = async on => {
    if (!on) { save({ notify: false }); return; }
    if (!notifSupported()) { setPerm("unsupported"); return; }
    let p = Notification.permission;
    if (p !== "granted") { try { p = await Notification.requestPermission(); } catch (e) { p = Notification.permission; } }
    setPerm(p);
    save({ notify: p === "granted" });
  };
  const test = () => { ensureAudio(); fireRestAlert(prefs, "Test alert"); setTestMsg("sent"); setTimeout(() => setTestMsg(""), 1500); };
  const overrides = Object.entries(prefs.byEx || {});
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = window.matchMedia && window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const permNote = perm === "granted" ? "allowed"
    : perm === "denied" ? "blocked in system settings"
    : perm === "unsupported" ? (isIOS && !standalone ? "iPhone: add to Home Screen first" : "not supported in this browser")
    : "tap to allow";
  return (
    <div style={card}>
      <div style={{ fontSize:12, color:C.dim, marginBottom:4, textTransform:"uppercase", letterSpacing:0.5 }}>Rest timer & alerts</div>
      <div style={row}>
        <div><div style={{ fontSize:14 }}>Default rest</div><div style={{ fontSize:11, color:C.dim }}>after each working set · per-exercise ⏱ overrides win</div></div>
        <button onClick={() => setPicker(true)} style={{ background:C.bg, border:`1px solid ${C.line}`, color: prefs.len ? C.acc : C.dim, borderRadius:12, padding:"6px 12px", fontSize:13, fontWeight:700, cursor:"pointer" }}>{fmtRest(prefs.len)}</button>
      </div>
      <div style={row}>
        <div><div style={{ fontSize:14 }}>Extend step</div><div style={{ fontSize:11, color:C.dim }}>the + button on the running timer</div></div>
        <div style={{ display:"flex", gap:4 }}>
          {[15, 30, 60].map(v => <button key={v} onClick={() => save({ step: v })} style={{ background: prefs.step === v ? C.acc : C.bg, color: prefs.step === v ? "#04150E" : C.ink, border:`1px solid ${prefs.step === v ? C.acc : C.line}`, borderRadius:10, padding:"5px 9px", fontSize:12, fontWeight:700, cursor:"pointer" }}>+{v}s</button>)}
        </div>
      </div>
      <div style={row}>
        <div><div style={{ fontSize:14 }}>Notification when rest ends</div><div style={{ fontSize:11, color: perm === "denied" ? C.warn : C.dim }}>{permNote}</div></div>
        <Toggle on={!!prefs.notify && perm === "granted"} onChange={enableNotify} disabled={perm === "denied" || perm === "unsupported"} />
      </div>
      <div style={row}>
        <div><div style={{ fontSize:14 }}>Sound</div><div style={{ fontSize:11, color:C.dim }}>three short beeps · needs the ringer on</div></div>
        <Toggle on={!!prefs.sound} onChange={v => save({ sound: v })} />
      </div>
      <div style={{ ...row, borderBottom:"none" }}>
        <div><div style={{ fontSize:14 }}>Vibrate</div><div style={{ fontSize:11, color:C.dim }}>Android only; iPhone ignores it</div></div>
        <Toggle on={!!prefs.vibrate} onChange={v => save({ vibrate: v })} />
      </div>
      <div style={{ display:"flex", gap:8, alignItems:"center", marginTop:6 }}>
        <button onClick={test} style={{ ...btn(C.panel2, C.ink), width:"auto", padding:"8px 14px" }}>Test alert</button>
        <span style={{ fontSize:11, color:C.acc }}>{testMsg}</span>
      </div>
      <div style={{ fontSize:10, color:C.dim, marginTop:8, lineHeight:1.4 }}>
        Alerts fire from the app itself. They land while the app is on screen or for a few seconds after you switch away; if the phone locks mid-rest, the alert fires the moment you reopen the app. Web apps can't schedule a notification for later.
      </div>
      {overrides.length > 0 && (
        <div style={{ marginTop:10 }}>
          <div style={{ fontSize:11, color:C.dim, marginBottom:4 }}>Per-exercise overrides</div>
          {overrides.map(([k, sec]) => (
            <div key={k} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", fontSize:12, padding:"4px 0" }}>
              <span>{k.replace(/^lib:|^custom:/, "")}</span>
              <span style={{ display:"flex", gap:8, alignItems:"center" }}>
                <span style={{ color:C.acc, fontWeight:700 }}>{fmtRest(sec)}</span>
                <button onClick={() => save(p => { const byEx = { ...(p.byEx || {}) }; delete byEx[k]; return { byEx }; })} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:15, padding:0 }}>×</button>
              </span>
            </div>
          ))}
        </div>
      )}
      {picker && <RestPicker title="Default rest" value={prefs.len} fallback={null} onPick={v => { save({ len: v }); setPicker(false); }} onClose={() => setPicker(false)} />}
    </div>
  );
}

/* generic pointer-based drag list (works on iOS touch) */
function DragList({ items, keyOf, onMove, render }) {
  const [dragIdx, setDragIdx] = useState(null);
  const containerRef = useRef(null);
  const rowsRef = useRef([]);

  const onPointerDown = (i) => (ev) => {
    ev.preventDefault();
    setDragIdx(i);
    const move = (e) => {
      const y = (e.touches ? e.touches[0].clientY : e.clientY);
      const rows = rowsRef.current;
      for (let j = 0; j < rows.length; j++) {
        const el = rows[j]; if (!el) continue;
        const r = el.getBoundingClientRect();
        if (y >= r.top && y <= r.bottom) {
          setDragIdx(cur => {
            if (cur !== null && cur !== j) { onMove(cur, j); return j; }
            return cur;
          });
          break;
        }
      }
    };
    const up = () => {
      setDragIdx(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
    window.addEventListener("pointermove", move, { passive:false });
    window.addEventListener("pointerup", up);
    window.addEventListener("touchmove", move, { passive:false });
    window.addEventListener("touchend", up);
  };

  return (
    <div ref={containerRef}>
      {items.map((it, i) => {
        const handle = (
          <button
            onPointerDown={onPointerDown(i)}
            style={{ touchAction:"none", background:"transparent", border:"none", color:C.dim, cursor:"grab", fontSize:18, padding:"0 6px", lineHeight:1 }}
            aria-label="drag to reorder">⠿</button>
        );
        return (
          <div key={keyOf(it)} ref={el => rowsRef.current[i] = el}
            style={{ opacity: dragIdx===i ? 0.5 : 1, transition:"opacity .1s" }}>
            {render(it, i, handle)}
          </div>
        );
      })}
    </div>
  );
}

function ExerciseCard({ entry, setEntry, rmEntry, prev, ex, dragHandle, onSetDone, ss, pairing, onPairStart, onPairWith, onUnlink, restOverride, onRestPick }) {
  const blank = blankSet(entry.t);
  const [collapsed, setCollapsed] = useState(false);
  const [plates, setPlates] = useState(false);
  // new normal set copies the last NON-drop row (a drop row is not a template for a fresh set)
  const addSet = () => setEntry(entry.eid, e => {
    const tmpl = [...e.sets].reverse().find(s => !s.drop) || e.sets[e.sets.length-1] || blank;
    const { drop, ...rest } = tmpl;
    return { ...e, sets: [...e.sets, { ...rest, done: false }] };
  });
  // drop row: continues the row above with no rest. Weight left blank so the
  // placeholder (~-20% of the row above) shows; reps blank too.
  const addDrop = () => setEntry(entry.eid, e => {
    if (!e.sets.length) return e;
    const last = e.sets[e.sets.length-1];
    const row = { ...last, done: false, drop: true, r: "", rpe: "" };
    if ("w" in row) row.w = "";
    return { ...e, sets: [...e.sets, row] };
  });
  const rmSet = i => setEntry(entry.eid, e => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }));
  const upd = (i, k, v) => setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j===i ? { ...s, [k]: v } : s) }));
  const toggleDone = i => {
    const wasDone = !!entry.sets[i].done;
    setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j===i ? { ...s, done: !s.done } : s) }));
    if (!wasDone && onSetDone) onSetDone(entry, i);
  };
  const setNote = v => setEntry(entry.eid, e => ({ ...e, note: v }));
  // copy last session's actual values into the inputs (placeholders don't save)
  const useLast = () => {
    if (!prev || !prev.length) return;
    const toStr = v => v == null ? "" : String(v);
    setEntry(entry.eid, e => ({ ...e, sets: prev.map(s => {
      const d = s.drop ? { drop: true } : {};
      if (e.t === "wr") return { w: toStr(s.w), r: toStr(s.r), rpe: toStr(s.rpe), done: false, ...d };
      if (e.t === "rep") return { r: toStr(s.r), add: toStr(s.add), rpe: toStr(s.rpe), done: false, ...d };
      if (e.t === "time") return { sec: toStr(s.sec), done: false };
      if (e.t === "wd") return { w: toStr(s.w), dist: toStr(s.dist), done: false };
      return { sec: toStr(s.sec), dist: toStr(s.dist), done: false };
    }) }));
  };

  const cols = { wr:["kg","reps","rpe"], rep:["reps","+kg","rpe"], time:["sec"], wd:["kg","dist m"], cardio:["min","dist km"] }[entry.t];
  const keys = { wr:["w","r","rpe"], rep:["r","add","rpe"], time:["sec"], wd:["w","dist"], cardio:["sec","dist"] }[entry.t];
  const grid = `30px ${cols.map(() => "1fr").join(" ")} 24px`;
  const hint = targetHint(entry.t, entry.target);
  const rp = rpHint(ex);
  const prevStr = prev ? prevSummary(entry.t, prev) : null;
  const nDone = entry.sets.filter(s => s.done).length;
  const ph = (k, i) => {
    const row = i != null ? entry.sets[i] : null;
    if (k === "add") return entry.ghostAdd || "0";
    // drop row: weight ghost = ~80% of the row above (typed value, else its own ghost)
    if (row && row.drop && k === "w" && i > 0) {
      const above = entry.sets[i-1];
      const base = above.w !== "" ? Number(above.w) : Number(ph("w", i-1));
      const d = base > 0 ? roundLoad(base * 0.8) : null;
      return d ? String(d) : "—";
    }
    if (row && row.drop && k === "r") return "—";
    // per-set plan (double progression / 5/3/1 percents) wins; then program
    // target; then computed ghost (last session / seed).
    const p = entry.plan && entry.plan[i != null ? Math.min(i, entry.plan.length - 1) : 0];
    if (p) {
      if (k === "w" && p.w) return p.w;
      if (k === "r" && p.r) return p.r;
    }
    const t = entry.target;
    if (k === "w") {
      if (entry.ghostW) return entry.ghostW;       // progression / seed
      if (t && t.w != null) return String(t.w);    // goal weight
      return "—";
    }
    if (k === "r") {
      if (entry.ghostR) return entry.ghostR;
      if (t && t.repLo != null) return String(t.repLo);
      return "—";
    }
    if (k === "sec") {
      if (entry.ghostR) return entry.ghostR;
      if (t && t.repLo != null) return String(t.repLo);
      return "—";
    }
    return "—";
  };
  // seed for the plate calculator: first typed weight, else placeholder weight
  const plateSeed = () => {
    if (entry.t !== "wr" && entry.t !== "wd") return "";
    const typed = entry.sets.find(s => s.w !== "");
    if (typed) return typed.w;
    const p = ph("w", 0);
    return p === "—" ? "" : p;
  };

  const canSS = !!onPairStart;
  const iAmPairing = pairing === entry.eid;
  const ssBtn = { background:"transparent", border:`1px solid ${C.line}`, borderRadius:10, padding:"1px 8px", fontSize:10, fontWeight:700, cursor:"pointer", whiteSpace:"nowrap" };
  return (
    <div style={{ ...card, borderLeft: ss ? `3px solid ${ss.color}` : card.border }}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {dragHandle}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>
            {ss && <span style={{ fontSize:10, fontWeight:800, color:"#04150E", background:ss.color, borderRadius:6, padding:"1px 6px", marginRight:6, verticalAlign:"middle", letterSpacing:0.5 }}>{ss.letter}{ss.idx}</span>}
            {entry.name} <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>· {T_LABEL[entry.t]}</span>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:2, flexWrap:"wrap" }}>
            {hint && <span style={{ fontSize:11, color:C.acc }}>{hint}</span>}
            {entry.progNote && <span style={{ fontSize:10, fontWeight:600,
              color: entry.progNote.includes("▲") ? C.acc : entry.progNote.includes("deload") ? C.gold : C.dim }}>{entry.progNote}</span>}
            {entry.est && (entry.ghostW || (entry.target && entry.target.w != null)) && <span style={{ fontSize:10, color:C.gold }}>est · confirm</span>}
            {rp && <span style={{ fontSize:11, color:C.dim }}>{rp}</span>}
          </div>
          {prevStr && (
            <div style={{ display:"flex", gap:8, alignItems:"baseline", marginTop:3, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, color:C.blue, fontWeight:600 }}>last: {prevStr}</span>
              <button onClick={useLast} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.blue, borderRadius:10, padding:"1px 8px", fontSize:10, fontWeight:600, cursor:"pointer" }}>use last</button>
            </div>
          )}
          {canSS && (
            <div style={{ display:"flex", gap:6, marginTop:4, flexWrap:"wrap", alignItems:"center" }}>
              {pairing && !iAmPairing
                ? <button onClick={onPairWith} style={{ ...ssBtn, color:"#04150E", background:C.acc, border:"none" }}>← pair here</button>
                : <button onClick={onPairStart} style={{ ...ssBtn, color: iAmPairing ? C.gold : C.dim }}>{iAmPairing ? "tap another exercise… (cancel)" : (ss ? "SS +" : "SS")}</button>}
              {ss && !pairing && <button onClick={onUnlink} style={{ ...ssBtn, color:C.dim }}>unlink</button>}
              {onRestPick && <button onClick={onRestPick} style={{ ...ssBtn, color: restOverride != null ? C.acc : C.dim }}>⏱ {restOverride != null ? fmtRest(restOverride) : "rest"}</button>}
              {ss && !pairing && <span style={{ fontSize:10, color:C.dim }}>superset {ss.letter} · rest after {ss.letter}{ss.size}</span>}
            </div>
          )}
        </div>
        <button onClick={() => setCollapsed(c => !c)} aria-label={collapsed ? "expand" : "collapse"}
          style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:13, padding:"4px 6px", transform: collapsed ? "rotate(-90deg)" : "none", transition:"transform .15s" }}>▾</button>
        <button onClick={() => rmEntry(entry.eid)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:13 }}>remove</button>
      </div>

      {collapsed ? (
        <div style={{ fontSize:12, color: nDone === entry.sets.length && entry.sets.length > 0 ? C.acc : C.dim, marginTop:8 }}>
          {nDone}/{entry.sets.length} sets done
        </div>
      ) : (
      <div style={{ marginTop:10 }}>
        <div style={{ display:"grid", gridTemplateColumns:grid, gap:6, fontSize:10, color:C.dim, marginBottom:4, textAlign:"center" }}>
          <span>#</span>{cols.map(c => <span key={c}>{c}</span>)}<span/>
        </div>
        {entry.sets.map((s, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:grid, gap:6, marginBottom:6, alignItems:"center", opacity: s.done ? 0.65 : 1 }}>
            <button onClick={() => toggleDone(i)} aria-label={s.done ? "mark set not done" : "mark set done"} style={{
              width:28, height:28, borderRadius:14, cursor:"pointer", fontSize:12, fontWeight:700, padding:0,
              background: s.done ? C.acc : "transparent", color: s.done ? "#04150E" : C.dim,
              border:`1px solid ${s.done ? C.acc : C.line}`, ...(s.drop && !s.done ? { color:C.gold, borderColor:C.gold } : {}) }}>
              {s.done ? "✓" : (s.drop ? "↓" : i+1)}
            </button>
            {keys.map(k => <input key={k} style={inp} inputMode="decimal" enterKeyHint="next" value={s[k]} placeholder={ph(k, i)}
              onFocus={ev => ev.target.select()} onChange={ev => upd(i, k, ev.target.value)} />)}
            <button onClick={() => rmSet(i)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:16 }}>×</button>
          </div>
        ))}
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={addSet} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.acc, borderRadius:8, padding:"6px 0", fontSize:12, flex:1, cursor:"pointer" }}>+ set</button>
          {(entry.t === "wr" || entry.t === "rep") && entry.sets.length > 0 && (
            <button onClick={addDrop} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.gold, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>+ drop</button>
          )}
          {(entry.t === "wr" || entry.t === "wd") && (
            <button onClick={() => setPlates(true)} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.dim, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", whiteSpace:"nowrap" }}>plates</button>
          )}
        </div>

        <input style={{ ...inp, textAlign:"left", marginTop:8, fontSize:14 }} value={entry.note || ""} placeholder="note (form cue, pain, tempo…)" onChange={e => setNote(e.target.value)} />
      </div>
      )}
      {plates && <PlateCalc initial={plateSeed()} onClose={() => setPlates(false)} />}
    </div>
  );
}

/* per-side plate breakdown for barbell loading */
function PlateCalc({ initial, onClose }) {
  const [w, setW] = useState(initial || "");
  const [bar, setBar] = useState(20);
  const total = Number(w) || 0;
  const perSide = (total - bar) / 2;
  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  let rem = perSide, out = [];
  if (perSide > 0) {
    PLATES.forEach(p => { const n = Math.floor((rem + 1e-9) / p); if (n > 0) { out.push([p, n]); rem = Math.round((rem - n * p) * 100) / 100; } });
  }
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:70, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }} onClick={onClose}>
      <div style={{ background:C.panel, border:`1px solid ${C.line}`, borderRadius:14, padding:16, width:"100%", maxWidth:340 }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontSize:15, fontWeight:700 }}>Plate calculator</div>
          <button onClick={onClose} style={{ background:"transparent", border:"none", color:C.dim, fontSize:20, cursor:"pointer" }}>×</button>
        </div>
        <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:10, color:C.dim }}>total kg</label>
            <input style={inp} inputMode="decimal" value={w} autoFocus onFocus={e => e.target.select()} onChange={e => setW(e.target.value)} />
          </div>
          <div style={{ flex:1 }}>
            <label style={{ fontSize:10, color:C.dim }}>bar</label>
            <div style={{ display:"flex", gap:4 }}>
              {[20, 15].map(b => (
                <button key={b} onClick={() => setBar(b)} style={{
                  flex:1, background: bar===b ? C.panel2 : C.bg, color: bar===b ? C.acc : C.dim,
                  border:`1px solid ${bar===b ? C.acc : C.line}`, borderRadius:8, padding:"8px 0", fontSize:14, fontWeight:600, cursor:"pointer" }}>{b}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ marginTop:14, minHeight:40 }}>
          {total <= 0 ? <div style={{ fontSize:12, color:C.dim }}>Enter a weight.</div>
          : total < bar ? <div style={{ fontSize:12, color:C.warn }}>Below bar weight.</div>
          : perSide === 0 ? <div style={{ fontSize:13, color:C.acc, fontWeight:600 }}>Empty bar.</div>
          : (
            <>
              <div style={{ fontSize:11, color:C.dim, marginBottom:6 }}>per side ({perSide} kg):</div>
              <div style={{ display:"flex", gap:6, flexWrap:"wrap" }}>
                {out.map(([p, n]) => (
                  <span key={p} style={{ background:C.panel2, border:`1px solid ${C.line}`, borderRadius:8, padding:"6px 10px", fontSize:13, fontWeight:700 }}>
                    {p}<span style={{ color:C.dim, fontWeight:400, fontSize:11 }}> ×{n}</span>
                  </span>
                ))}
              </div>
              {rem > 0.01 && <div style={{ fontSize:11, color:C.gold, marginTop:6 }}>{rem} kg/side unloadable with standard plates — nearest is {Math.round((total - 2*rem)*100)/100} kg total.</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function targetHint(t, target) {
  if (!target) return null;
  const reps = target.repLo === target.repHi ? `${target.repLo}` : `${target.repLo}–${target.repHi}`;
  if (t === "wr") return `target ${target.sets}×${reps}${target.w!=null ? ` @ ${target.w}kg` : ""}`;
  if (t === "rep") return `target ${target.sets}×${reps}`;
  if (t === "time") return `target ${target.sets} hold`;
  return `target ${target.sets} sets`;
}
function prevSummary(t, sets) {
  const dp = s => s.drop ? "↓" : "";
  if (t === "wr") return sets.map(s => `${dp(s)}${s.w}×${s.r}`).join(", ");
  if (t === "rep") return sets.map(s => `${dp(s)}${s.r}${isLoadedSet(s) ? fmtAdd(s.add) : ""}`).join(", ");
  if (t === "time") return sets.map(s => `${s.sec}s`).join(", ");
  if (t === "wd") return sets.map(s => `${s.w}kg/${s.dist}m`).join(", ");
  return sets.map(s => `${Math.round((s.sec||0)/60)}min/${s.dist}km`).join(", ");
}

/* session-level readiness/feel: 1-10, higher = fresher/better. null = not set */
function FeelRating({ draft, setDraft }) {
  const v = draft.feel;
  const set = n => setDraft(d => ({ ...d, feel: n }));
  const labelFor = n => n == null ? "not rated"
    : n <= 2 ? "wrecked" : n <= 4 ? "flat" : n <= 6 ? "ok" : n <= 8 ? "good" : "primed";
  return (
    <div style={{ ...card }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:8 }}>
        <div style={{ fontSize:12, color:C.dim, textTransform:"uppercase", letterSpacing:0.5 }}>How I felt</div>
        <div style={{ fontSize:13, fontWeight:700, color: v==null ? C.dim : C.acc }}>
          {v==null ? "—" : `${v}/10`} <span style={{ fontSize:11, color:C.dim, fontWeight:400 }}>{labelFor(v)}</span>
        </div>
      </div>
      <input type="range" min="1" max="10" step="1" value={v==null ? 5 : v}
        onChange={e => set(Number(e.target.value))}
        style={{ width:"100%", accentColor:C.acc }} />
      <div style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:C.dim, marginTop:2 }}>
        <span>1 · wrecked</span><span>10 · primed</span>
      </div>
      {v!=null && <button onClick={() => set(null)} style={{ background:"transparent", border:"none", color:C.dim, fontSize:11, cursor:"pointer", marginTop:6, padding:0 }}>clear rating</button>}
    </div>
  );
}

/* injuries logged within a draft session */
function DraftInjuries({ draft, setDraft }) {
  const list = draft.injuries || [];
  if (list.length === 0) return null;
  const upd = (idx, fn) => setDraft(d => ({ ...d, injuries: d.injuries.map((x, j) => j===idx ? fn(x) : x) }));
  return (
    <div style={{ ...card, borderColor:"#3A2A2A" }}>
      <div style={{ fontSize:12, color:C.dim, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Injury check-in</div>
      {list.map((inj, i) => (
        <div key={i} style={{ marginBottom: i < list.length-1 ? 14 : 0 }}>
          <div style={{ fontSize:13, fontWeight:600, marginBottom:6 }}>{inj.name}</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <div style={{ flex:1 }}>
              <label style={{ fontSize:10, color:C.dim }}>pain {inj.pain}/10</label>
              <input type="range" min="0" max="10" value={inj.pain} onChange={e => upd(i, x => ({ ...x, pain: Number(e.target.value) }))} style={{ width:"100%", accentColor:C.knee }} />
            </div>
            <label style={{ fontSize:12, color:C.dim, display:"flex", gap:6, alignItems:"center" }}>
              <input type="checkbox" checked={inj.swelling} onChange={e => upd(i, x => ({ ...x, swelling: e.target.checked }))} />swelling
            </label>
          </div>
          <input style={{ ...inp, textAlign:"left", marginTop:6, fontSize:13 }} value={inj.note} placeholder="note (e.g. tight on flexion)" onChange={e => upd(i, x => ({ ...x, note: e.target.value }))} />
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   History — list of past sessions + read-only detail
   ============================================================ */
function HistoryList({ sessions, onOpen, scoreOf }) {
  const [q, setQ] = useState("");
  if (sessions.length === 0) return <Empty msg="No sessions logged yet. Start one from the Log tab." />;
  const ql = q.trim().toLowerCase();
  const rev = sessions.slice().reverse().filter(s =>
    !ql || s.dayName.toLowerCase().includes(ql) || s.entries.some(e => e.name.toLowerCase().includes(ql)));
  const thisWeek = isoWeek(TODAY());
  // group by ISO week, newest first
  const groups = [];
  rev.forEach(s => {
    const wk = isoWeek(s.date);
    const g = groups[groups.length - 1];
    if (g && g.wk === wk) g.items.push(s); else groups.push({ wk, items: [s] });
  });
  return (
    <div>
      <input style={{ ...inp, textAlign:"left", marginTop:12 }} value={q} placeholder="search day or exercise…" onChange={e => setQ(e.target.value)} />
      {rev.length === 0 && <Empty msg="No matches." />}
      {groups.map(g => (
        <div key={g.wk}>
          <div style={{ fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:0.5, margin:"16px 4px 0" }}>
            {g.wk === thisWeek ? "This week" : g.wk} · {g.items.length} session{g.items.length>1?"s":""}
          </div>
          {g.items.map(s => {
            const totalSets = s.entries.reduce((a, e) => a + workSets(e.sets).length, 0);
            const vol = s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w||0)*(x.r||0), 0), 0);
            return (
              <button key={s.id} onClick={() => onOpen(s)} style={{ ...card, width:"100%", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", gap:12 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:14, fontWeight:600 }}>{s.dayName}</div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                    {s.date}{s.gym ? ` · ${s.gym}` : ""} · {s.entries.length} exercises · {totalSets} sets{s.durationMin != null ? ` · ${fmtDur(s.durationMin)}` : ""}
                  </div>
                </div>
                <div style={{ textAlign:"right", flexShrink:0, whiteSpace:"nowrap" }}>
                  {scoreOf && <div style={{ fontSize:13, fontWeight:700, color:EWS_COLOR }}>{fmtEws(scoreOf(s).total)}<span style={{ fontSize:10, color:C.dim }}> EWS</span></div>}
                  {vol > 0 && <div style={{ fontSize:11, fontWeight:600, color:C.blue }}>{Math.round(vol).toLocaleString()}<span style={{ fontSize:10, color:C.dim }}> kg·r</span></div>}
                  {(s.injuries||[]).length > 0 && <div style={{ fontSize:10, color:C.knee, marginTop:2 }}>{s.injuries.length} injury note{s.injuries.length>1?"s":""}</div>}
                </div>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SessionDetail({ session, onBack, onDelete, onEdit, exByKey, scoreOf }) {
  const [confirm, setConfirm] = useState(false);
  const ews = useMemo(() => scoreOf ? scoreOf(session) : null, [scoreOf, session]);
  const exScore = key => ews ? ews.ex.find(x => x.key === key) : null;
  const [showFormula, setShowFormula] = useState(false);
  return (
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:12 }}>
        <button onClick={onBack} style={{ background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>← Back</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>{session.dayName}</div>
          <div style={{ fontSize:11, color:C.dim }}>{session.date}{session.gym ? ` · ${session.gym}` : ""}{session.durationMin!=null ? ` · ${fmtDur(session.durationMin)}` : ""}{session.bodyweight!=null ? ` · BW ${session.bodyweight}kg` : ""}{session.feel!=null ? ` · feel ${session.feel}/10` : ""}</div>
        </div>
        <button onClick={() => onEdit(session)} style={{ background:C.panel2, color:C.acc, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>Edit</button>
      </div>
      {ews && <EwsCard ews={ews} showFormula={showFormula} setShowFormula={setShowFormula} />}
      {(() => {
        const gl = {}; let gn = 0;
        session.entries.forEach(e => { if (e.group && !(e.group in gl)) gl[e.group] = gn++; });
        const seen = {};
        return session.entries.map((e, idx) => {
        const ex = exByKey(e.key);
        let ssTag = null;
        if (e.group && e.group in gl) {
          seen[e.group] = (seen[e.group] || 0) + 1;
          ssTag = { color: SS_COLORS[gl[e.group] % SS_COLORS.length], label: String.fromCharCode(65 + gl[e.group]) + seen[e.group] };
        }
        const nDrops = e.sets.filter(x => x.drop).length;
        const repBest = e.t === "rep" && session.bodyweight ? Math.max(0, ...e.sets.map(x => repE1rm(x, session.bodyweight))) : 0;
        const es = exScore(e.key);
        return (
          <div key={idx} style={{ ...card, borderLeft: ssTag ? `3px solid ${ssTag.color}` : card.border }}>
            <div style={{ fontSize:14, fontWeight:600 }}>
              {ssTag && <span style={{ fontSize:10, fontWeight:800, color:"#04150E", background:ssTag.color, borderRadius:6, padding:"1px 6px", marginRight:6, verticalAlign:"middle" }}>{ssTag.label}</span>}
              {e.name} <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>· {T_LABEL[e.t]}</span>
              {es && <span style={{ float:"right", fontSize:11, fontWeight:700, color:EWS_COLOR }}>{fmtEws(es.base + es.improve + es.pr)}</span>}
            </div>
            {es && es.note && <div style={{ fontSize:10, color: es.pr > 0 ? C.gold : es.improve < 0 ? C.warn : C.dim, marginTop:2 }}>{es.note}</div>}
            <div style={{ marginTop:8 }}>
              {e.sets.map((s, i) => (
                <div key={i} style={{ display:"flex", gap:10, fontSize:13, padding:"3px 0", borderBottom: i<e.sets.length-1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ color: s.drop ? C.gold : C.dim, width:20 }}>{s.drop ? "↓" : i+1}</span>
                  <span style={{ flex:1 }}>{setLine(e.t, s)}</span>
                  {es && es.sets[i] && es.sets[i].why && es.sets[i].why !== "drop" && <span style={{ fontSize:10, color: es.sets[i].why === "junk" ? C.warn : C.dim, alignSelf:"center" }}>{es.sets[i].why}</span>}
                </div>
              ))}
              {e.sets.length > 0 && e.t === "wr" && <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>best e1RM: {Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r))))}kg{nDrops ? ` · ${workSets(e.sets).length} working set${workSets(e.sets).length===1?"":"s"} + ${nDrops} drop${nDrops===1?"":"s"}` : ""}</div>}
              {repBest > 0 && <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>best e1RM (BW + load): {Math.round(repBest)}kg{nDrops ? ` · ${nDrops} drop${nDrops===1?"":"s"}` : ""}</div>}
              {e.t !== "wr" && !repBest && nDrops > 0 && <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>{workSets(e.sets).length} working set{workSets(e.sets).length===1?"":"s"} + {nDrops} drop{nDrops===1?"":"s"}</div>}
            </div>
            {e.note && <div style={{ fontSize:13, color:C.gold, marginTop:8, fontStyle:"italic" }}>“{e.note}”</div>}
          </div>
        );
      }); })()}
      {(session.injuries||[]).length > 0 && (
        <div style={{ ...card, borderColor:"#3A2A2A" }}>
          <div style={{ fontSize:12, color:C.dim, marginBottom:8, textTransform:"uppercase", letterSpacing:0.5 }}>Injuries logged</div>
          {session.injuries.map((inj, i) => (
            <div key={i} style={{ fontSize:13, marginBottom:6 }}>
              <b>{inj.name}</b> · <span style={{ color:C.knee }}>{inj.pain}/10{inj.swelling ? " · swelling" : ""}</span>
              {inj.note && <div style={{ color:C.dim, marginTop:2 }}>{inj.note}</div>}
            </div>
          ))}
        </div>
      )}
      <SessionMuscleBreakdown session={session} exResolve={exByKey} />
      {!confirm
        ? <button onClick={() => setConfirm(true)} style={{ ...btn("transparent", C.warn), border:`1px solid ${C.line}`, marginTop:14 }}>Delete session</button>
        : <div style={{ ...card, borderColor:C.warn }}>
            <div style={{ fontSize:13, marginBottom:10 }}>Delete this session permanently?</div>
            <div style={{ display:"flex", gap:10 }}>
              <button onClick={() => setConfirm(false)} style={btn(C.panel2, C.dim)}>Cancel</button>
              <button onClick={() => onDelete(session.id)} style={btn(C.warn, "#1A0E0E")}>Delete</button>
            </div>
          </div>}
    </div>
  );
}
/* EWS summary card for a session: total + breakdown + expandable formula */
function EwsCard({ ews, showFormula, setShowFormula }) {
  const junk = ews.ex.reduce((a, x) => a + x.junk, 0);
  const part = (label, v, color) => (
    <div style={{ flex:1, textAlign:"center" }}>
      <div style={{ fontSize:15, fontWeight:700, color }}>{v >= 0 ? "" : "-"}{fmtEws(Math.abs(v))}</div>
      <div style={{ fontSize:10, color:C.dim }}>{label}</div>
    </div>
  );
  return (
    <div style={{ ...card, borderColor:"#3A3323" }}>
      <div style={{ display:"flex", alignItems:"baseline", gap:10 }}>
        <div style={{ fontSize:28, fontWeight:800, color:EWS_COLOR, letterSpacing:-0.5 }}>{fmtEws(ews.total)}</div>
        <div style={{ fontSize:12, color:C.dim }}>EWS · Estimated Workout Score</div>
        <button onClick={() => setShowFormula(f => !f)} style={{ marginLeft:"auto", background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:10, padding:"1px 8px", fontSize:10, cursor:"pointer" }}>{showFormula ? "hide" : "formula"}</button>
      </div>
      <div style={{ display:"flex", gap:6, marginTop:8 }}>
        {part("base (sets × muscle × quality)", ews.base, C.ink)}
        {part("vs last session", ews.improve, ews.improve >= 0 ? C.acc : C.warn)}
        {part("PR bonus", ews.pr, C.gold)}
      </div>
      {junk > 0 && <div style={{ fontSize:11, color:C.warn, marginTop:8 }}>{junk} junk set{junk===1?"":"s"} scored at {Math.round(EWS.junkCredit*100)}%</div>}
      {showFormula && (
        <div style={{ fontSize:11, color:C.dim, marginTop:10, lineHeight:1.5 }}>
          <div><b style={{ color:C.ink }}>base</b> = Σ sets {EWS.perSet} × muscle weight × quality</div>
          <div style={{ paddingLeft:10 }}>muscle weight: all lifting muscles {MUSCLE_WEIGHT.Chest} (even) · cardio {MUSCLE_WEIGHT.Cardio} · mobility {MUSCLE_WEIGHT["Mobility/Rehab"]}</div>
          <div style={{ paddingLeft:10 }}>quality: full set 1.0 · drop row {EWS.dropCredit} · light (50–70% of top load) {EWS.lightCredit} · junk (&lt;50% of top load, or under half the target reps/weight) {EWS.junkCredit}</div>
          <div style={{ paddingLeft:10 }}>if RPE logged: ≥{EWS.rpe.hard} → 1.0 · {EWS.rpe.mid} → {EWS.rpe.midCredit} · ≤{EWS.rpe.mid-1} → {EWS.rpe.easyCredit}</div>
          <div><b style={{ color:C.ink }}>vs last</b> = Σ exercises (that exercise's base) × {EWS.lastK} × h(%Δ best e1RM vs your previous session of it), floor {EWS.lastFloorPct}%</div>
          <div><b style={{ color:C.ink }}>PR</b> = Σ exercises (that exercise's base) × {EWS.prK} × h(% over your prior all-time best), needs {EWS.prMinPrior}+ prior sessions</div>
          <div style={{ paddingLeft:10 }}>h(p) = ln(1 + p/{EWS.pctScale}): +3% ≈ +{Math.round(EWS.prK*Math.log(1+3/EWS.pctScale)*100)}% of the exercise's base as PR bonus, +10% ≈ +{Math.round(EWS.prK*Math.log(1+10/EWS.pctScale)*100)}%, +25% ≈ +{Math.round(EWS.prK*Math.log(1+25/EWS.pctScale)*100)}%. Diminishing, never capped.</div>
          <div style={{ marginTop:4 }}>e1RM = Epley on the best set; bodyweight moves use bodyweight + load, so 8→10 reps is +5%, not +25%; holds use 1 + sec/120. No cap: more quality sets and bigger jumps always score higher.</div>
        </div>
      )}
    </div>
  );
}
function setLine(t, s) {
  const dp = s.drop ? "drop · " : "";
  if (t === "wr") return `${dp}${s.w} kg × ${s.r}${s.rpe!=null ? ` @ RPE ${s.rpe}` : ""}`;
  if (t === "rep") return `${dp}${s.r} reps${isLoadedSet(s) ? ` ${fmtAdd(s.add)}` : ""}${s.rpe!=null ? ` @ RPE ${s.rpe}` : ""}`;
  if (t === "time") return `${s.sec} s`;
  if (t === "wd") return `${s.w} kg · ${s.dist} m`;
  return `${Math.round((s.sec||0)/60)} min · ${s.dist} km`;
}

/* ============================================================
   Progress — per-exercise drill-down (any exercise)
   ============================================================ */
// Build the {key,n,t} map for every exercise that has ever been logged,
// falling back to session-embedded name/type for exercises no longer in the lib.
function useExMap(sessions, allEx) {
  return useMemo(() => {
    const m = new Map(); allEx.forEach(e => m.set(e.key, e));
    sessions.forEach(s => s.entries.forEach(e => { if (!m.has(e.key)) m.set(e.key, { key:e.key, n:e.name, t:e.t, m:LIB_BY_NAME.get(e.name) || null }); }));
    return m;
  }, [allEx, sessions]);
}

// per-exercise session history + progression metric (shared by drill-down)
/* For bodyweight exercises: once any session has a loaded set (+kg or
   assisted) AND a bodyweight is known somewhere, the metric switches to
   e1RM on (bodyweight + load) for every session, so the chart stays one
   quantity. With no loads anywhere it stays max reps. */
function repLoadedMode(sessions, picked) {
  let loaded = false, bw = false;
  sessions.forEach(s => {
    if (s.bodyweight) bw = true;
    const e = s.entries.find(x => x.key === picked);
    if (e && e.sets.some(isLoadedSet)) loaded = true;
  });
  return loaded && bw;
}
function exerciseHistory(sessions, picked, ex) {
  if (!ex) return [];
  const loadedMode = ex.t === "rep" && repLoadedMode(sessions, picked);
  return sessions.map((s, si) => {
    const e = s.entries.find(x => x.key === picked);
    if (!e || !e.sets.length) return null;
    let metric = 0, label = "";
    if (ex.t === "wr") { metric = Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r)))); label = metric + " e1RM"; }
    else if (ex.t === "rep" && loadedMode) {
      const bw = bwForSession(sessions, si);
      // unloaded sets still count: load = bw + 0
      metric = Math.round(Math.max(...e.sets.map(x => bw ? e1rm(bw + (Number(x.add) || 0), x.r) : 0)));
      label = metric + " e1RM";
    }
    else if (ex.t === "rep") { metric = Math.max(...e.sets.map(x => x.r||0)); label = metric + " reps"; }
    else if (ex.t === "time") { metric = Math.max(...e.sets.map(x => x.sec||0)); label = metric + "s"; }
    else if (ex.t === "wd") { metric = Math.max(...e.sets.map(x => x.w||0)); label = metric + "kg"; }
    else { metric = Math.round(e.sets.reduce((a, x) => a + (x.dist||0), 0)*10)/10; label = metric + "km"; }
    return { date: s.date, metric, label, sets: e.sets, note: e.note, t: ex.t, loadedMode };
  }).filter(Boolean);
}

/* per-exercise drill-down: chart + every session. Fixed exercise (no dropdown). */
function ExerciseDetail({ sessions, exMap, exKey, onBack }) {
  const ex = exMap.get(exKey);
  const history = useMemo(() => exerciseHistory(sessions, exKey, ex), [sessions, exKey, ex]);
  // PR = new running max, skipping the first session (baseline, not a PR)
  const withPr = useMemo(() => {
    let runMax = -Infinity;
    return history.map((h, i) => {
      const pr = i > 0 && h.metric > runMax && h.metric > 0;
      if (h.metric > runMax) runMax = h.metric;
      return { ...h, pr };
    });
  }, [history]);
  const series = withPr.filter(h => h.metric > 0).map(h => ({ date: h.date, v: h.metric, pr: h.pr }));
  const loadedMode = history.length > 0 && history[0].loadedMode;
  const unit = ex ? (loadedMode ? "kg e1RM (BW+load)" : { wr:"kg e1RM", rep:"reps", time:"s", wd:"kg", cardio:"km" }[ex.t]) : "";
  const first = series[0]?.v, last = series[series.length-1]?.v;
  const delta = (first && last) ? Math.round((last - first) / first * 1000)/10 : null;

  return (
    <div>
      <DetailHeader title={ex ? ex.n : exKey} sub={ex ? T_LABEL[ex.t] : ""} onBack={onBack} />
      {series.length > 0 && (
        <Stat row={[
          ["Sessions", history.length],
          ["Best", Math.max(...series.map(s => s.v))],
          ["Change", delta!=null ? (delta >= 0 ? "+" : "") + delta + "%" : "—"]
        ]} />
      )}
      <Line title="Progression" data={series} color={C.acc} unit={unit} marks={series.map(d => d.pr)} markLabel="PR" />
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Every session</div>
        {history.length === 0 && <div style={{ fontSize:12, color:C.dim }}>No sets logged yet.</div>}
        {(() => {
          return withPr.slice().reverse().map((h, i) => (
            <div key={i} style={{ padding:"8px 0", borderBottom: i < history.length-1 ? `1px solid ${C.line}` : "none" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
                <span style={{ fontSize:13, fontWeight:600 }}>{h.date}
                  {h.pr && <span style={{ marginLeft:8, fontSize:9, fontWeight:800, color:"#04150E", background:C.gold, borderRadius:6, padding:"2px 6px", verticalAlign:"middle", letterSpacing:0.5 }}>PR</span>}
                </span>
                <span style={{ fontSize:13, color:C.acc, fontWeight:700 }}>{h.label}</span>
              </div>
              <div style={{ fontSize:12, color:C.dim, marginTop:3 }}>{prevSummary(h.t, h.sets)}</div>
              {h.note && <div style={{ fontSize:12, color:C.gold, marginTop:3, fontStyle:"italic" }}>“{h.note}”</div>}
            </div>
          ));
        })()}
      </div>
    </div>
  );
}

/* tappable list of every logged exercise -> opens ExerciseDetail */
function ExerciseList({ sessions, exMap, onPick }) {
  const logged = useMemo(() => {
    const counts = new Map();
    sessions.forEach(s => s.entries.forEach(e => {
      const c = counts.get(e.key) || { key:e.key, sessions:0, last:"" };
      c.sessions += 1; if (s.date > c.last) c.last = s.date;
      counts.set(e.key, c);
    }));
    return [...counts.values()]
      .map(c => ({ ...c, ex: exMap.get(c.key) }))
      .filter(c => c.ex)
      .sort((a, b) => a.ex.n.localeCompare(b.ex.n));
  }, [sessions, exMap]);
  if (logged.length === 0) return <Empty msg="Log sessions and per-exercise progress appears here." />;
  return (
    <div style={{ marginTop:12 }}>
      {logged.map(c => (
        <button key={c.key} onClick={() => onPick(c.key)} style={{ ...card, marginTop:0, marginBottom:8, width:"100%", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600 }}>{c.ex.n}</div>
            <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{c.sessions} session{c.sessions>1?"s":""} · last {c.last}</div>
          </div>
          <span style={{ fontSize:18, color:C.dim }}>›</span>
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   Trends — aggregate (volume / bodyweight / frequency)
   ============================================================ */
// shared back-header for drill-down views
function DetailHeader({ title, sub, onBack }) {
  return (
    <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:12 }}>
      <button onClick={onBack} style={{ background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>← Back</button>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:16, fontWeight:700, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{title}</div>
        {sub && <div style={{ fontSize:11, color:C.dim }}>{sub}</div>}
      </div>
    </div>
  );
}

/* Aggregate overview: totals, volume, bodyweight, feel, sessions/week. */
function TrendsOverview({ sessions, scoreOf }) {
  const ewsSeries = useMemo(() => {
    const sorted = sessions.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
    let runMax = -Infinity;
    return sorted.map(s => {
      const v = Math.round(scoreOf(s).total);
      const pr = v > runMax && runMax !== -Infinity;
      if (v > runMax) runMax = v;
      return { date: s.date, v, pr };
    }).filter(d => d.v > 0);
  }, [sessions, scoreOf]);
  const ewsStats = useMemo(() => {
    if (!ewsSeries.length) return null;
    const vals = ewsSeries.map(d => d.v);
    const recent = vals.slice(-6);
    return { last: vals[vals.length-1], best: Math.max(...vals), avg: Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) };
  }, [ewsSeries]);
  const weekCounts = useMemo(() => {
    const m = {}; sessions.forEach(s => { const w = isoWeek(s.date); m[w] = (m[w]||0)+1; });
    return Object.entries(m).sort();
  }, [sessions]);
  const volSeries = useMemo(() => sessions.map(s => ({ date:s.date, v: s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w||0)*(x.r||0), 0), 0) })).filter(d => d.v > 0), [sessions]);
  const bwSeries = useMemo(() => sessions.filter(s => s.bodyweight != null).map(s => ({ date:s.date, v:s.bodyweight })), [sessions]);
  const feelSeries = useMemo(() => sessions.filter(s => s.feel != null).map(s => ({ date:s.date, v:s.feel })), [sessions]);
  return (
    <div>
      <Stat row={[["Sessions", sessions.length], ["Weeks active", weekCounts.length], ["Avg/wk", weekCounts.length ? (sessions.length/weekCounts.length).toFixed(1) : "0"]]} />
      {ewsStats && <Stat row={[["EWS last", ewsStats.last], ["EWS best", ewsStats.best], ["Avg last 6", ewsStats.avg]]} />}
      <Line title="EWS · Estimated Workout Score" data={ewsSeries} color={EWS_COLOR} unit="" marks={ewsSeries.map(d => d.pr)} markLabel="new best" />
      <Line title="Session volume (kg·reps)" data={volSeries} color={C.blue} unit="" />
      {bwSeries.length > 0 && <Line title="Bodyweight" data={bwSeries} color={C.warn} unit="kg" />}
      {feelSeries.length > 0 && <Line title="Readiness / feel (1–10)" data={feelSeries} color={C.acc} unit="" />}
      <Bars title="Sessions per week" data={weekCounts} />
    </div>
  );
}

/* per-muscle weekly-sets trend + the sessions that hit that muscle. */
function MuscleDetail({ sessions, muscle, exResolve, onBack, onPickExercise }) {
  // weekly set totals for this muscle (chronological)
  const weekSeries = useMemo(() => {
    const byWeek = {};
    sessions.forEach(s => {
      let n = 0;
      s.entries.forEach(e => { if (muscleOfEntry(e, exResolve) === muscle) n += workSets(e.sets).length; });
      if (n > 0) { const w = isoWeek(s.date); byWeek[w] = (byWeek[w] || 0) + n; }
    });
    return Object.entries(byWeek).sort().map(([wk, v]) => ({ date: wk, v }));
  }, [sessions, muscle, exResolve]);

  // sessions that hit this muscle, newest first, with the exercises + set counts
  const hitSessions = useMemo(() => {
    return sessions.map(s => {
      const items = s.entries
        .filter(e => muscleOfEntry(e, exResolve) === muscle && e.sets && e.sets.length)
        .map(e => ({ key:e.key, name:e.name, t:e.t, sets:e.sets }));
      if (!items.length) return null;
      const total = items.reduce((a, e) => a + workSets(e.sets).length, 0);
      return { id:s.id, date:s.date, dayName:s.dayName, total, items };
    }).filter(Boolean).sort((a, b) => a.date < b.date ? 1 : -1);
  }, [sessions, muscle, exResolve]);

  const lm = LANDMARKS[muscle];
  return (
    <div>
      <DetailHeader title={muscle} sub={lm ? `MEV ${lm[1]} · MAV ${lm[2]} · MRV ${lm[3]} sets/wk` : "no landmark"} onBack={onBack} />
      <Line title="Weekly sets" data={weekSeries} color={C.blue} unit="sets" />
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Previous workouts</div>
        {hitSessions.length === 0 && <div style={{ fontSize:12, color:C.dim }}>No sets for this muscle yet.</div>}
        {hitSessions.map((s, i) => (
          <div key={s.id} style={{ padding:"8px 0", borderBottom: i < hitSessions.length-1 ? `1px solid ${C.line}` : "none" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{s.date} <span style={{ color:C.dim, fontWeight:400 }}>· {s.dayName}</span></span>
              <span style={{ fontSize:13, color:C.acc, fontWeight:700 }}>{s.total} sets</span>
            </div>
            {s.items.map((e, j) => (
              <button key={j} onClick={() => onPickExercise && onPickExercise(e.key)} style={{ display:"flex", justifyContent:"space-between", width:"100%", background:"transparent", border:"none", color:C.dim, cursor:"pointer", textAlign:"left", padding:"3px 0", fontSize:12 }}>
                <span>{e.name}</span>
                <span style={{ color:C.dim }}>{prevSummary(e.t, e.sets)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* tappable muscle list -> MuscleDetail. only muscles with landmarks + logged sets. */
function MuscleList({ sessions, exResolve, onPick }) {
  const rows = useMemo(() => {
    const counts = setsByMuscle(sessions, exResolve);
    return MUSCLES
      .filter(m => LANDMARKS[m] != null)
      .map(m => ({ m, sets: counts[m] || 0 }))
      .filter(r => r.sets > 0);
  }, [sessions, exResolve]);
  if (rows.length === 0) return <Empty msg="Log sessions and per-muscle trends appear here." />;
  return (
    <div style={{ marginTop:12 }}>
      {rows.map(r => (
        <button key={r.m} onClick={() => onPick(r.m)} style={{ ...card, marginTop:0, marginBottom:8, width:"100%", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{r.m}</div>
          <div style={{ display:"flex", gap:10, alignItems:"center" }}>
            <span style={{ fontSize:12, color:C.dim }}>{r.sets} total sets</span>
            <span style={{ fontSize:18, color:C.dim }}>›</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/* Trends — segmented: Overview / Exercises / Muscles, each with drill-downs.
   Also keeps the current-week & trailing-4wk landmark view under Muscles. */
function Trends({ sessions, allEx, exResolve, scoreOf }) {
  const [view, setView] = useState("overview"); // overview | exercises | muscles
  const [exKey, setExKey] = useState(null);      // exercise drill-down
  const [muscle, setMuscle] = useState(null);    // muscle drill-down
  const exMap = useExMap(sessions, allEx);

  if (sessions.length === 0) return <Empty msg="Log sessions and trends appear here." />;

  // drill-down overlays take over the whole tab
  if (exKey) return <ExerciseDetail sessions={sessions} exMap={exMap} exKey={exKey} onBack={() => setExKey(null)} />;
  if (muscle) return (
    <MuscleDetail sessions={sessions} muscle={muscle} exResolve={exResolve}
      onBack={() => setMuscle(null)}
      onPickExercise={k => { setMuscle(null); setExKey(k); }} />
  );

  const seg = [["overview","Overview"],["exercises","Exercises"],["muscles","Muscles"]];
  return (
    <div>
      <div style={{ display:"flex", gap:6, marginTop:12 }}>
        {seg.map(([k, lbl]) => (
          <button key={k} onClick={() => setView(k)} style={{
            flex:1, background: view===k ? C.panel2 : C.bg, color: view===k ? C.acc : C.dim,
            border:`1px solid ${view===k ? C.acc : C.line}`, borderRadius:8, padding:"9px 0", fontSize:13, fontWeight:600, cursor:"pointer" }}>{lbl}</button>
        ))}
      </div>
      {view === "overview" && <TrendsOverview sessions={sessions} scoreOf={scoreOf} />}
      {view === "exercises" && <ExerciseList sessions={sessions} exMap={exMap} onPick={setExKey} />}
      {view === "muscles" && <MuscleVolumeSection sessions={sessions} exResolve={exResolve} onPickMuscle={setMuscle} />}
    </div>
  );
}

/* Muscles view: landmark bars (week / 4wk) on top, then tappable muscle list. */
function MuscleVolumeSection({ sessions, exResolve, onPickMuscle }) {
  return (
    <div>
      <VolumeTab sessions={sessions} exResolve={exResolve} />
      <div style={{ fontSize:12, color:C.dim, margin:"18px 4px 0", textTransform:"uppercase", letterSpacing:0.5 }}>Tap a muscle for trend + history</div>
      <MuscleList sessions={sessions} exResolve={exResolve} onPick={onPickMuscle} />
    </div>
  );
}

/* ============================================================
   Muscle volume — sets per muscle vs RP MEV/MAV/MRV landmarks
   ============================================================ */
const LIB_BY_NAME = (() => { const m = new Map(); LIB.forEach(e => m.set(e.n, e.m)); return m; })();

// resolve an entry's muscle: prefer a custom-aware resolver, else library-by-name
function muscleOfEntry(e, exResolve) {
  if (exResolve) { const ex = exResolve(e.key); if (ex && ex.m) return ex.m; }
  return LIB_BY_NAME.get(e.name) || null;
}

// count working sets per muscle across a list of sessions. one logged set = 1;
// a top set plus its drops = 1 (RP convention), so drop rows are excluded.
function setsByMuscle(sessionList, exResolve) {
  const out = {};
  sessionList.forEach(s => s.entries.forEach(e => {
    const mus = muscleOfEntry(e, exResolve);
    if (!mus) return;
    out[mus] = (out[mus] || 0) + workSets(e.sets).length;
  }));
  return out;
}

const ZONE_COLOR = { below: C.dim, optimal: C.acc, high: C.gold, over: C.warn };
const ZONE_LABEL = { below: "below MEV", optimal: "in MAV range", high: "above MAV", over: "over MRV" };

/* horizontal bar per muscle, with MEV/MAV/MRV ticks. weekly=true shows landmark
   context; weekly=false (single session) just shows raw sets, no zone judgement
   (one session can't be judged against a weekly landmark). */
function MuscleVolumeBars({ counts, weekly, title }) {
  const rows = MUSCLES
    .filter(m => LANDMARKS[m] != null)            // only muscles with landmarks
    .map(m => ({ m, sets: counts[m] || 0 }))
    .filter(r => r.sets > 0 || weekly)            // session view: only hit muscles
    .map(r => ({ ...r, band: volumeBand(r.m, r.sets) }));
  if (rows.length === 0) return <Empty msg="No tracked-muscle sets yet." />;
  // scale bars to the largest MRV among shown rows (weekly) or largest set count
  const scaleMax = weekly
    ? Math.max(...rows.map(r => r.band ? r.band.mrv : r.sets), 1)
    : Math.max(...rows.map(r => r.sets), 1);
  return (
    <div style={card}>
      {title && <div style={{ fontSize:12, color:C.dim, marginBottom:12, textTransform:"uppercase", letterSpacing:0.5 }}>{title}</div>}
      {rows.map(r => {
        const b = r.band;
        const barPct = Math.min(100, (r.sets / scaleMax) * 100);
        const col = weekly && b ? ZONE_COLOR[b.zone] : C.blue;
        const mevPct = weekly && b ? (b.mev / scaleMax) * 100 : null;
        const mavPct = weekly && b ? (b.mav / scaleMax) * 100 : null;
        return (
          <div key={r.m} style={{ marginBottom:12 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", marginBottom:4 }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{r.m}</span>
              <span style={{ fontSize:12, color: col, fontWeight:700 }}>
                {r.sets}{weekly && b ? ` sets · ${ZONE_LABEL[b.zone]}` : " sets"}
              </span>
            </div>
            <div style={{ position:"relative", height:14, background:C.bg, border:`1px solid ${C.line}`, borderRadius:4, overflow:"hidden" }}>
              <div style={{ position:"absolute", left:0, top:0, bottom:0, width:`${barPct}%`, background:col, opacity:0.85 }} />
              {mevPct != null && <div title="MEV" style={{ position:"absolute", left:`${Math.min(100,mevPct)}%`, top:0, bottom:0, width:2, background:C.ink, opacity:0.5 }} />}
              {mavPct != null && <div title="MAV" style={{ position:"absolute", left:`${Math.min(100,mavPct)}%`, top:0, bottom:0, width:2, background:C.ink, opacity:0.8 }} />}
            </div>
            {weekly && b && (
              <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>
                MEV {b.mev} · MAV {b.mav} · MRV {b.mrv}
              </div>
            )}
          </div>
        );
      })}
      {weekly && (
        <div style={{ fontSize:10, color:C.dim, marginTop:8, lineHeight:1.5 }}>
          Ticks mark MEV and MAV. grey = below MEV · green = productive (MEV–MAV) · amber = above MAV · red = over MRV. One logged set = one set toward its muscle.
        </div>
      )}
    </div>
  );
}

/* single-session breakdown, shown in SessionDetail */
function SessionMuscleBreakdown({ session, exResolve }) {
  const counts = useMemo(() => setsByMuscle([session], exResolve), [session, exResolve]);
  if (Object.keys(counts).length === 0) return null;
  return <MuscleVolumeBars counts={counts} weekly={false} title="Muscles hit this session" />;
}

/* ============================================================
   Volume tab — current ISO week + trailing-4-week rollups
   ============================================================ */
function VolumeTab({ sessions, exResolve }) {
  const [scope, setScope] = useState("week"); // "week" | "month"
  const today = TODAY();
  const thisWeek = isoWeek(today);

  const weekSessions = useMemo(
    () => sessions.filter(s => isoWeek(s.date) === thisWeek),
    [sessions, thisWeek]
  );
  const monthSessions = useMemo(() => {
    const cutoff = new Date(today + "T00:00:00");
    cutoff.setDate(cutoff.getDate() - 27); // trailing 28 days inclusive
    return sessions.filter(s => new Date(s.date + "T00:00:00") >= cutoff);
  }, [sessions, today]);

  const list = scope === "week" ? weekSessions : monthSessions;
  const counts = useMemo(() => setsByMuscle(list, exResolve), [list, exResolve]);

  // trailing-4wk: landmarks are weekly, so judge the per-week average
  const judgedCounts = useMemo(() => {
    if (scope === "week") return counts;
    const out = {}; Object.entries(counts).forEach(([m, v]) => { out[m] = Math.round(v / 4); });
    return out;
  }, [counts, scope]);

  if (sessions.length === 0) return <Empty msg="Log sessions and per-muscle volume appears here." />;

  return (
    <div>
      <div style={{ display:"flex", gap:6, marginTop:12 }}>
        {[["week","This week"],["month","Trailing 4 wks"]].map(([k, lbl]) => (
          <button key={k} onClick={() => setScope(k)} style={{
            flex:1, background: scope===k ? C.panel2 : C.bg, color: scope===k ? C.acc : C.dim,
            border:`1px solid ${scope===k ? C.acc : C.line}`, borderRadius:8, padding:"9px 0", fontSize:13, fontWeight:600, cursor:"pointer" }}>{lbl}</button>
        ))}
      </div>
      <div style={{ fontSize:11, color:C.dim, margin:"10px 4px 0", lineHeight:1.5 }}>
        {scope === "week"
          ? `Current ISO week (${thisWeek}, Mon–Sun) · ${weekSessions.length} session${weekSessions.length!==1?"s":""}. Sets compared directly to weekly landmarks.`
          : `Last 28 days · ${monthSessions.length} session${monthSessions.length!==1?"s":""}. Bars show sets/week averaged over 4 weeks, judged against weekly landmarks.`}
      </div>
      <MuscleVolumeBars counts={judgedCounts} weekly={true}
        title={scope === "week" ? "Weekly sets vs landmarks" : "Avg weekly sets vs landmarks"} />
    </div>
  );
}

/* ============================================================
   Injury tab — create / log / close generic injuries
   ============================================================ */
function InjuryTab({ injuries, saveInjuries, sessions }) {
  const [name, setName] = useState("");
  const add = () => { const n = name.trim(); if (!n) return; saveInjuries([...injuries, { id: uid(), name: n, created: TODAY(), closed: false }]); setName(""); };
  const close = id => saveInjuries(injuries.map(i => i.id===id ? { ...i, closed: true, closedOn: TODAY() } : i));
  const reopen = id => saveInjuries(injuries.map(i => i.id===id ? { ...i, closed: false, closedOn: undefined } : i));
  const remove = id => saveInjuries(injuries.filter(i => i.id !== id));

  // gather logged entries per injury name from session history
  const logsFor = (nm) => {
    const out = [];
    sessions.forEach(s => (s.injuries||[]).forEach(inj => { if (inj.name === nm) out.push({ date:s.date, ...inj }); }));
    return out;
  };

  const active = injuries.filter(i => !i.closed);
  const closed = injuries.filter(i => i.closed);

  return (
    <div>
      <div style={{ ...card }}>
        <div style={{ fontSize:13, color:C.dim }}>Create an injury to track. While active, every session prompts a pain/swelling/note check-in. Close it when healed — the history stays.</div>
        <div style={{ display:"flex", gap:8, marginTop:10 }}>
          <input style={{ ...inp, textAlign:"left" }} value={name} placeholder="e.g. Left knee, R shoulder" onChange={e => setName(e.target.value)} onKeyDown={e => e.key==="Enter" && add()} />
          <button onClick={add} style={{ ...btn(C.acc, "#04150E"), width:"auto", padding:"0 18px" }}>Add</button>
        </div>
      </div>

      {active.length === 0 && closed.length === 0 && <Empty msg="No injuries tracked. Add one above." />}

      {active.map(inj => {
        const logs = logsFor(inj.name);
        const series = logs.map(l => ({ date:l.date, v:l.pain||0 }));
        return (
          <div key={inj.id} style={{ ...card, borderColor:"#3A2A2A" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div><div style={{ fontSize:15, fontWeight:700 }}>{inj.name}</div>
                <div style={{ fontSize:11, color:C.dim }}>active since {inj.created} · {logs.length} log{logs.length!==1?"s":""}</div></div>
              <button onClick={() => close(inj.id)} style={{ background:C.panel2, color:C.acc, border:`1px solid ${C.line}`, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer" }}>Mark healed</button>
            </div>
            {series.length > 0 && <div style={{ marginTop:10 }}><Line title="Pain (0–10)" data={series} color={C.knee} unit="" embedded /></div>}
            {logs.slice().reverse().map((l, i) => (
              <div key={i} style={{ fontSize:13, marginTop:8, paddingTop:8, borderTop:`1px solid ${C.line}` }}>
                <span style={{ color:C.dim }}>{l.date}</span> · <span style={{ color:C.knee, fontWeight:600 }}>{l.pain}/10{l.swelling?" · swelling":""}</span>
                {l.note && <div style={{ color:C.dim, marginTop:2 }}>{l.note}</div>}
              </div>
            ))}
          </div>
        );
      })}

      {closed.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Healed / closed</div>
          {closed.map(inj => (
            <div key={inj.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
              <div style={{ fontSize:13 }}>{inj.name} <span style={{ color:C.dim, fontSize:11 }}>· closed {inj.closedOn}</span></div>
              <div style={{ display:"flex", gap:6 }}>
                <button onClick={() => reopen(inj.id)} style={{ background:"transparent", color:C.dim, border:`1px solid ${C.line}`, borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer" }}>Reopen</button>
                <button onClick={() => remove(inj.id)} style={{ background:"transparent", color:C.warn, border:`1px solid ${C.line}`, borderRadius:6, padding:"4px 10px", fontSize:12, cursor:"pointer" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ============================================================
   Goals tab — generate a science-based mesocycle
   ============================================================ */
function GoalsTab({ onInstall, current, setTab }) {
  const [mode, setMode] = useState("hyp"); // hyp = RP mesocycle | str = 5/3/1
  const [days, setDays] = useState(6);
  const [goal, setGoal] = useState("gain");
  const [accum, setAccum] = useState(4);
  const [bench, setBench] = useState("");
  const [squat, setSquat] = useState("");
  const [dead, setDead] = useState("");
  const [press, setPress] = useState("");
  const [bw, setBw] = useState("");
  const [options, setOptions] = useState(null);
  const [preview, setPreview] = useState(null); // generated program being previewed

  const sel = { background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", fontSize:14, width:"100%" };
  const num = v => v === "" ? null : Number(v) || null;
  const stats = { bench:num(bench), squat:num(squat), dead:num(dead), press:num(press), bodyweight:num(bw) };

  const generate = () => {
    if (mode === "str") {
      const prog = generate531({ stats });
      setOptions([{ split: { id:"531bbb", name:"5/3/1 Boring But Big",
        blurb:"4 days. One main lift per day on percent waves (5s / 3s / 5-3-1 / deload), 5×10 supplemental, accessories. TM = 90% of 1RM." }, prog }]);
      setPreview(null);
      return;
    }
    const splits = splitsForDays(days);
    setOptions(splits.map(s => ({
      split: s,
      prog: generateProgram({ splitId:s.id, goal, daysPerWeek:days, accumWeeks:accum, stats })
    })));
    setPreview(null);
  };

  const goalList = Object.values(GOALS);

  return (
    <div>
      <div style={card}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:12, textTransform:"uppercase", letterSpacing:0.5 }}>Build a program</div>

        <label style={{ fontSize:11, color:C.dim }}>Program type</label>
        <div style={{ display:"flex", gap:6, marginTop:6, marginBottom:14 }}>
          {[["hyp","Hypertrophy (RP meso)"],["str","Strength (5/3/1)"]].map(([k, lbl]) => (
            <button key={k} onClick={() => { setMode(k); setOptions(null); setPreview(null); }} style={{
              flex:1, background: mode===k ? C.panel2 : C.bg, color: mode===k ? C.acc : C.dim,
              border:`1px solid ${mode===k ? C.acc : C.line}`, borderRadius:8, padding:"10px 4px", fontSize:13, fontWeight:600, cursor:"pointer" }}>{lbl}</button>
          ))}
        </div>

        {mode === "hyp" && <>
        <label style={{ fontSize:11, color:C.dim }}>Training days per week</label>
        <div style={{ display:"flex", gap:6, marginTop:6, marginBottom:14 }}>
          {[3,4,5,6].map(d => (
            <button key={d} onClick={() => setDays(d)} style={{
              flex:1, background: days===d ? C.panel2 : C.bg, color: days===d ? C.acc : C.dim,
              border:`1px solid ${days===d ? C.acc : C.line}`, borderRadius:8, padding:"10px 0", fontSize:15, fontWeight:600, cursor:"pointer" }}>{d}</button>
          ))}
        </div>

        <label style={{ fontSize:11, color:C.dim }}>Goal</label>
        <div style={{ display:"flex", gap:6, marginTop:6, marginBottom:14 }}>
          {goalList.map(g => (
            <button key={g.id} onClick={() => setGoal(g.id)} style={{
              flex:1, background: goal===g.id ? C.panel2 : C.bg, color: goal===g.id ? C.acc : C.dim,
              border:`1px solid ${goal===g.id ? C.acc : C.line}`, borderRadius:8, padding:"10px 4px", fontSize:13, fontWeight:600, cursor:"pointer" }}>{g.label}</button>
          ))}
        </div>

        <label style={{ fontSize:11, color:C.dim }}>Mesocycle length</label>
        <select style={{ ...sel, marginTop:6, marginBottom:14 }} value={accum} onChange={e => setAccum(Number(e.target.value))}>
          <option value={3}>3 accumulation + 1 deload (4 wk)</option>
          <option value={4}>4 accumulation + 1 deload (5 wk)</option>
          <option value={5}>5 accumulation + 1 deload (6 wk)</option>
          <option value={6}>6 accumulation + 1 deload (7 wk)</option>
        </select>
        </>}

        <div style={{ fontSize:11, color:C.dim, marginBottom:6 }}>
          {mode === "str"
            ? "1RMs (kg) — actual or estimated maxes. Training max is set to 90%; all working weights are percentages of that."
            : "Strength stats — working weight or est. 1RM (kg). Used to seed barbell loads; leave blank to start those blank too."}
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <StatIn label="Bench" val={bench} onChange={setBench} />
          <StatIn label="Squat" val={squat} onChange={setSquat} />
          <StatIn label="Deadlift" val={dead} onChange={setDead} />
        </div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          {mode === "str" && <StatIn label="OHP" val={press} onChange={setPress} />}
          <StatIn label="Bodyweight" val={bw} onChange={setBw} />
          {mode !== "str" && <div style={{ flex:1 }} />}
        </div>

        <button onClick={generate} style={{ ...btn(C.acc, "#04150E"), marginTop:14 }}>{mode === "str" ? "Generate 5/3/1 cycle" : "Generate programs"}</button>
      </div>

      {options && options.length > 0 && !preview && (
        <div style={{ marginTop:4 }}>
          <div style={{ fontSize:12, color:C.dim, margin:"16px 4px 4px", textTransform:"uppercase", letterSpacing:0.5 }}>{options.length} option{options.length>1?"s":""}{options[0] && options[0].prog && options[0].prog.meso && options[0].prog.meso.type === "531" ? "" : ` for ${days} days`}</div>
          {options.map(({ split, prog }) => (
            <div key={split.id} style={card}>
              <div style={{ fontSize:15, fontWeight:700 }}>{split.name}</div>
              <div style={{ fontSize:12, color:C.dim, marginTop:3 }}>{split.blurb}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>{prog.days.length} sessions/wk · {prog.days.map(d=>d.name).join(" · ")}</div>
              <div style={{ display:"flex", gap:10, marginTop:12 }}>
                <button onClick={() => setPreview({ split, prog })} style={btn(C.panel2, C.ink)}>Preview</button>
                <button onClick={() => onInstall(prog)} style={btn(C.acc, "#04150E")}>Use this</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div style={{ marginTop:4 }}>
          <div style={{ display:"flex", gap:10, alignItems:"center", margin:"16px 0 4px" }}>
            <button onClick={() => setPreview(null)} style={{ background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>← Back</button>
            <div style={{ flex:1, fontSize:15, fontWeight:700 }}>{preview.split.name}</div>
          </div>
          {preview.prog.meso.cardio && <div style={{ ...card, fontSize:12, color:C.dim }}>Cardio: {preview.prog.meso.cardio.note}<br/>Calories: {preview.prog.meso.nutrition.cal} · Protein: {preview.prog.meso.nutrition.protein}</div>}
          {preview.prog.days.map(d => (
            <div key={d.id} style={card}>
              <div style={{ fontSize:14, fontWeight:700, marginBottom:8 }}>{d.name}</div>
              {d.items.map((it, i) => {
                const ex = LIB.find(l => l.key === it.key);
                const t = it.target;
                const reps = t.repLo === t.repHi ? `${t.repLo}` : `${t.repLo}–${t.repHi}`;
                const line = t.plan
                  ? t.plan.map(p => `${p.w}×${p.r}${p.plus ? "+" : ""}`).join(" · ")
                  : `${t.sets}×${reps}${t.w!=null ? ` · ${t.w}kg${it.est?"*":""}` : ""}`;
                return (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0", borderBottom: i<d.items.length-1?`1px solid ${C.line}`:"none" }}>
                    <span>{ex ? ex.n : it.key}</span>
                    <span style={{ color:C.dim }}>{line}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ fontSize:11, color:C.dim, margin:"6px 4px" }}>
            {preview.prog.meso && preview.prog.meso.type === "531"
              ? "Main-lift weights follow the weekly percent wave; advance the week from the Program tab. After the deload, regenerate with 1RMs bumped +2.5kg upper / +5kg lower."
              : "* estimated starting load — confirm/adjust on first session. Set counts shown are week 1; they ramp up each week."}
          </div>
          <button onClick={() => onInstall(preview.prog)} style={{ ...btn(C.acc, "#04150E"), marginTop:6 }}>Use this program</button>
        </div>
      )}

      {current && current.meso && !options && (
        <div style={{ ...card, borderColor:C.line }}>
          <div style={{ fontSize:12, color:C.dim }}>Current program is a generated mesocycle ({current.meso.splitName}, week {current.meso.week}/{current.meso.totalWeeks}). Generating a new one will replace it. Logged sessions are kept.</div>
        </div>
      )}
    </div>
  );
}
function StatIn({ label, val, onChange, wide }) {
  return (
    <div style={{ flex: wide ? "0 0 50%" : 1 }}>
      <label style={{ fontSize:10, color:C.dim, display:"block", marginBottom:3 }}>{label}</label>
      <input style={{ ...inp }} inputMode="decimal" value={val} placeholder="—" onChange={e => onChange(e.target.value)} />
    </div>
  );
}

/* ============================================================
   Program editor — drag reorder of exercises within a day
   ============================================================ */
function ProgramEditor({ program, setProgram, exByKey, openPicker, custom, removeCustom, updateCustom, exportJson, importJson, onReset, onAdvanceWeek, onExitMeso, restPrefs, saveRestPrefs }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const st = mesoStatus(program);
  const addDay = () => setProgram({ ...program, days: [...program.days, { id: uid(), name:"New day", items: [] }] });
  const rmDay = id => setProgram({ ...program, days: program.days.filter(d => d.id !== id) });
  const dupDay = id => setProgram({ ...program, days: program.days.flatMap(d => d.id===id
    ? [d, { id: uid(), name: d.name + " (copy)", items: d.items.map(it => ({ ...it, target: it.target ? { ...it.target } : null })) }]
    : [d]) });
  const moveDay = (id, dir) => setProgram((() => {
    const i = program.days.findIndex(d => d.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= program.days.length) return program;
    const a = [...program.days]; [a[i], a[j]] = [a[j], a[i]];
    return { ...program, days: a };
  })());
  const rename = (id, name) => setProgram({ ...program, days: program.days.map(d => d.id===id ? { ...d, name } : d) });
  const addItem = (dId, exKey) => setProgram({ ...program, days: program.days.map(d => d.id===dId ? { ...d, items: [...d.items, { key:exKey, target: T(3,8,12,null) }] } : d) });
  const swapItem = (dId, idx, exKey) => setProgram({ ...program, days: program.days.map(d => d.id===dId
    ? { ...d, items: d.items.map((it, i) => i===idx ? { ...it, key: exKey, est: false } : it) } : d) });
  const rmItem = (dId, idx) => setProgram({ ...program, days: program.days.map(d => d.id===dId ? { ...d, items: d.items.filter((_, i) => i !== idx) } : d) });
  const moveItem = (dId, from, to) => setProgram({ ...program, days: program.days.map(d => {
    if (d.id !== dId) return d; const a = [...d.items]; if (to<0||to>=a.length) return d;
    const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...d, items: a };
  }) });
  const setTarget = (dId, idx, k, v) => setProgram({ ...program, days: program.days.map(d => d.id===dId ? { ...d, items: d.items.map((it, i) => i===idx ? { ...it, target: { ...(it.target||T(3,8,12,null)), [k]: v==="" ? (k==="w"?null:0) : Number(v) } } : it) } : d) });

  return (
    <div>
      {st && (
        <div style={{ ...card, borderColor: st.isDeload ? C.gold : C.acc }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color: st.isDeload ? C.gold : C.acc }}>{st.label}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{st.splitName} · {st.goalLabel}{st.rir ? ` · RIR ${st.rir.lo}–${st.rir.hi}` : ""}</div>
            </div>
            <div style={{ fontSize:11, color:C.dim, textAlign:"right" }}>{st.accumWeeks} accum<br/>+1 deload</div>
          </div>
          {(st.cardio || st.nutrition) && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.line}`, fontSize:12, color:C.dim, lineHeight:1.5 }}>
              {st.cardio && <div>Cardio: {st.cardio.note}</div>}
              {st.nutrition && <div>Calories: {st.nutrition.cal} · Protein: {st.nutrition.protein}</div>}
            </div>
          )}
          {st.type === "531" && st.tms && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.line}`, fontSize:12, color:C.dim }}>
              Training maxes: {["press","bench","squat","dead"].filter(k => st.tms[k]).map(k => `${k.toUpperCase()} ${st.tms[k]}kg`).join(" · ") || "none set"}
            </div>
          )}
          <div style={{ display:"flex", gap:10, marginTop:12 }}>
            <button onClick={onAdvanceWeek} disabled={st.week >= st.total}
              style={{ ...btn(st.week >= st.total ? C.panel2 : C.acc, st.week >= st.total ? C.dim : "#04150E"), opacity: st.week >= st.total ? 0.6 : 1 }}>
              {st.week >= st.total ? "Mesocycle complete" : st.week + 1 > st.accumWeeks ? "Advance → deload" : `Advance → week ${st.week + 1}`}
            </button>
          </div>
          {!confirmExit
            ? <button onClick={() => setConfirmExit(true)} style={{ ...btn("transparent", C.dim), border:`1px solid ${C.line}`, marginTop:8 }}>End mesocycle (keep as editable)</button>
            : <div style={{ marginTop:8, display:"flex", gap:10 }}>
                <button onClick={() => setConfirmExit(false)} style={btn(C.panel2, C.dim)}>Cancel</button>
                <button onClick={() => { onExitMeso(); setConfirmExit(false); }} style={btn(C.gold, "#1A1206")}>End it</button>
              </div>}
          <div style={{ fontSize:10, color:C.dim, marginTop:8 }}>
            {st.type === "531"
              ? "Advancing moves the percent wave (5s → 3s → 5/3/1 → deload). After the deload, regenerate from Goals with 1RMs +2.5kg upper / +5kg lower."
              : "Advancing recomputes set counts (volume ramp) and the RIR target. Your logged/edited weights are kept — load progression runs per-session."}
          </div>
        </div>
      )}

      <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontSize:13, fontWeight:600 }}>Weekly target</div><div style={{ fontSize:11, color:C.dim }}>sessions per week</div></div>
        <input style={{ ...inp, width:60 }} inputMode="numeric" value={program.target} onChange={e => setProgram({ ...program, target: Number(e.target.value)||0 })} />
      </div>

      <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div>
          <div style={{ fontSize:13, fontWeight:600 }}>Work down (back-off sets)</div>
          <div style={{ fontSize:11, color:C.dim }}>after the top set, suggest −10% (heavy lifts) / −5% (compounds)</div>
        </div>
        <button onClick={() => setProgram({ ...program, workDown: program.workDown === false ? true : false })}
          style={{ background: program.workDown === false ? C.bg : C.panel2, color: program.workDown === false ? C.dim : C.acc,
            border:`1px solid ${program.workDown === false ? C.line : C.acc}`, borderRadius:14, padding:"6px 16px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
          {program.workDown === false ? "off" : "on"}
        </button>
      </div>

      {program.days.map(d => (
        <div key={d.id} style={card}>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <input style={{ ...inp, textAlign:"left", fontWeight:600 }} value={d.name} onChange={e => rename(d.id, e.target.value)} />
            <button onClick={() => moveDay(d.id, -1)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:8, padding:"0 10px", cursor:"pointer" }}>↑</button>
            <button onClick={() => moveDay(d.id, 1)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:8, padding:"0 10px", cursor:"pointer" }}>↓</button>
            <button onClick={() => dupDay(d.id)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:8, padding:"0 10px", cursor:"pointer" }}>dup</button>
            <button onClick={() => rmDay(d.id)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:8, padding:"0 12px", cursor:"pointer" }}>del</button>
          </div>
          <DragList
            items={d.items}
            keyOf={(it, i) => it.key + ":" + i}
            onMove={(from, to) => moveItem(d.id, from, to)}
            render={(it, i, handle) => {
              const ex = exByKey(it.key);
              const wr = ex && (ex.t === "wr" || ex.t === "wd");
              return (
                <div style={{ background:C.bg, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 10px", marginBottom:8 }}>
                  <div style={{ display:"flex", gap:4, alignItems:"center" }}>
                    {handle}
                    <div style={{ flex:1 }}>
                      <div style={{ fontSize:13, fontWeight:600 }}>{ex ? ex.n : "(missing)"}</div>
                      {ex && <div style={{ fontSize:10, color:C.dim }}>{ex.m} · {T_LABEL[ex.t]}{rpHint(ex) ? " · " + rpHint(ex) : ""}</div>}
                    </div>
                    <button onClick={() => openPicker(k => swapItem(d.id, i, k), ex ? ex.m : "")} title="swap exercise"
                      style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:6, height:30, padding:"0 8px", cursor:"pointer", fontSize:11, marginRight:4 }}>swap</button>
                    <button onClick={() => rmItem(d.id, i)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:6, width:30, height:30, cursor:"pointer" }}>×</button>
                  </div>
                  <div style={{ display:"flex", gap:6, marginTop:8, alignItems:"flex-end" }}>
                    <TgtField label="sets" val={it.target?.sets} onChange={v => setTarget(d.id, i, "sets", v)} />
                    <TgtField label="rep lo" val={it.target?.repLo} onChange={v => setTarget(d.id, i, "repLo", v)} />
                    <TgtField label="rep hi" val={it.target?.repHi} onChange={v => setTarget(d.id, i, "repHi", v)} />
                    {wr && <TgtField label="weight" val={it.target?.w ?? ""} onChange={v => setTarget(d.id, i, "w", v)} />}
                  </div>
                </div>
              );
            }}
          />
          <button onClick={() => openPicker(k => addItem(d.id, k))} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.acc, borderRadius:8, padding:"8px 0", fontSize:13, width:"100%", cursor:"pointer", marginTop:2 }}>+ add exercise</button>
        </div>
      ))}

      <button onClick={addDay} style={{ ...btn(C.panel2, C.ink), marginTop:12 }}>+ day</button>

      <CustomLibrary program={program} custom={custom} removeCustom={removeCustom} updateCustom={updateCustom} />

      {restPrefs && <div style={{ marginTop:20 }}><RestSettings prefs={restPrefs} save={saveRestPrefs} /></div>}

      <div style={{ ...card, marginTop:20 }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Backup & reset</div>
        <div style={{ display:"flex", gap:10 }}>
          <button onClick={exportJson} style={btn(C.panel2, C.ink)}>Export JSON</button>
          <label style={{ ...btn(C.panel2, C.ink), display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer" }}>
            Import<input type="file" accept="application/json" style={{ display:"none" }} onChange={e => e.target.files[0] && importJson(e.target.files[0])} />
          </label>
        </div>
        {!confirmReset
          ? <button onClick={() => setConfirmReset(true)} style={{ ...btn("transparent", C.warn), border:`1px solid ${C.line}`, marginTop:10 }}>Reset program to built-in PPL</button>
          : <div style={{ marginTop:10, display:"flex", gap:10 }}>
              <button onClick={() => setConfirmReset(false)} style={btn(C.panel2, C.dim)}>Cancel</button>
              <button onClick={() => { onReset(); setConfirmReset(false); }} style={btn(C.warn, "#1A0E0E")}>Confirm reset</button>
            </div>}
        <div style={{ fontSize:11, color:C.dim, marginTop:8 }}>Reset replaces the current program only — logged sessions stay. Export periodically; storage lives only in this browser.</div>
      </div>
    </div>
  );
}
function TgtField({ label, val, onChange }) {
  return (
    <div style={{ flex:1 }}>
      <label style={{ fontSize:9, color:C.dim, display:"block", textAlign:"center", marginBottom:2 }}>{label}</label>
      <input style={{ ...inp, padding:"6px 4px", fontSize:14 }} inputMode="decimal" value={val ?? ""} placeholder="—" onChange={e => onChange(e.target.value)} />
    </div>
  );
}

/* ============================================================
   Exercise picker (library + add custom)
   ============================================================ */
/* Manage your own exercises: edit in place (key is preserved, so program slots
   and logged history stay attached) or delete with a usage warning. */
function CustomLibrary({ program, custom, removeCustom, updateCustom }) {
  const [editing, setEditing] = useState(null);   // key being edited
  const [confirmDel, setConfirmDel] = useState(null);
  const usage = useMemo(() => {
    const m = {};
    (program?.days || []).forEach(d => d.items.forEach(it => { m[it.key] = (m[it.key] || 0) + 1; }));
    return m;
  }, [program]);
  const allNames = useMemo(() => [...LIB.map(e => e.n), ...custom.map(c => c.n)], [custom]);

  return (
    <div style={{ ...card, marginTop:20 }}>
      <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Your exercises</div>
      {custom.length === 0 && (
        <div style={{ fontSize:12, color:C.dim, lineHeight:1.5 }}>
          Nothing added yet. Tap <span style={{ color:C.acc }}>+ add exercise</span> on any day above, search for the
          movement, and if it isn't in the library hit <span style={{ color:C.acc }}>+ create</span> at the bottom of the picker.
        </div>
      )}
      {custom.map(c => {
        const used = usage[c.key] || 0;
        if (editing === c.key) {
          return (
            <div key={c.key} style={{ background:C.bg, border:`1px solid ${C.line}`, borderRadius:8, padding:12, marginBottom:8 }}>
              <CustomForm
                initial={c}
                existingNames={allNames}
                saveLabel="Save changes"
                onCancel={() => setEditing(null)}
                onSave={async ex => { await updateCustom(c.key, ex); setEditing(null); }} />
            </div>
          );
        }
        return (
          <div key={c.key} style={{ marginBottom:8 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8 }}>
              <div style={{ fontSize:13, minWidth:0 }}>
                {c.n}
                <div style={{ color:C.dim, fontSize:11 }}>
                  {c.m} · {c.e} · {T_LABEL[c.t]}{used ? ` · in ${used} program slot${used>1?"s":""}` : ""}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, flexShrink:0 }}>
                <button onClick={() => { setConfirmDel(null); setEditing(c.key); }}
                  style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:6, padding:"2px 10px", cursor:"pointer", fontSize:12 }}>edit</button>
                <button onClick={() => setConfirmDel(confirmDel === c.key ? null : c.key)}
                  style={{ background:"transparent", border:`1px solid ${confirmDel === c.key ? C.warn : C.line}`, color: confirmDel === c.key ? C.warn : C.dim, borderRadius:6, padding:"2px 10px", cursor:"pointer", fontSize:12 }}>del</button>
              </div>
            </div>
            {confirmDel === c.key && (
              <div style={{ marginTop:6, padding:"8px 10px", background:C.bg, border:`1px solid ${C.warn}`, borderRadius:8 }}>
                <div style={{ fontSize:11, color:C.dim, lineHeight:1.5, marginBottom:8 }}>
                  {used
                    ? `Used in ${used} program slot${used>1?"s":""} — those will show as "(missing)" until you swap in a replacement. `
                    : ""}
                  Logged history keeps the name but drops out of muscle-volume totals.
                </div>
                <div style={{ display:"flex", gap:8 }}>
                  <button onClick={() => setConfirmDel(null)} style={{ ...btn(C.panel2, C.dim), padding:"7px 10px", fontSize:12 }}>Cancel</button>
                  <button onClick={() => { removeCustom(c.key); setConfirmDel(null); }} style={{ ...btn("transparent", C.warn), border:`1px solid ${C.warn}`, padding:"7px 10px", fontSize:12 }}>Delete</button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Picker({ custom, onAddCustom, onPick, onClose, initialQ }) {
  const [q, setQ] = useState(initialQ || "");
  const [adding, setAdding] = useState(false);
  const all = useMemo(() => [...LIB, ...custom], [custom]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = all.filter(e => !ql || e.n.toLowerCase().includes(ql) || e.m.toLowerCase().includes(ql) || e.e.toLowerCase().includes(ql));
    const by = {}; filtered.forEach(e => { (by[e.m] = by[e.m] || []).push(e); });
    return MUSCLES.filter(m => by[m]).map(m => [m, by[m]]);
  }, [all, q]);
  const existingNames = useMemo(() => all.map(e => e.n), [all]);
  // if the search text is itself a muscle name, seed the new-exercise muscle with it
  const qTrim = q.trim();
  const seedMuscle = MUSCLES.find(m => m.toLowerCase() === qTrim.toLowerCase()) || null;
  const seedName = seedMuscle ? "" : qTrim;

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.6)", zIndex:60, display:"flex", flexDirection:"column" }} onClick={onClose}>
      <div style={{ background:C.panel, marginTop:"auto", maxHeight:"85vh", borderRadius:"16px 16px 0 0", display:"flex", flexDirection:"column", maxWidth:520, width:"100%", marginLeft:"auto", marginRight:"auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ padding:14, borderBottom:`1px solid ${C.line}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
            <div style={{ fontSize:15, fontWeight:700 }}>{adding ? "New custom exercise" : "Add exercise"}</div>
            <button onClick={onClose} style={{ background:"transparent", border:"none", color:C.dim, fontSize:20, cursor:"pointer" }}>×</button>
          </div>
          {!adding && <input style={{ ...inp, textAlign:"left" }} value={q} placeholder="search name / muscle / equipment" onChange={e => setQ(e.target.value)} autoFocus />}
        </div>
        <div style={{ overflowY:"auto", padding:14, flex:1 }}>
          {adding
            ? <CustomForm
                initialName={seedName}
                initialMuscle={seedMuscle}
                existingNames={existingNames}
                onCancel={() => setAdding(false)}
                onSave={async ex => { const k = await onAddCustom(ex); setAdding(false); setQ(""); onPick(k); }} />
            : <>
                {groups.map(([m, list]) => (
                  <div key={m} style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{m}</div>
                    {list.map(e => (
                      <button key={e.key} onClick={() => onPick(e.key)} style={{ display:"flex", justifyContent:"space-between", width:"100%", background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", marginBottom:6, cursor:"pointer", textAlign:"left" }}>
                        <span style={{ fontSize:14 }}>
                          {e.n}
                          {e.key.startsWith("cus:") && <span style={{ fontSize:10, color:C.acc, marginLeft:6 }}>own</span>}
                        </span>
                        <span style={{ fontSize:11, color:C.dim }}>{e.e}{rpHint(e) ? " · " + rpHint(e) : ""}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && <Empty msg="No matches." />}
              </>}
        </div>
        {!adding && (
          <div style={{ padding:"10px 14px calc(14px + env(safe-area-inset-bottom))", borderTop:`1px solid ${C.line}`, background:C.panel }}>
            <button onClick={() => setAdding(true)} style={{ ...btn(C.panel2, C.acc), border:`1px dashed ${C.acc}`, marginTop:0 }}>
              {seedName ? `+ create "${seedName}"` : "+ create custom exercise"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
function CustomForm({ initial, initialName, initialMuscle, existingNames, saveLabel, onCancel, onSave }) {
  const [n, setN] = useState(initial?.n ?? initialName ?? "");
  const [m, setM] = useState(initial?.m ?? initialMuscle ?? MUSCLES[0]);
  const [e, setE] = useState(initial?.e ?? "Barbell");
  const [t, setT] = useState(initial?.t ?? "wr");
  const [role, setRole] = useState(initial?.role ?? "compound");
  const sel = { background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 10px", fontSize:14, width:"100%" };
  const RP_RANGE = { heavy:[5,10], compound:[8,12], iso:[10,15], small:[12,20], rehab:[10,15] };
  const trimmed = n.trim();
  const dupe = trimmed.length > 0 && (existingNames || [])
    .some(x => x.toLowerCase() === trimmed.toLowerCase() && x.toLowerCase() !== (initial?.n || "").toLowerCase());
  const canSave = trimmed.length > 0 && !dupe;
  return (
    <div>
      <label style={{ fontSize:11, color:C.dim }}>name</label>
      <input style={{ ...inp, textAlign:"left", marginBottom: dupe ? 4 : 10, borderColor: dupe ? C.warn : undefined }} value={n} onChange={ev => setN(ev.target.value)} autoFocus />
      {dupe && <div style={{ fontSize:11, color:C.warn, marginBottom:10 }}>"{trimmed}" already exists — pick a different name.</div>}
      <label style={{ fontSize:11, color:C.dim }}>muscle</label>
      <select style={{ ...sel, marginBottom:10 }} value={m} onChange={ev => setM(ev.target.value)}>{MUSCLES.map(x => <option key={x}>{x}</option>)}</select>
      <label style={{ fontSize:11, color:C.dim }}>equipment</label>
      <select style={{ ...sel, marginBottom:10 }} value={e} onChange={ev => setE(ev.target.value)}>{["Barbell","Dumbbell","Machine","Cable","Bodyweight","Band"].map(x => <option key={x}>{x}</option>)}</select>
      <label style={{ fontSize:11, color:C.dim }}>log type</label>
      <select style={{ ...sel, marginBottom:10 }} value={t} onChange={ev => setT(ev.target.value)}>
        <option value="wr">weight × reps</option><option value="rep">bodyweight reps</option>
        <option value="time">hold / time</option><option value="wd">load + distance</option><option value="cardio">cardio</option>
      </select>
      <label style={{ fontSize:11, color:C.dim }}>RP rep-range band</label>
      <select style={{ ...sel, marginBottom:14 }} value={role} onChange={ev => setRole(ev.target.value)}>
        <option value="heavy">heavy compound (5–10)</option><option value="compound">compound (8–12)</option>
        <option value="iso">isolation (10–15)</option><option value="small">small muscle (12–20)</option><option value="rehab">rehab (10–15)</option>
      </select>
      <div style={{ display:"flex", gap:10 }}>
        <button onClick={onCancel} style={btn(C.panel2, C.dim)}>Cancel</button>
        <button disabled={!canSave}
          onClick={() => canSave && onSave({ n: trimmed, m, e, t, role, rp: RP_RANGE[role] })}
          style={{ ...btn(canSave ? C.acc : C.panel2, canSave ? "#04150E" : C.dim), cursor: canSave ? "pointer" : "not-allowed" }}>
          {saveLabel || "Add & use"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================
   Charts (inline SVG)
   ============================================================ */
function Stat({ row }) {
  return (
    <div style={{ display:"flex", gap:10, marginTop:12 }}>
      {row.map(([l, v], i) => (
        <div key={i} style={{ ...card, marginTop:0, flex:1, textAlign:"center" }}>
          <div style={{ fontSize:22, fontWeight:700 }}>{v}</div>
          <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{l}</div>
        </div>
      ))}
    </div>
  );
}
function Line({ title, data, color, unit, header, embedded, marks, markLabel }) {
  const W = 320, H = 120, pad = 8;
  const vals = data.map(d => d.v);
  const min = Math.min(...vals, 0), max = Math.max(...vals, 1);
  const span = max - min || 1;
  const pts = data.map((d, i) => {
    const x = pad + (data.length === 1 ? (W-2*pad)/2 : (i/(data.length-1))*(W-2*pad));
    const y = H - pad - ((d.v - min)/span)*(H-2*pad);
    return [x, y];
  });
  const path = pts.map((p, i) => (i===0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const body = (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
        <div style={{ fontSize:13, fontWeight:600 }}>{title}</div>
        {header || (data.length > 0 && <div style={{ fontSize:13, color, fontWeight:700 }}>{data[data.length-1].v}{unit ? " " + unit : ""}</div>)}
      </div>
      {data.length === 0
        ? <div style={{ fontSize:12, color:C.dim, padding:"10px 0" }}>No data yet.</div>
        : <svg viewBox={`0 0 ${W} ${H}`} style={{ width:"100%", height:"auto", display:"block" }}>
            <path d={path} fill="none" stroke={color} strokeWidth="2" />
            {pts.map((p, i) => marks && marks[i]
              ? <g key={i}><circle cx={p[0]} cy={p[1]} r="6" fill="none" stroke={C.gold} strokeWidth="1.5" /><circle cx={p[0]} cy={p[1]} r="3" fill={C.gold} /></g>
              : <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={color} />)}
          </svg>}
      {marks && marks.some(Boolean) && (
        <div style={{ fontSize:10, color:C.dim, marginTop:4, display:"flex", alignItems:"center", gap:5 }}>
          <span style={{ display:"inline-block", width:8, height:8, borderRadius:4, background:C.gold, boxShadow:`0 0 0 2px ${C.panel}, 0 0 0 3px ${C.gold}` }} />
          {markLabel || "PR"} · {marks.filter(Boolean).length} of {data.length}
        </div>
      )}
    </>
  );
  return embedded ? <div>{body}</div> : <div style={card}>{body}</div>;
}
function Bars({ title, data }) {
  const max = Math.max(...data.map(([, v]) => v), 1);
  return (
    <div style={card}>
      <div style={{ fontSize:13, fontWeight:600, marginBottom:10 }}>{title}</div>
      <div style={{ display:"flex", gap:6, alignItems:"flex-end", height:90 }}>
        {data.map(([wk, v]) => (
          <div key={wk} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
            <div style={{ width:"100%", height:`${(v/max)*70}px`, background:C.acc, borderRadius:"4px 4px 0 0", minHeight:4 }} />
            <div style={{ fontSize:9, color:C.dim }}>{wk.slice(-3)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
