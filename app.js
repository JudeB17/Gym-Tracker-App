/* ============================================================
   app.js — Load/Log gym tracker (JSX, compiled in-browser by Babel)
   Depends on: window.GymData, window.GymStore
   ============================================================ */
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { MUSCLES, LIB, T, rpHint, defaultProgram,
        GOALS, SPLITS, splitsForDays, generateProgram, applyWeek, mesoStatus,
        seedWeight, volumeBand, LANDMARKS, roundLoad, MUSCLE_WEIGHT, EWS, cardioScore,
        suggestNext, incFor, generate531 } = window.GymData;
const { sGet, sSet, sDel, available } = window.GymStore;

/* ---------- theme (mirrors the CSS custom properties in index.html; used
   where a colour has to be passed into SVG or computed inline) ---------- */
const C = {
  bg: "#17181A", surface: "#222326", surface2: "#2C2D31", surface3: "#36373C", line: "#323338",
  ink: "#F2F2F3", ink2: "#B9BAC0", ink3: "#83848B",
  acc: "#FF7A1F", good: "#43B97E", warn: "#E3A33C", bad: "#EF5A50"
};
const T_LABEL = { wr: "Weight and reps", rep: "Bodyweight reps", time: "Timed hold", wd: "Load and distance", cardio: "Cardio" };
const cx = (...a) => a.filter(Boolean).join(" ");

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const fmtDate = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const TODAY = () => fmtDate(new Date());
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
const fmtDur = min => min == null ? "" : min >= 60 ? `${Math.floor(min/60)}h ${String(min%60).padStart(2,"0")}m` : `${min} min`;
/* human dates: "Mon 6 Oct", plus year when it isn't this year */
const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const WDAY = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const fmtDay = (dateStr, withWeekday = true) => {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d)) return dateStr;
  const y = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : "";
  return `${withWeekday ? WDAY[d.getDay()] + " " : ""}${d.getDate()} ${MON[d.getMonth()]}${y}`;
};
const relDay = dateStr => {
  const n = daysAgo(dateStr);
  return n === 0 ? "Today" : n === 1 ? "Yesterday" : n < 7 ? `${n} days ago` : fmtDay(dateStr, false);
};
const plural = (n, w, p) => `${n} ${n === 1 ? w : (p || w + "s")}`;
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
  const b = { wr:{w:"",r:"",rpe:""}, rep:{r:"",add:"",rpe:""}, time:{sec:""}, wd:{w:"",dist:""}, cardio:{min:"",dist:""} }[t];
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
/* Cardio used to store the "min" column under `sec` and then display it as
   sec/60, so 20 min showed as 0. The number typed was always minutes, so the
   fix is a rename: sec -> min. Idempotent; works on saved sessions and drafts. */
function migrateCardio(entries) {
  return (entries || []).map(e => {
    if (!e || e.t !== "cardio" || !e.sets || !e.sets.some(s => s && "sec" in s && !("min" in s))) return e;
    return { ...e, sets: e.sets.map(s => {
      if (!s || "min" in s || !("sec" in s)) return s;
      const { sec, ...rest } = s;
      return { ...rest, min: sec };
    }) };
  });
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
  // ensure entries can carry a note; cardio minutes live under `min`
  s.entries = migrateCardio((s.entries || []).map(e => ("note" in e ? e : { ...e, note: "" })));
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
   CARDIO (type "cardio") skips all of the above and is scored per minute by
   GymData.cardioScore: minutes × intensity × pace factor, with progress on
   duration and pace. See EWS.cardio in data.js.
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
    /* Cardio: per minute, not per row. Never runs through setQuality, whose
       rep-target rule used to flag every cardio row in a program day as junk. */
    if (e.t === "cardio") {
      const prior = [];
      byDate.forEach(s => { const pe = s.entries.find(x => x.key === e.key); if (pe && pe.sets && pe.sets.length) prior.push(pe.sets); });
      const w = muscle === "Mobility/Rehab" && MUSCLE_WEIGHT[muscle] != null ? MUSCLE_WEIGHT[muscle] : 1;
      const c = cardioScore(ex ? ex.n : e.name, e.sets, prior, w);
      out.ex.push({ key: e.key, name: e.name, muscle, weight: w, base: c.base, improve: c.improve, pr: c.pr,
        sets: e.sets.map(() => ({ q: 1, why: "" })), junk: 0, note: c.note });
      out.base += c.base; out.improve += c.improve; out.pr += c.pr;
      return;
    }
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
        note = (pct >= 0 ? "+" : "") + pct.toFixed(1) + "% vs last time";
      }
      if (best > 0 && now > best && nPrior >= EWS.prMinPrior) {
        const pct = (now - best) / best * 100;
        pr = base * EWS.prK * h(pct);
        note += (note ? ", " : "") + "PR +" + pct.toFixed(1) + "%";
      } else if (best > 0 && now > best) {
        note += (note ? ", " : "") + "new best (PR bonus starts at session " + (EWS.prMinPrior + 1) + ")";
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

  const toastTimer = useRef(null);
  const flash = useCallback(m => { setToast(m); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(""), m.length > 40 ? 3600 : 2400); }, []);
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
        setLoadErr("Saved data took too long to load, so the app opened with the default program. Storage may be blocked by private browsing. Close and reopen the app to try again.");
        setProgram(p => p || defaultProgram());
        setActiveDayId(a => a ?? null);
        setLoading(false);
      }
    }, 2500);
    (async () => {
      try {
        if (!available()) setLoadErr("This browser is blocking storage, usually because of private browsing. You can log a workout, but nothing will be saved after you close the app.");
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
        if (savedDraft && savedDraft.entries) { setDraft({ ...savedDraft, entries: migrateCardio(savedDraft.entries) }); setTab("log"); }
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
               progNote: t.plan.map(p => p.w).join(", ") + " kg" + (t.plan.some(p => p.plus) ? ". Last set as many reps as possible" : ""), progKind: "" };
    }

    const prev = lastForExercise(key);
    if (prev && prev.length) {
      // 2) history → double progression with per-set plan
      if (exType === "wr") {
        const band = t ? { repLo: t.repLo, repHi: t.repHi } : null;
        const ref = refSetsForExercise(key) || { sets: prev, offDay: false };
        const refWork = workSets(ref.sets).length ? workSets(ref.sets) : ref.sets;
        /* Best set first: heaviest, then most reps at that weight. If set 2
           came out heavier, or the same weight for more reps, it becomes next
           session's set 1 and the rest work down from there. Stable sort, so a
           normal top-set-first session is unchanged. */
        const ordered = refWork.slice().sort((a, b) => ((b.w || 0) - (a.w || 0)) || ((b.r || 0) - (a.r || 0)));
        const sug = suggestNext(ordered, ex, band, {
          deload: mesoDeload, nSets: nSets || ordered.length, workDown
        });
        if (sug) {
          /* No later set at the top weight asks for more reps than set 1.
             (Back-off sets at a lighter weight are left alone.) */
          if (!sug.bumped && !mesoDeload) {
            const r0 = sug.plan[0].r;
            sug.plan.forEach((p, i) => { if (i > 0 && p.w === sug.topW && p.r > r0) p.r = r0; });
          }
          const plan = sug.plan.map(p => ({ w: String(p.w), r: String(p.r) }));
          if (t) t.w = sug.topW;
          const note = ref.offDay ? `Last session looked like an off day. Back to ${sug.topW} kg` : sug.reason;
          return { target: t, ghostW: plan[0].w, ghostR: plan[0].r, est: false, plan, progNote: note,
                   progKind: mesoDeload ? "deload" : sug.bumped ? "up" : "" };
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
                 progNote: ref.r ? `Last time ${ref.r} reps${addStr ? " at " + addStr : ""}. Aim for ${ghostR}` : "" };
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
          plan: pf.plan || null, progNote: pf.progNote || "", progKind: pf.progKind || "",
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
        plan: pf.plan || null, progNote: pf.progNote || "", progKind: pf.progKind || "",
        sets: Array.from({ length: nSets }, () => blankSet(ex.t)) }] };
    });
  }, [exByKey, prefillFor]);

  const saveSession = useCallback(async () => {
    const notEmpty = (t, s) => ({
      wr: () => s.w !== "" || s.r !== "", rep: () => s.r !== "" || (s.add !== "" && s.add != null),
      time: () => s.sec !== "", wd: () => s.w !== "" || s.dist !== "",
      cardio: () => (s.min !== "" && s.min != null) || s.dist !== ""
    })[t]();
    const num = v => (v === "" || v == null) ? 0 : Number(v) || 0;
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
          return { min: num(s.min), dist: num(s.dist) };
        })
      })).filter(e => e.sets.length > 0 || e.note)
    };
    // a superset needs two members; drop the tag if only one survived cleanup
    const gCount = {};
    clean.entries.forEach(e => { if (e.group) gCount[e.group] = (gCount[e.group] || 0) + 1; });
    clean.entries = clean.entries.map(e => (e.group && gCount[e.group] < 2) ? (({ group, ...rest }) => rest)(e) : e);
    if (clean.entries.length === 0 && clean.injuries.length === 0) { flash("Log at least one set before finishing."); return; }
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
    if (prevSame) { const d = ews.total - scoreSession(prevSame, next, exByKey, program ? program.days : null).total; ewsMsg += `, ${d >= 0 ? "up" : "down"} ${fmtEws(Math.abs(d))} on last time`; }
    flash((existingIdx >= 0 ? "Workout updated." : "Workout saved.") + (prCount ? ` ${prCount} PR${prCount > 1 ? "s" : ""}.` : "") + ewsMsg + ".");
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
    setViewSession(null); flash("Workout deleted.");
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
          return { min: toStr(s.min), dist: toStr(s.dist) };
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
      flash("Backup restored.");
    } catch (e) { flash("That file isn't a backup from this app."); }
  }, [flash]);

  const resetProgram = useCallback(async () => { const fresh = defaultProgram(); await saveProgram(fresh); setActiveDayId(fresh.days[0].id); flash("Program reset to the built-in split."); }, [saveProgram, flash]);

  /* ---- generated mesocycle program ---- */
  const installGenerated = useCallback(async prog => {
    const p = { ...prog };
    if (p.meso) p.meso.startedOn = TODAY();
    await saveProgram(p);
    setActiveDayId(p.days[0]?.id ?? null);
    setTab("log");
    flash("New program ready to log.");
  }, [saveProgram, flash]);

  const advanceWeek = useCallback(async () => {
    if (!program || !program.meso) return;
    const next = Math.min(program.meso.week + 1, program.meso.totalWeeks);
    const updated = applyWeek(program, next);
    await saveProgram(updated);
    const st = mesoStatus(updated);
    flash(st && st.isDeload ? "Deload week. Keep the weights light." : `Now on week ${next}.`);
  }, [program, saveProgram, flash]);

  const exitMeso = useCallback(async () => {
    if (!program) return;
    const { meso, generated, ...rest } = program;
    const stripped = { ...rest, days: program.days.map(d => { const { blueprint, ...dd } = d; return { ...dd, items: d.items.map(it => { const { tier, est, ...ii } = it; return ii; }) }; }) };
    await saveProgram(stripped);
    flash("Mesocycle ended. The program stays and is now fully editable.");
  }, [program, saveProgram, flash]);

  const openPicker = useCallback((onPick, initialQ) => setPicker({ onPick, initialQ: initialQ || "" }), []);

  if (loading) return <div className="boot">Loading</div>;

  const goTab = t => { setViewSession(null); setTab(t); window.scrollTo(0, 0); };

  return (
    <div className="app">
      <div className="page">
        {loadErr && (
          <div className="banner" role="alert">
            <div style={{ flex: 1 }}>{loadErr}</div>
            <button className="icon-btn" aria-label="Dismiss" onClick={() => setLoadErr("")} style={{ width: 32, height: 32 }}><Icon n="x" s={18} /></button>
          </div>
        )}
        {tab === "log" && (
          draft
            ? <DraftView draft={draft} setDraft={setDraft} onSave={saveSession} onDiscard={discardDraft} restPrefs={restPrefs} saveRestPrefs={saveRestPrefs}
                lastForExercise={lastForExercise} exByKey={exByKey} gyms={gyms}
                onAddExercise={() => openPicker(k => { addExerciseToDraft(k); setPicker(null); })} />
            : <StartView program={program} activeDayId={activeDayId} setActiveDayId={setActiveDayId} onStart={startSession} sessions={sessions}
                onOpenProgram={() => goTab("program")} />
        )}
        {tab === "history" && (
          viewSession
            ? <SessionDetail session={viewSession} onBack={() => { setViewSession(null); window.scrollTo(0, 0); }} onDelete={deleteSession} onEdit={editSession} exByKey={exByKey} scoreOf={scoreOf} />
            : <HistoryList sessions={sessions} onOpen={s => { setViewSession(s); window.scrollTo(0, 0); }} scoreOf={scoreOf} onStart={() => goTab("log")} />
        )}
        {tab === "trends" && <Trends sessions={sessions} allEx={allEx} exResolve={exByKey} scoreOf={scoreOf} />}
        {tab === "program" && <ProgramTab program={program} setProgram={saveProgram} exByKey={exByKey}
          openPicker={openPicker} custom={custom} removeCustom={removeCustom} updateCustom={updateCustom}
          exportJson={exportJson} importJson={importJson} onReset={resetProgram}
          onAdvanceWeek={advanceWeek} onExitMeso={exitMeso} restPrefs={restPrefs} saveRestPrefs={saveRestPrefs}
          injuries={injuries} saveInjuries={saveInjuries} sessions={sessions} onInstall={installGenerated} />}
      </div>
      {picker && <Picker custom={custom} onAddCustom={addCustom} onPick={picker.onPick} initialQ={picker.initialQ} onClose={() => setPicker(null)} />}
      {toast && <div className="toast" role="status">{toast}</div>}
      <TabBar tab={tab} setTab={goTab} logging={!!draft} />
    </div>
  );
}

/* ============================================================
   Primitives
   ============================================================ */
const ICONS = {
  log: <path d="M6.5 6.5v11M17.5 6.5v11M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  trends: <path d="M4 4.5v15h16M8 14.5l3.5-4 3 2.5L20 7" />,
  program: <path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />,
  chevR: <path d="M9.5 5.5l6.5 6.5-6.5 6.5" />,
  chevL: <path d="M15 5l-7 7 7 7" />,
  chevD: <path d="M6 9.5l6 6 6-6" />,
  chevU: <path d="M6 14.5l6-6 6 6" />,
  x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  more: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L20 20" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5v-2a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" /></>
};
function Icon({ n, s = 22, w = 1.9 }) {
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[n]}
    </svg>
  );
}

/* sticky navigation bar. Root screens get a large title; pushed screens get
   a back button and a centred title. */
function NavBar({ title, large, backLabel, onBack, right }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  if (large) {
    return (
      <div className={cx("navbar", scrolled && "scrolled")}>
        <div className="navbar-row" style={{ minHeight: 52 }}>
          <h1>{title}</h1>
          {right}
        </div>
      </div>
    );
  }
  return (
    <div className={cx("navbar", scrolled && "scrolled")}>
      <div className="navbar-row">
        <div style={{ flex: "0 0 30%", minWidth: 0 }}>
          {onBack && <button className="back" onClick={onBack}><Icon n="chevL" s={24} w={2.2} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{backLabel || "Back"}</span></button>}
        </div>
        <div className="nav-title">{title}</div>
        <div style={{ flex: "0 0 30%", display: "flex", justifyContent: "flex-end" }}>{right}</div>
      </div>
    </div>
  );
}

function TabBar({ tab, setTab, logging }) {
  const tabs = [["log", "Log"], ["history", "History"], ["trends", "Trends"], ["program", "Program"]];
  return (
    <nav className="tabbar" aria-label="Main">
      <div className="tabbar-inner">
        {tabs.map(([k, label]) => (
          <button key={k} className={cx("tab", tab === k && "on")} onClick={() => setTab(k)} aria-current={tab === k ? "page" : undefined}>
            {k === "log" && logging && tab !== k && <span className="live" aria-label="Workout in progress" />}
            <Icon n={k} s={25} w={tab === k ? 2.1 : 1.8} />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function Sheet({ title, onClose, children, foot, bodyStyle }) {
  useEffect(() => {
    const k = e => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        {title != null && (
          <div className="sheet-head">
            <h3>{title}</h3>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><Icon n="x" /></button>
          </div>
        )}
        <div className="sheet-body" style={bodyStyle}>{children}</div>
        {foot && <div className="sheet-foot">{foot}</div>}
      </div>
    </div>
  );
}

/* iOS-style action sheet. actions: [{ label, onClick, danger, disabled }] */
function ActionSheet({ message, actions, onClose }) {
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" style={{ background: "transparent" }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="actions">
          <div className="group">
            {message && <div className="msg">{message}</div>}
            {actions.filter(Boolean).map((a, i) => (
              <button key={i} className="row" disabled={a.disabled} style={{ opacity: a.disabled ? .4 : 1 }}
                onClick={() => { onClose(); a.onClick(); }}>
                <span className={cx("row-title", a.danger && "bad")} style={!a.danger ? { color: C.acc } : null}>{a.label}</span>
              </button>
            ))}
          </div>
          <div className="group cancel">
            <button className="row" onClick={onClose}><span className="row-title">Cancel</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Switch({ on, onChange, disabled, label }) {
  return <button role="switch" aria-checked={!!on} aria-label={label} disabled={disabled} className={cx("switch", on && "on")} onClick={() => onChange(!on)} />;
}
function Seg({ value, options, onChange, lg, style }) {
  return (
    <div className={cx("seg", lg && "lg")} role="tablist" style={style}>
      {options.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? "on" : ""} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}
function Stepper({ value, min = 0, max = 99, step = 1, onChange, fmt }) {
  return (
    <div className="stepper">
      <button aria-label="Decrease" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}><Icon n="minus" s={18} w={2.2} /></button>
      <span className="v">{fmt ? fmt(value) : value}</span>
      <button aria-label="Increase" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}><Icon n="plus" s={18} w={2.2} /></button>
    </div>
  );
}
/* up/down reorder buttons. After the move, scroll so the moved card stays
   under the finger and the buttons can be tapped again. */
function MoveBtns({ index, count, onMove, name }) {
  const move = (ev, to) => {
    const el = ev.currentTarget.closest("[data-move]");
    const before = el ? el.getBoundingClientRect().top : null;
    onMove(index, to);
    if (el) requestAnimationFrame(() => { const d = el.getBoundingClientRect().top - before; if (d) window.scrollBy(0, d); });
  };
  return (
    <div className="move">
      <button aria-label={`Move ${name} up`} disabled={index === 0} onClick={ev => move(ev, index - 1)}><Icon n="chevU" s={22} w={2.2} /></button>
      <button aria-label={`Move ${name} down`} disabled={index >= count - 1} onClick={ev => move(ev, index + 1)}><Icon n="chevD" s={22} w={2.2} /></button>
    </div>
  );
}
function Empty({ title, msg, action }) {
  return (
    <div style={{ textAlign: "center", padding: "56px 24px 24px" }}>
      {title && <div style={{ fontSize: 18, fontWeight: 600 }}>{title}</div>}
      {msg && <div className="muted" style={{ fontSize: 15, marginTop: 6, lineHeight: 1.45 }}>{msg}</div>}
      {action && <div style={{ marginTop: 18 }}>{action}</div>}
    </div>
  );
}
function GroupLabel({ children, right }) {
  return right
    ? <div className="group-label" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span>{children}</span>{right}</div>
    : <div className="group-label">{children}</div>;
}

/* ============================================================
   Log: choose a workout
   ============================================================ */
function StartView({ program, activeDayId, setActiveDayId, onStart, sessions, onOpenProgram }) {
  const thisWeek = isoWeek(TODAY());
  const doneThisWeek = sessions.filter(s => isoWeek(s.date) === thisWeek).length;
  const st = mesoStatus(program);
  const lastByDay = useMemo(() => {
    const m = {};
    sessions.forEach(s => { if (s.dayId && (!m[s.dayId] || s.date > m[s.dayId])) m[s.dayId] = s.date; });
    return m;
  }, [sessions]);
  const pct = program.target > 0 ? Math.min(100, (doneThisWeek / program.target) * 100) : 0;
  const active = program.days.find(d => d.id === activeDayId);
  return (
    <div>
      <NavBar large title="Log" right={st && <span className={cx("status-pill", st.isDeload && "deload")}>{st.label}</span>} />

      <div className="group" style={{ marginTop: 8 }}>
        <div className="row" style={{ display: "block", paddingTop: 14, paddingBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span className="row-title">This week</span>
            <span className="row-value"><b style={{ color: C.ink }}>{doneThisWeek}</b> of {program.target} workouts</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: C.surface3, marginTop: 10, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${pct}%`, background: pct >= 100 ? C.good : C.acc, borderRadius: 3, transition: "width .3s" }} />
          </div>
        </div>
        {st && (
          <div className="row">
            <div className="row-main">
              <div className="row-title">{st.splitName}</div>
              <div className="row-sub">{st.goalLabel}{st.isDeload ? ". Deload week, keep loads light" : ""}</div>
            </div>
            {st.rir && <div className="row-value" title="Reps in reserve">{st.rir.lo}–{st.rir.hi} RIR</div>}
          </div>
        )}
      </div>

      <GroupLabel>Choose a workout</GroupLabel>
      {program.days.length === 0 ? (
        <div className="group"><button className="row" onClick={onOpenProgram}><span className="row-main row-title acc">Add workout days in Program</span><span className="row-chev"><Icon n="chevR" s={18} /></span></button></div>
      ) : (
        <div className="group" role="radiogroup">
          {program.days.map(d => {
            const last = lastByDay[d.id];
            const on = activeDayId === d.id;
            return (
              <button key={d.id} role="radio" aria-checked={on} className={cx("row", on && "selected")} onClick={() => setActiveDayId(d.id)}>
                <div className="row-main">
                  <div className="row-title">{d.name}</div>
                  <div className="row-sub">{plural(d.items.length, "exercise")}{last ? `, last done ${lastDoneLabel(last)}` : ""}</div>
                </div>
                <span className="check" style={{ visibility: on ? "visible" : "hidden" }}><Icon n="check" w={2.4} /></span>
              </button>
            );
          })}
        </div>
      )}
      {active && (
        <button className="btn btn-primary block" style={{ marginTop: 20 }} onClick={onStart}>Start {active.name}</button>
      )}
    </div>
  );
}

/* ============================================================
   Log: workout in progress
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
  const live = !!draft.startedAt;

  /* elapsed workout clock (live workouts only, not edits) */
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    if (!draft.startedAt) return;
    const t = setInterval(() => setNowTick(Date.now()), 15000);
    return () => clearInterval(t);
  }, [draft.startedAt]);
  const elapsedMin = draft.startedAt ? Math.max(0, Math.round((nowTick - draft.startedAt) / 60000)) : null;

  /* rest timer: starts when a set is ticked. Length = per-exercise override
     if set, else the default. Alerts (notification / sound / vibrate) fire
     from a setTimeout at the exact end, plus a late-fire check when the page
     comes back to the foreground. */
  const [restEnd, setRestEnd] = useState(null);
  const [restTotal, setRestTotal] = useState(0);
  const [restFor, setRestFor] = useState("");
  const [restPick, setRestPick] = useState(null); // null | { scope:"default" } | { scope:"ex", key, name }
  const prefsRef = useRef(restPrefs);
  useEffect(() => { prefsRef.current = restPrefs; }, [restPrefs]);
  const startRest = useCallback((entry) => {
    const p = prefsRef.current;
    const o = entry && p.byEx && p.byEx[entry.key];
    const len = o != null ? o : p.len;
    if (len > 0) { setRestEnd(Date.now() + len * 1000); setRestTotal(len); setRestFor(entry ? entry.name : ""); }
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
  /* Rest only starts when the block is actually over:
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

  /* ---- supersets (ad hoc, per workout) ----
     pairing = eid of the exercise that started a pair. Choosing a second
     exercise joins them (reusing either one's existing group), then the joined
     exercise is moved to sit directly after the group so the log flows A1, A2. */
  const [pairing, setPairing] = useState(null);
  const groupLabels = useMemo(() => {
    const m = {}; let n = 0;
    draft.entries.forEach(e => { if (e.group && !(e.group in m)) m[e.group] = n++; });
    return m;
  }, [draft.entries]);
  const groupInfo = e => {
    if (!e.group || !(e.group in groupLabels)) return null;
    const ord = groupLabels[e.group];
    const members = draft.entries.filter(x => x.group === e.group);
    const idx = members.findIndex(x => x.eid === e.eid);
    return { letter: String.fromCharCode(65 + ord), idx: idx + 1, size: members.length };
  };
  const pairWith = eid => {
    const first = pairing; setPairing(null);
    if (!first || first === eid) return;
    setDraft(d => {
      const a = d.entries.find(e => e.eid === first), b = d.entries.find(e => e.eid === eid);
      if (!a || !b) return d;
      const gid = a.group || b.group || uid();
      let ents = d.entries.map(e => (e.eid === first || e.eid === eid || (a.group && e.group === a.group) || (b.group && e.group === b.group)) ? { ...e, group: gid } : e);
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
      if (left.length < 2 && e.group === me.group) return { ...e, group: null };
      return e;
    }) };
  });
  const pairingEntry = pairing ? draft.entries.find(e => e.eid === pairing) : null;

  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const totalSets = draft.entries.reduce((a, e) => a + e.sets.length, 0);
  const doneSets = draft.entries.reduce((a, e) => a + e.sets.filter(s => s.done).length, 0);
  const finishLabel = live ? "Finish" : "Save";

  return (
    <div>
      <NavBar title={live ? (elapsedMin != null ? fmtClock(elapsedMin) : "") : "Edit workout"}
        onBack={live ? null : () => setConfirmDiscard(true)} backLabel="Cancel"
        right={<button className="btn btn-primary btn-sm" onClick={onSave}>{finishLabel}</button>} />

      <div style={{ marginTop: 4 }}>
        <input className="session-title" aria-label="Workout name" value={draft.dayName}
          onChange={e => setDraft(d => ({ ...d, dayName: e.target.value }))} />
        <div className="session-meta">
          <span>{fmtDay(draft.date)}</span>
          {live && totalSets > 0 && <span><b className="num-t">{doneSets}</b> of {plural(totalSets, "set")} done</span>}
          {!live && draft.durationMin != null && <span>{fmtDur(draft.durationMin)}</span>}
        </div>
      </div>

      {draft.entries.length === 0 && (
        <Empty title="No exercises yet" msg="Add the first exercise to start logging." />
      )}

      {draft.entries.map((e, i) => (
        <ExerciseCard key={e.eid || e.key} entry={e} index={i} count={draft.entries.length} onMove={moveEntry}
          setEntry={setEntry} rmEntry={rmEntry} prev={lastForExercise(e.key)} ex={exByKey(e.key)} onSetDone={onSetDone}
          ss={groupInfo(e)} pairing={pairing} pairingName={pairingEntry ? pairingEntry.name : ""}
          restOverride={restPrefs.byEx && restPrefs.byEx[e.key]} restDefault={restPrefs.len}
          onRestPick={() => setRestPick({ scope: "ex", key: e.key, name: e.name })}
          onPairStart={() => setPairing(e.eid)}
          onPairWith={() => pairWith(e.eid)}
          onUnlink={() => unlink(e.eid)} />
      ))}

      <button className="btn btn-secondary block" style={{ marginTop: 14 }} onClick={onAddExercise}><Icon n="plus" s={20} w={2.2} />Add exercise</button>

      <GroupLabel>Workout details</GroupLabel>
      <div className="group">
        <div className="row" style={{ display: "block", paddingTop: 12, paddingBottom: 12 }}>
          <div className="row-title" style={{ marginBottom: 10 }}>Gym</div>
          <GymPicker gym={draft.gym} gyms={gyms || []} onSet={g => setDraft(d => ({ ...d, gym: g }))} />
        </div>
        <label className="row">
          <span className="row-main row-title">Bodyweight</span>
          <input className="inline-num" inputMode="decimal" placeholder="Optional" value={draft.bodyweight}
            onChange={e => setDraft(d => ({ ...d, bodyweight: e.target.value }))} />
          <span className="muted">kg</span>
        </label>
        <button className="row" onClick={() => setRestPick({ scope: "default" })}>
          <span className="row-main row-title">Rest between sets</span>
          <span className="row-value">{fmtRestLong(restPrefs.len)}</span>
          <span className="row-chev"><Icon n="chevR" s={18} /></span>
        </button>
      </div>

      <FeelRating draft={draft} setDraft={setDraft} />
      <DraftInjuries draft={draft} setDraft={setDraft} />

      <button className="btn btn-primary block" style={{ marginTop: 28 }} onClick={onSave}>{live ? "Finish workout" : "Save changes"}</button>
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <button className="btn-plain danger btn" onClick={() => setConfirmDiscard(true)}>{live ? "Discard workout" : "Discard changes"}</button>
      </div>

      {confirmDiscard && (
        <ActionSheet onClose={() => setConfirmDiscard(false)}
          message={live ? "Discard this workout? Everything you have logged in it will be lost." : "Discard your changes to this workout?"}
          actions={[{ label: live ? "Discard workout" : "Discard changes", danger: true, onClick: onDiscard }]} />
      )}

      {pairingEntry && (
        <div className="pair-bar">
          <div>
            <span style={{ flex: 1 }}>Choose an exercise to superset with <b>{pairingEntry.name}</b></span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPairing(null)}>Cancel</button>
          </div>
        </div>
      )}
      {restEnd && !pairingEntry && <RestBar endAt={restEnd} total={restTotal} step={restPrefs.step || 30} label={restFor}
        onExtend={() => { const s = restPrefs.step || 30; setRestEnd(t => t + s * 1000); setRestTotal(t => t + s); }} onClear={() => setRestEnd(null)} />}
      {restPick && (
        <RestPicker
          title={restPick.scope === "ex" ? `Rest after ${restPick.name}` : "Rest between sets"}
          value={restPick.scope === "ex" ? (restPrefs.byEx && restPrefs.byEx[restPick.key] != null ? restPrefs.byEx[restPick.key] : null) : restPrefs.len}
          fallback={restPick.scope === "ex" ? restPrefs.len : null}
          onPick={v => {
            if (restPick.scope === "ex") saveRestPrefs(p => { const byEx = { ...(p.byEx || {}) }; if (v == null) delete byEx[restPick.key]; else byEx[restPick.key] = v; return { byEx }; });
            else { saveRestPrefs({ len: v }); if (v === 0) setRestEnd(null); }
            setRestPick(null);
          }}
          onClose={() => setRestPick(null)} />
      )}
    </div>
  );
}
const lastDoneLabel = d => { const n = daysAgo(d); return n === 0 ? "today" : n === 1 ? "yesterday" : n < 14 ? `${n} days ago` : `on ${fmtDay(d, false)}`; };
const fmtClock = min => min < 1 ? "Just started" : min >= 60 ? `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m` : `${min} min`;
const fmtRestLong = sec => !sec ? "Off" : sec < 60 ? `${sec} s` : sec % 60 ? `${Math.floor(sec / 60)} min ${sec % 60} s` : `${sec / 60} min`;

/* gym selector: chips for known gyms + inline add-new */
function GymPicker({ gym, gyms, onSet }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const commit = () => {
    const n = name.trim();
    if (n) onSet(n);
    setName(""); setAdding(false);
  };
  const list = gym && !gyms.includes(gym) ? [...gyms, gym] : gyms;
  if (adding) {
    return (
      <div style={{ display: "flex", gap: 8 }}>
        <input className="field" value={name} autoFocus placeholder="Gym name" enterKeyHint="done"
          onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && commit()} />
        <button className="btn btn-primary btn-sm" style={{ minHeight: 44 }} onClick={commit} disabled={!name.trim()}>Add</button>
        <button className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={() => { setAdding(false); setName(""); }}>Cancel</button>
      </div>
    );
  }
  return (
    <div className="chips">
      <button onClick={() => onSet(null)} className={cx("chip", !gym && "on")}>None</button>
      {list.map(g => <button key={g} onClick={() => onSet(g)} className={cx("chip", gym === g && "on")}>{g}</button>)}
      <button onClick={() => setAdding(true)} className="chip" style={{ color: C.acc, display: "inline-flex", alignItems: "center", gap: 4 }}><Icon n="plus" s={16} w={2.2} />New gym</button>
    </div>
  );
}

/* rest countdown, docked above the tab bar */
function RestBar({ endAt, total, onExtend, onClear, step, label }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(t); }, []);
  const rem = Math.max(0, Math.ceil((endAt - now) / 1000));
  const finished = rem === 0;
  const pct = total > 0 ? Math.max(0, Math.min(100, (rem / total) * 100)) : 0;
  return (
    <div className="rest-bar" role="timer" aria-live="off">
      <div className={finished ? "over" : ""}>
        <span className="t">{finished ? "Go" : fmtSec(rem)}</span>
        <span className="l">{finished ? "Rest over. Next set." : label ? `Resting after ${label}` : "Resting"}</span>
        {!finished && <button className="btn btn-secondary btn-sm" onClick={onExtend}>+{step} s</button>}
        <button className="btn btn-secondary btn-sm" onClick={onClear}>{finished ? "Dismiss" : "Skip"}</button>
        {!finished && <div className="prog" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

/* rest length sheet: presets + 15 s stepper. value null = use default (per-exercise scope) */
function RestPicker({ title, value, fallback, onPick, onClose }) {
  const [v, setV] = useState(value == null ? (fallback != null ? fallback : 120) : value);
  return (
    <Sheet title={title} onClose={onClose}
      foot={
        <div className="btn-row">
          {fallback != null && <button className="btn btn-secondary" onClick={() => onPick(null)}>Use default ({fmtRest(fallback)})</button>}
          <button className="btn btn-primary" onClick={() => onPick(v)}>Set {fmtRestLong(v).toLowerCase()}</button>
        </div>
      }>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 18, margin: "8px 0 20px" }}>
        <button className="icon-btn" style={{ background: C.surface2, width: 52, height: 52, borderRadius: 26 }} aria-label="15 seconds less" onClick={() => setV(x => Math.max(0, x - 15))}><Icon n="minus" w={2.2} /></button>
        <div className="num-t" style={{ fontSize: 44, fontWeight: 700, minWidth: 130, textAlign: "center", letterSpacing: -1, color: v ? C.ink : C.ink3 }}>{v ? fmtSec(v) : "Off"}</div>
        <button className="icon-btn" style={{ background: C.surface2, width: 52, height: 52, borderRadius: 26 }} aria-label="15 seconds more" onClick={() => setV(x => Math.min(900, x + 15))}><Icon n="plus" w={2.2} /></button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8 }}>
        {REST_PRESETS.map(sec => <button key={sec} onClick={() => setV(sec)} className={cx("chip", sec === v && "on")} style={{ borderRadius: 10, minHeight: 44 }}>{sec ? fmtSec(sec) : "Off"}</button>)}
      </div>
    </Sheet>
  );
}

/* ============================================================
   One exercise inside a live workout
   ============================================================ */
function ExerciseCard({ entry, index, count, onMove, setEntry, rmEntry, prev, ex, onSetDone, ss, pairing, pairingName, onPairStart, onPairWith, onUnlink, restOverride, restDefault, onRestPick }) {
  const blank = blankSet(entry.t);
  const [collapsed, setCollapsed] = useState(false);
  const [plates, setPlates] = useState(false);
  const [menu, setMenu] = useState(false);
  const [setMenuIdx, setSetMenuIdx] = useState(null);
  // a new normal set copies the last NON-drop row (a drop row is not a template for a fresh set)
  const addSet = () => setEntry(entry.eid, e => {
    const tmpl = [...e.sets].reverse().find(s => !s.drop) || e.sets[e.sets.length - 1] || blank;
    const { drop, ...rest } = tmpl;
    return { ...e, sets: [...e.sets, { ...rest, done: false }] };
  });
  // drop row: continues the row above with no rest. Weight left blank so the
  // placeholder (about 20% lighter than the row above) shows; reps blank too.
  const addDrop = () => setEntry(entry.eid, e => {
    if (!e.sets.length) return e;
    const last = e.sets[e.sets.length - 1];
    const row = { ...last, done: false, drop: true, r: "", rpe: "" };
    if ("w" in row) row.w = "";
    return { ...e, sets: [...e.sets, row] };
  });
  const rmSet = i => setEntry(entry.eid, e => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }));
  const toggleDrop = i => setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j === i ? (s.drop ? (({ drop, ...r }) => r)(s) : { ...s, drop: true }) : s) }));
  const upd = (i, k, v) => setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j === i ? { ...s, [k]: v } : s) }));
  /* Ticking a set accepts the suggested values: any empty field takes its
     placeholder (the plan, last time, or the target), so a set done exactly
     as suggested is one tap and actually gets saved. RPE is never guessed. */
  const toggleDone = i => {
    const wasDone = !!entry.sets[i].done;
    const fill = {};
    if (!wasDone) keys.forEach(k => {
      if (k === "rpe" || (entry.sets[i][k] !== "" && entry.sets[i][k] != null)) return;
      const p = String(ph(k, i) || "").replace(/\+$/, "");
      if (p !== "" && !isNaN(Number(p)) && !(k === "add" && Number(p) === 0)) fill[k] = p;
    });
    setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j === i ? { ...s, ...fill, done: !s.done } : s) }));
    if (!wasDone && onSetDone) onSetDone(entry, i);
  };
  const setNote = v => setEntry(entry.eid, e => ({ ...e, note: v }));
  // copy last session's actual values into the inputs (placeholders don't save)
  const useLast = () => {
    if (!prev || !prev.length) return;
    const toStr = v => v == null ? "" : String(v);
    let src = prev;
    if (entry.t === "wr") {
      /* If a later set beat the first (heavier, or same weight for more reps),
         that set leads this time: move it (with any drop rows under it) to the
         top and keep the rest in their logged order. */
      const blocks = [];
      prev.forEach(s => { if (s.drop && blocks.length) blocks[blocks.length - 1].push(s); else blocks.push([s]); });
      const better = (a, b) => (a.w || 0) > (b.w || 0) || ((a.w || 0) === (b.w || 0) && (a.r || 0) > (b.r || 0));
      let hi = 0;
      blocks.forEach((b, j) => { if (better(b[0], blocks[hi][0])) hi = j; });
      if (hi > 0) { const [top] = blocks.splice(hi, 1); blocks.unshift(top); }
      src = blocks.flat();
    }
    setEntry(entry.eid, e => ({ ...e, sets: src.map(s => {
      const d = s.drop ? { drop: true } : {};
      if (e.t === "wr") return { w: toStr(s.w), r: toStr(s.r), rpe: toStr(s.rpe), done: false, ...d };
      if (e.t === "rep") return { r: toStr(s.r), add: toStr(s.add), rpe: toStr(s.rpe), done: false, ...d };
      if (e.t === "time") return { sec: toStr(s.sec), done: false };
      if (e.t === "wd") return { w: toStr(s.w), dist: toStr(s.dist), done: false };
      return { min: toStr(s.min), dist: toStr(s.dist), done: false };
    }) }));
  };

  const cols = { wr: ["kg", "Reps", "RPE"], rep: ["Reps", "+kg", "RPE"], time: ["Seconds"], wd: ["kg", "Metres"], cardio: ["Minutes", "km"] }[entry.t];
  const keys = { wr: ["w", "r", "rpe"], rep: ["r", "add", "rpe"], time: ["sec"], wd: ["w", "dist"], cardio: ["min", "dist"] }[entry.t];
  const grid = { gridTemplateColumns: `44px ${keys.map(k => k === "rpe" ? "0.8fr" : "1fr").join(" ")} 44px` };
  const hint = targetHint(entry.t, entry.target);
  const rp = !hint ? rpHint(ex) : null;
  const prevStr = prev ? prevSummary(entry.t, prev) : null;
  const nDone = entry.sets.filter(s => s.done).length;
  const ph = (k, i) => {
    const row = i != null ? entry.sets[i] : null;
    if (k === "add") return entry.ghostAdd || "0";
    if (k === "rpe" || k === "dist" || k === "min") return "";
    // drop row: weight placeholder = about 80% of the row above (typed value, else its own placeholder)
    if (row && row.drop && k === "w" && i > 0) {
      const above = entry.sets[i - 1];
      const base = above.w !== "" ? Number(above.w) : Number(ph("w", i - 1));
      const d = base > 0 ? roundLoad(base * 0.8) : null;
      return d ? String(d) : "";
    }
    if (row && row.drop && k === "r") return "";
    // per-set plan (double progression / 5/3/1 percents) wins; then program
    // target; then computed ghost (last session / seed).
    const p = entry.plan && entry.plan[i != null ? Math.min(i, entry.plan.length - 1) : 0];
    if (p) {
      if (k === "w" && p.w) return p.w;
      if (k === "r" && p.r) return p.r;
    }
    const t = entry.target;
    if (k === "w") {
      if (entry.ghostW) return entry.ghostW;
      if (t && t.w != null) return String(t.w);
      return "";
    }
    if (k === "r" || k === "sec") {
      if (entry.ghostR) return entry.ghostR;
      if (t && t.repLo != null && t.repLo > 0) return String(t.repLo);
      return "";
    }
    return "";
  };
  // seed for the plate calculator: first typed weight, else placeholder weight
  const plateSeed = () => {
    if (entry.t !== "wr" && entry.t !== "wd") return "";
    const typed = entry.sets.find(s => s.w !== "");
    if (typed) return typed.w;
    return ph("w", 0) || "";
  };

  const canSS = !!onPairStart;
  const iAmPairing = pairing === entry.eid;
  const showPairTarget = pairing && !iAmPairing;
  const restLabel = restOverride != null ? fmtRest(restOverride) : `default, ${fmtRest(restDefault)}`;
  const allDone = nDone === entry.sets.length && entry.sets.length > 0;

  return (
    <section data-move className={cx("ex", ss && "ss", iAmPairing && "ss-pick")} aria-label={entry.name}>
      <div className="ex-head">
        <button style={{ flex: 1, minWidth: 0, textAlign: "left", padding: "2px 0 4px" }} onClick={() => setCollapsed(c => !c)} aria-expanded={!collapsed}>
          <div className="ex-name">{ss && <span className="ex-tag">{ss.letter}{ss.idx}</span>}{entry.name}</div>
          <div className="ex-lines">
            {hint && <div>{hint}{entry.est && (entry.ghostW || (entry.target && entry.target.w != null)) && <> <span className="tag est">Estimated</span></>}</div>}
            {rp && <div>{rp}</div>}
            {entry.progNote && <div className={entry.progKind === "up" ? "up" : entry.progKind === "deload" ? "warn" : ""}>{entry.progNote}</div>}
            {ss && <div>Superset {ss.letter}: rest starts after {ss.letter}{ss.size}</div>}
          </div>
        </button>
        {count > 1 && <MoveBtns index={index} count={count} onMove={onMove} name={entry.name} />}
        <button className="icon-btn" aria-label={`More for ${entry.name}`} onClick={() => setMenu(true)}><Icon n="more" /></button>
      </div>

      {collapsed ? (
        <div className={cx("ex-collapsed", allDone && "all")}>{nDone} of {plural(entry.sets.length, "set")} done</div>
      ) : (
        <>
          {prevStr && (
            <div className="ex-lines ex-last" style={{ padding: "0 16px 4px" }}>
              <span style={{ flex: 1, minWidth: 0 }}>Last time: <span className="dim num-t">{prevStr}</span></span>
              <button className="text-btn" onClick={useLast}>Copy</button>
            </div>
          )}
          <div className="sets">
            <div className="set-grid" style={grid} aria-hidden="true">
              <span className="set-head">Set</span>
              {cols.map(c => <span key={c} className="set-head">{c}</span>)}
              <span className="set-head" />
            </div>
            {entry.sets.map((s, i) => {
              const setNo = entry.sets.slice(0, i + 1).filter(x => !x.drop).length;
              return (
                <div key={i} className={cx("set-grid set-row", s.done && "done")} style={grid}>
                  <button className={cx("set-no", s.drop && "drop")} aria-label={`Set ${s.drop ? "drop" : setNo} options`} onClick={() => setSetMenuIdx(i)}>
                    {s.drop ? "Drop" : setNo}
                  </button>
                  {keys.map(k => (
                    <input key={k} className="cell" inputMode="decimal" enterKeyHint="next" aria-label={`${cols[keys.indexOf(k)]}, set ${setNo}`}
                      value={s[k] ?? ""} placeholder={ph(k, i)}
                      onFocus={ev => ev.target.select()} onChange={ev => upd(i, k, ev.target.value)} />
                  ))}
                  <button className={cx("done-btn", s.done && "on")} aria-pressed={!!s.done} aria-label={s.done ? `Set ${setNo} done. Undo` : `Mark set ${setNo} done`} onClick={() => toggleDone(i)}>
                    <Icon n="check" s={22} w={2.6} />
                  </button>
                </div>
              );
            })}
          </div>
          <div className="set-actions" style={{ paddingLeft: 12 }}>
            <button className="text-btn" style={{ minHeight: 44, padding: "0 8px" }} onClick={addSet}><Icon n="plus" s={18} w={2.2} />Add set</button>
            {(entry.t === "wr" || entry.t === "rep") && entry.sets.length > 0 && (
              <button className="text-btn" style={{ minHeight: 44, padding: "0 8px", color: C.ink2 }} onClick={addDrop}>Add drop set</button>
            )}
          </div>
          <div className="ex-note">
            <input className="field" value={entry.note || ""} placeholder="Add a note" aria-label={`Note for ${entry.name}`} onChange={e => setNote(e.target.value)} />
          </div>
        </>
      )}

      {showPairTarget && <button className="pair-target" onClick={onPairWith}>Superset with {pairingName}</button>}

      {menu && (
        <ActionSheet onClose={() => setMenu(false)} message={entry.name} actions={[
          canSS && { label: ss ? `Add another exercise to superset ${ss.letter}` : "Superset with another exercise", onClick: onPairStart, disabled: count < 2 },
          ss && { label: `Remove from superset ${ss.letter}`, onClick: onUnlink },
          onRestPick && { label: `Rest after this exercise (${restLabel})`, onClick: onRestPick },
          (entry.t === "wr" || entry.t === "wd") && { label: "Plate calculator", onClick: () => setPlates(true) },
          { label: "Remove exercise", danger: true, onClick: () => rmEntry(entry.eid) }
        ]} />
      )}
      {setMenuIdx != null && entry.sets[setMenuIdx] && (
        <ActionSheet onClose={() => setSetMenuIdx(null)} actions={[
          (entry.t === "wr" || entry.t === "rep") && setMenuIdx > 0 && {
            label: entry.sets[setMenuIdx].drop ? "Make it a regular set" : "Make it a drop set (no rest before it)",
            onClick: () => toggleDrop(setMenuIdx)
          },
          { label: "Remove this set", danger: true, onClick: () => rmSet(setMenuIdx) }
        ]} />
      )}
      {plates && <PlateCalc initial={plateSeed()} onClose={() => setPlates(false)} />}
    </section>
  );
}

/* per-side plate breakdown for barbell loading, drawn as a loaded sleeve */
const PLATE_SPEC = {
  25: { c: "#D2433B", h: 120, w: 20 }, 20: { c: "#2F6CCB", h: 120, w: 18 }, 15: { c: "#E2B22E", h: 104, w: 15 },
  10: { c: "#3F9A58", h: 90, w: 13 }, 5: { c: "#E9E9EB", h: 66, w: 10 }, 2.5: { c: "#3A3B40", h: 52, w: 8 }, 1.25: { c: "#B9BAC0", h: 44, w: 7 }
};
function PlateCalc({ initial, onClose }) {
  const [w, setW] = useState(initial || "");
  const [bar, setBar] = useState(20);
  const total = Number(w) || 0;
  const perSide = (total - bar) / 2;
  const PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];
  let rem = perSide; const out = [];
  if (perSide > 0) {
    PLATES.forEach(p => { const n = Math.floor((rem + 1e-9) / p); if (n > 0) { out.push([p, n]); rem = Math.round((rem - n * p) * 100) / 100; } });
  }
  const stack = out.flatMap(([p, n]) => Array.from({ length: n }, () => p));
  return (
    <Sheet title="Plate calculator" onClose={onClose}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-end" }}>
        <div style={{ flex: 1 }}>
          <label className="lbl" htmlFor="plate-total">Total weight (kg)</label>
          <input id="plate-total" className="field num-t" style={{ fontSize: 20, fontWeight: 600 }} inputMode="decimal" value={w} autoFocus onFocus={e => e.target.select()} onChange={e => setW(e.target.value)} />
        </div>
        <div style={{ flex: 1 }}>
          <label className="lbl">Bar</label>
          <Seg value={bar} onChange={setBar} options={[[20, "20 kg"], [15, "15 kg"]]} style={{ minHeight: 44 }} />
        </div>
      </div>
      <div style={{ minHeight: 190, marginTop: 14 }}>
        {total <= 0 ? <div className="muted" style={{ paddingTop: 20 }}>Enter the total weight on the bar.</div>
        : total < bar ? <div className="bad" style={{ paddingTop: 20 }}>That is lighter than the bar.</div>
        : perSide === 0 ? <div style={{ paddingTop: 20, fontWeight: 600 }}>Empty bar.</div>
        : (
          <>
            <div className="bar-viz" aria-hidden="true">
              <div className="shaft" />
              <div className="collar" />
              {stack.map((p, i) => <div key={i} className="plate" style={{ width: PLATE_SPEC[p].w, height: PLATE_SPEC[p].h, background: PLATE_SPEC[p].c }} />)}
            </div>
            <div style={{ fontSize: 15 }}>
              <span className="muted">Each side, {perSide} kg: </span>
              <span style={{ fontWeight: 600 }}>{out.map(([p, n]) => n > 1 ? `${p} × ${n}` : `${p}`).join(", ")}</span>
            </div>
            {rem > 0.01 && <div className="warn small" style={{ marginTop: 8 }}>Standard plates can't make {total} kg. The nearest is {Math.round((total - 2 * rem) * 100) / 100} kg.</div>}
          </>
        )}
      </div>
    </Sheet>
  );
}

function targetHint(t, target) {
  if (!target) return null;
  const reps = target.repLo === target.repHi ? `${target.repLo}` : `${target.repLo}–${target.repHi}`;
  if (t === "wr") return `${target.sets} × ${reps}${target.w != null ? ` at ${target.w} kg` : ""}`;
  if (t === "rep") return `${target.sets} × ${reps}`;
  if (t === "time") return plural(target.sets, "hold");
  return plural(target.sets, "set");
}
function prevSummary(t, sets) {
  const dp = s => s.drop ? "drop " : "";
  if (t === "wr") return sets.map(s => `${dp(s)}${s.w}×${s.r}`).join(", ");
  if (t === "rep") return sets.map(s => `${dp(s)}${s.r}${isLoadedSet(s) ? " " + fmtAdd(s.add) : ""}`).join(", ");
  if (t === "time") return sets.map(s => `${s.sec} s`).join(", ");
  if (t === "wd") return sets.map(s => `${s.w} kg ${s.dist} m`).join(", ");
  return sets.map(s => `${s.min || 0} min${s.dist ? ` ${s.dist} km` : ""}`).join(", ");
}

/* session-level readiness: 1-10, higher = fresher. null = not set */
const FEEL_WORD = n => n == null ? "" : n <= 2 ? "Wrecked" : n <= 4 ? "Flat" : n <= 6 ? "OK" : n <= 8 ? "Good" : "Primed";
function FeelRating({ draft, setDraft }) {
  const v = draft.feel;
  const set = n => setDraft(d => ({ ...d, feel: d.feel === n ? null : n }));
  return (
    <>
      <GroupLabel right={v != null && <span className="dim" style={{ fontWeight: 500 }}>{v}, {FEEL_WORD(v).toLowerCase()}</span>}>How you feel today</GroupLabel>
      <div className="group" style={{ padding: 12 }}>
        <div className="rating" role="radiogroup" aria-label="Readiness from 1 to 10">
          {Array.from({ length: 10 }, (_, i) => i + 1).map(n => (
            <button key={n} role="radio" aria-checked={v === n} className={v === n ? "on" : ""} onClick={() => set(n)}>{n}</button>
          ))}
        </div>
        <div className="rating-scale"><span>Wrecked</span><span>Primed</span></div>
      </div>
    </>
  );
}

/* injuries logged within a draft session */
function DraftInjuries({ draft, setDraft }) {
  const list = draft.injuries || [];
  if (list.length === 0) return null;
  const upd = (idx, fn) => setDraft(d => ({ ...d, injuries: d.injuries.map((x, j) => j === idx ? fn(x) : x) }));
  return (
    <>
      <GroupLabel>Injury check-in</GroupLabel>
      {list.map((inj, i) => (
        <div key={i} className="group">
          <div className="row" style={{ display: "block" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span className="row-title">{inj.name}</span>
              <span className={cx("row-value", inj.pain >= 6 ? "bad" : "")}>Pain {inj.pain} of 10</span>
            </div>
            <input type="range" min="0" max="10" value={inj.pain} aria-label={`${inj.name} pain`} onChange={e => upd(i, x => ({ ...x, pain: Number(e.target.value) }))} style={{ marginTop: 6 }} />
          </div>
          <div className="row">
            <span className="row-main row-title">Swelling</span>
            <Switch on={inj.swelling} label={`${inj.name} swelling`} onChange={v => upd(i, x => ({ ...x, swelling: v }))} />
          </div>
          <div className="row">
            <input className="inline-input" style={{ fontSize: 16 }} value={inj.note} placeholder="Note, e.g. tight on flexion" onChange={e => upd(i, x => ({ ...x, note: e.target.value }))} />
          </div>
        </div>
      ))}
    </>
  );
}

/* ============================================================
   History
   ============================================================ */
const weekStart = dateStr => {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return fmtDate(d);
};
function HistoryList({ sessions, onOpen, scoreOf, onStart }) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const rev = useMemo(() => sessions.slice().sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : 0).filter(s =>
    !ql || s.dayName.toLowerCase().includes(ql) || (s.gym || "").toLowerCase().includes(ql) || s.entries.some(e => e.name.toLowerCase().includes(ql))), [sessions, ql]);
  const thisWk = weekStart(TODAY());
  const lastWkD = new Date(thisWk + "T00:00:00"); lastWkD.setDate(lastWkD.getDate() - 7);
  const lastWk = fmtDate(lastWkD);
  const groups = [];
  rev.forEach(s => {
    const wk = weekStart(s.date);
    const g = groups[groups.length - 1];
    if (g && g.wk === wk) g.items.push(s); else groups.push({ wk, items: [s] });
  });
  const weekName = wk => wk === thisWk ? "This week" : wk === lastWk ? "Last week" : `Week of ${fmtDay(wk, false)}`;
  return (
    <div>
      <NavBar large title="History" />
      {sessions.length === 0 ? (
        <Empty title="No workouts yet" msg="Finished workouts appear here with their sets, score and notes."
          action={<button className="btn btn-primary" onClick={onStart}>Start a workout</button>} />
      ) : (
        <>
          <div className="search" style={{ marginTop: 6 }}>
            <Icon n="search" s={18} />
            <input className="field" type="search" value={q} placeholder="Search workouts, exercises or gyms" aria-label="Search history" onChange={e => setQ(e.target.value)} />
          </div>
          {rev.length === 0 && <Empty msg={`No workouts match "${q.trim()}".`} />}
          {groups.map(g => (
            <div key={g.wk}>
              <GroupLabel right={<span style={{ fontWeight: 500 }}>{plural(g.items.length, "workout")}</span>}>{weekName(g.wk)}</GroupLabel>
              <div className="group">
                {g.items.map(s => {
                  const totalSets = s.entries.reduce((a, e) => a + workSets(e.sets).length, 0);
                  const meta = [fmtDay(s.date), plural(totalSets, "set"), s.durationMin != null ? fmtDur(s.durationMin) : null, s.gym].filter(Boolean).join(", ");
                  return (
                    <button key={s.id} className="row" onClick={() => onOpen(s)}>
                      <div className="row-main">
                        <div className="row-title">{s.dayName}</div>
                        <div className="row-sub">{meta}</div>
                      </div>
                      {scoreOf && <div style={{ textAlign: "right" }}>
                        <div className="num-t" style={{ fontSize: 17, fontWeight: 650 }}>{fmtEws(scoreOf(s).total)}</div>
                        <div className="muted" style={{ fontSize: 12 }}>EWS</div>
                      </div>}
                      <span className="row-chev"><Icon n="chevR" s={18} /></span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function SessionDetail({ session, onBack, onDelete, onEdit, exByKey, scoreOf }) {
  const [confirm, setConfirm] = useState(false);
  const ews = useMemo(() => scoreOf ? scoreOf(session) : null, [scoreOf, session]);
  const exScore = key => ews ? ews.ex.find(x => x.key === key) : null;
  const totalSets = session.entries.reduce((a, e) => a + workSets(e.sets).length, 0);
  const vol = session.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w || 0) * (x.r || 0), 0), 0);
  const gl = {}; let gn = 0;
  session.entries.forEach(e => { if (e.group && !(e.group in gl)) gl[e.group] = gn++; });
  const seen = {};
  const sub = [fmtDay(session.date), session.gym, session.bodyweight != null ? `${session.bodyweight} kg bodyweight` : null,
    session.feel != null ? `felt ${session.feel} of 10` : null].filter(Boolean).join(", ");
  return (
    <div>
      <NavBar title="" onBack={onBack} backLabel="History" right={<button className="nav-action" onClick={() => onEdit(session)}>Edit</button>} />
      <div className="page-head">
        <h2>{session.dayName}</h2>
        <div className="sub">{sub}</div>
      </div>
      <div className="stats">
        <div><div className="v">{session.durationMin != null ? fmtDur(session.durationMin) : "–"}</div><div className="k">Duration</div></div>
        <div><div className="v">{totalSets}</div><div className="k">Working sets</div></div>
        <div><div className="v">{vol > 0 ? Math.round(vol).toLocaleString() : "–"}</div><div className="k">Volume, kg</div></div>
      </div>
      {ews && <EwsCard ews={ews} />}

      {session.entries.map((e, idx) => {
        let tag = null;
        if (e.group && e.group in gl) {
          seen[e.group] = (seen[e.group] || 0) + 1;
          tag = String.fromCharCode(65 + gl[e.group]) + seen[e.group];
        }
        const nDrops = e.sets.filter(x => x.drop).length;
        const repBest = e.t === "rep" && session.bodyweight ? Math.max(0, ...e.sets.map(x => repE1rm(x, session.bodyweight))) : 0;
        const es = exScore(e.key);
        const wrBest = e.sets.length > 0 && e.t === "wr" ? Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r)))) : 0;
        let n = 0;
        return (
          <div key={idx} className={cx("chart", tag && "ex ss")} style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
              <div className="ex-name">{tag && <span className="ex-tag">{tag}</span>}{e.name}</div>
              {es && <div className="num-t" style={{ fontWeight: 650, whiteSpace: "nowrap" }}>{fmtEws(es.base + es.improve + es.pr)}<span className="muted small" style={{ fontWeight: 500 }}> EWS</span></div>}
            </div>
            {es && es.note && <div className={cx("small", es.pr > 0 ? "acc" : es.improve < 0 ? "bad" : "muted")} style={{ marginTop: 3 }}>{es.note}</div>}
            <table className="set-table" style={{ marginTop: 8 }}>
              <tbody>
                {e.sets.map((s, i) => {
                  if (!s.drop) n++;
                  const why = es && es.sets[i] && es.sets[i].why && es.sets[i].why !== "drop" ? es.sets[i].why : "";
                  return (
                    <tr key={i}>
                      <td className="n" style={s.drop ? { color: C.warn, fontSize: 12, fontWeight: 600 } : null}>{s.drop ? "Drop" : n}</td>
                      <td>{setLine(e.t, s)}</td>
                      <td className={cx("q", why === "junk" && "bad")}>{why ? QUALITY_WORD[why] || why : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(wrBest > 0 || repBest > 0 || nDrops > 0) && (
              <div className="muted small" style={{ marginTop: 6 }}>
                {wrBest > 0 && <>Best estimated 1RM {wrBest} kg</>}
                {repBest > 0 && <>Best estimated 1RM {Math.round(repBest)} kg including bodyweight</>}
                {nDrops > 0 && <>{(wrBest > 0 || repBest > 0) ? ". " : ""}{plural(workSets(e.sets).length, "working set")} plus {plural(nDrops, "drop")}</>}
              </div>
            )}
            {e.note && <div className="dim" style={{ fontSize: 15, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.line}` }}>{e.note}</div>}
          </div>
        );
      })}

      {(session.injuries || []).length > 0 && (
        <>
          <GroupLabel>Injury check-in</GroupLabel>
          <div className="group">
            {session.injuries.map((inj, i) => (
              <div key={i} className="row">
                <div className="row-main">
                  <div className="row-title">{inj.name}</div>
                  {inj.note && <div className="row-sub">{inj.note}</div>}
                </div>
                <div className={cx("row-value", inj.pain >= 6 && "bad")}>Pain {inj.pain}{inj.swelling ? ", swelling" : ""}</div>
              </div>
            ))}
          </div>
        </>
      )}
      <SessionMuscleBreakdown session={session} exResolve={exByKey} />
      <button className="btn btn-danger block" style={{ marginTop: 28 }} onClick={() => setConfirm(true)}>Delete workout</button>
      {confirm && <ActionSheet onClose={() => setConfirm(false)} message="Delete this workout? This can't be undone."
        actions={[{ label: "Delete workout", danger: true, onClick: () => onDelete(session.id) }]} />}
    </div>
  );
}
const QUALITY_WORD = { junk: "Junk", light: "Light", easy: "Easy" };

/* EWS summary for a session: total, breakdown, and the formula on request */
function EwsCard({ ews }) {
  const [showFormula, setShowFormula] = useState(false);
  const junk = ews.ex.reduce((a, x) => a + x.junk, 0);
  const sgn = v => (v < 0 ? "−" : v > 0 ? "+" : "") + fmtEws(Math.abs(v));
  return (
    <div className="chart">
      <div className="score">
        <div>
          <div className="big">{fmtEws(ews.total)}</div>
          <div className="muted small" style={{ marginTop: 6 }}>Estimated Workout Score</div>
        </div>
        <button className="text-btn" onClick={() => setShowFormula(f => !f)} aria-expanded={showFormula}>{showFormula ? "Hide formula" : "How it's scored"}</button>
      </div>
      <div className="score-parts">
        <div><div className="v">{fmtEws(ews.base)}</div><div className="k">Sets</div></div>
        <div><div className={cx("v", ews.improve < 0 && "bad")}>{sgn(ews.improve)}</div><div className="k">vs last time</div></div>
        <div><div className={cx("v", ews.pr > 0 && "acc")}>{sgn(ews.pr)}</div><div className="k">PR bonus</div></div>
      </div>
      {junk > 0 && <div className="small bad" style={{ marginTop: 10 }}>{plural(junk, "junk set")} scored at {Math.round(EWS.junkCredit * 100)}%.</div>}
      {showFormula && (
        <div className="formula">
          <p><b>Sets</b>: each working set earns {EWS.perSet} points × muscle weight × quality. Lifting muscles all weigh {MUSCLE_WEIGHT.Chest}, mobility {MUSCLE_WEIGHT["Mobility/Rehab"]}.</p>
          <p>Quality: a full set is 1.0, a drop row {EWS.dropCredit}, a light set (50 to 70% of the top load) {EWS.lightCredit}, a junk set (under 50% of the top load, or under half the target) {EWS.junkCredit}. With RPE logged: {EWS.rpe.hard}+ is 1.0, {EWS.rpe.mid} is {EWS.rpe.midCredit}, lower is {EWS.rpe.easyCredit}.</p>
          <p><b>Cardio</b>: {EWS.cardio.perMin} point per minute × intensity × pace. Intensity is set by the machine: incline walk 0.8, steady bike 1.0, running 1.2, rower 1.25, assault bike 1.5. Pace compares your km per minute to a normal pace on that machine, from {EWS.cardio.paceMin}× to {EWS.cardio.paceMax}×; with no distance logged it counts as normal. 30 minutes of running at 10 km/h is about {Math.round(30 * EWS.cardio.perMin * 1.2)}.</p>
          <p><b>vs last time</b>: each exercise's points × {EWS.lastK} × h(change in best estimated 1RM since your last session of it), floored at {EWS.lastFloorPct}%. Cardio splits this between time and pace.</p>
          <p><b>PR bonus</b>: each exercise's points × {EWS.prK} × h(% over your previous best), once you have {EWS.prMinPrior} earlier sessions of it. Cardio PRs are longest session and fastest pace, half each.</p>
          <p>h(p) = ln(1 + p/{EWS.pctScale}). A 3% PR adds about {Math.round(EWS.prK * Math.log(1 + 3 / EWS.pctScale) * 100)}% of that exercise's points, 10% adds {Math.round(EWS.prK * Math.log(1 + 10 / EWS.pctScale) * 100)}%, 25% adds {Math.round(EWS.prK * Math.log(1 + 25 / EWS.pctScale) * 100)}%. Diminishing, never capped. Cardio time uses a flatter curve, p/{EWS.cardio.durPctScale}, because sessions swing by 30% or more.</p>
          <p style={{ margin: 0 }}>Estimated 1RM uses Epley on the best set. Bodyweight moves add bodyweight to the load, so 8 to 10 reps is +5%, not +25%. Holds use 1 + seconds/120.</p>
        </div>
      )}
    </div>
  );
}
function setLine(t, s) {
  const rpe = s.rpe != null && s.rpe !== "" ? `, RPE ${s.rpe}` : "";
  if (t === "wr") return `${s.w} kg × ${s.r}${rpe}`;
  if (t === "rep") return `${plural(s.r, "rep")}${isLoadedSet(s) ? ` ${fmtAdd(s.add)}` : ""}${rpe}`;
  if (t === "time") return `${s.sec} s`;
  if (t === "wd") return `${s.w} kg, ${s.dist} m`;
  return `${s.min || 0} min${s.dist ? `, ${s.dist} km` : ""}`;
}

/* ============================================================
   Trends: per-exercise drill-down
   ============================================================ */
function useExMap(sessions, allEx) {
  return useMemo(() => {
    const m = new Map(); allEx.forEach(e => m.set(e.key, e));
    sessions.forEach(s => s.entries.forEach(e => { if (!m.has(e.key)) m.set(e.key, { key: e.key, n: e.name, t: e.t, m: LIB_BY_NAME.get(e.name) || null }); }));
    return m;
  }, [allEx, sessions]);
}
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
    if (ex.t === "wr") { metric = Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r)))); label = metric + " kg"; }
    else if (ex.t === "rep" && loadedMode) {
      const bw = bwForSession(sessions, si);
      metric = Math.round(Math.max(...e.sets.map(x => bw ? e1rm(bw + (Number(x.add) || 0), x.r) : 0)));
      label = metric + " kg";
    }
    else if (ex.t === "rep") { metric = Math.max(...e.sets.map(x => x.r || 0)); label = plural(metric, "rep"); }
    else if (ex.t === "time") { metric = Math.max(...e.sets.map(x => x.sec || 0)); label = metric + " s"; }
    else if (ex.t === "wd") { metric = Math.max(...e.sets.map(x => x.w || 0)); label = metric + " kg"; }
    else { metric = Math.round(e.sets.reduce((a, x) => a + (x.dist || 0), 0) * 10) / 10; label = metric + " km"; }
    return { date: s.date, metric, label, sets: e.sets, note: e.note, t: ex.t, loadedMode };
  }).filter(Boolean);
}

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
  const metricName = ex ? (loadedMode || ex.t === "wr" ? "Estimated 1RM" : { rep: "Most reps", time: "Longest hold", wd: "Heaviest load", cardio: "Distance" }[ex.t]) : "";
  const unit = ex ? (loadedMode || ex.t === "wr" || ex.t === "wd" ? "kg" : { rep: "reps", time: "s", cardio: "km" }[ex.t]) : "";
  const first = series[0]?.v, last = series[series.length - 1]?.v;
  const delta = (first && last) ? Math.round((last - first) / first * 1000) / 10 : null;

  return (
    <div>
      <NavBar title="" onBack={onBack} backLabel="Trends" />
      <div className="page-head">
        <h2>{ex ? ex.n : exKey}</h2>
        <div className="sub">{ex ? [ex.m, T_LABEL[ex.t]].filter(Boolean).join(", ") : ""}</div>
      </div>
      {series.length > 0 && (
        <div className="stats">
          <div><div className="v">{history.length}</div><div className="k">Workouts</div></div>
          <div><div className="v">{Math.max(...series.map(s => s.v))}</div><div className="k">Best, {unit}</div></div>
          <div><div className={cx("v", delta > 0 && "good", delta < 0 && "bad")}>{delta != null ? (delta > 0 ? "+" : "") + delta + "%" : "–"}</div><div className="k">Since first</div></div>
        </div>
      )}
      <Line title={metricName} data={series} unit={unit} marks={series.map(d => d.pr)} markLabel="PR" />
      <GroupLabel>Every workout</GroupLabel>
      {history.length === 0 ? <div className="group"><div className="row muted">No sets logged yet.</div></div> : (
        <div className="group">
          {withPr.slice().reverse().map((h, i) => (
            <div key={i} className="row" style={{ alignItems: "flex-start" }}>
              <div className="row-main">
                <div className="row-title">{fmtDay(h.date)} {h.pr && <span className="tag pr">PR</span>}</div>
                <div className="row-sub num-t">{prevSummary(h.t, h.sets)}</div>
                {h.note && <div className="row-sub dim" style={{ marginTop: 4 }}>{h.note}</div>}
              </div>
              <div className="row-value" style={{ fontWeight: 600, color: C.ink }}>{h.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ExerciseList({ sessions, exMap, onPick }) {
  const [q, setQ] = useState("");
  const logged = useMemo(() => {
    const counts = new Map();
    sessions.forEach(s => s.entries.forEach(e => {
      const c = counts.get(e.key) || { key: e.key, sessions: 0, last: "" };
      c.sessions += 1; if (s.date > c.last) c.last = s.date;
      counts.set(e.key, c);
    }));
    return [...counts.values()]
      .map(c => ({ ...c, ex: exMap.get(c.key) }))
      .filter(c => c.ex)
      .sort((a, b) => a.ex.n.localeCompare(b.ex.n));
  }, [sessions, exMap]);
  if (logged.length === 0) return <Empty msg="Exercises you log appear here with their progress." />;
  const ql = q.trim().toLowerCase();
  const shown = logged.filter(c => !ql || c.ex.n.toLowerCase().includes(ql));
  return (
    <>
      <div className="search" style={{ marginTop: 12 }}>
        <Icon n="search" s={18} />
        <input className="field" type="search" value={q} placeholder="Search exercises" aria-label="Search exercises" onChange={e => setQ(e.target.value)} />
      </div>
      <div className="group" style={{ marginTop: 12 }}>
        {shown.map(c => (
          <button key={c.key} className="row" onClick={() => onPick(c.key)}>
            <div className="row-main">
              <div className="row-title">{c.ex.n}</div>
              <div className="row-sub">{plural(c.sessions, "workout")}, last {fmtDay(c.last, false)}</div>
            </div>
            <span className="row-chev"><Icon n="chevR" s={18} /></span>
          </button>
        ))}
        {shown.length === 0 && <div className="row muted">No logged exercise matches "{q.trim()}".</div>}
      </div>
    </>
  );
}

/* ============================================================
   Trends: overview
   ============================================================ */
const WEEK_BARS = 12; // sessions-per-week chart shows this many weeks ending this week
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
    return { best: Math.max(...vals), avg: Math.round(recent.reduce((a, b) => a + b, 0) / recent.length) };
  }, [ewsSeries]);
  const weekCounts = useMemo(() => {
    const m = {}; sessions.forEach(s => { const w = isoWeek(s.date); m[w] = (m[w] || 0) + 1; });
    return Object.entries(m).sort();
  }, [sessions]);
  /* fixed window of the last WEEK_BARS weeks, zero-filled, so missed weeks show as gaps */
  const weekBars = useMemo(() => {
    const m = {}; weekCounts.forEach(([w, v]) => { m[w] = v; });
    const out = [];
    const today = new Date(TODAY() + "T00:00:00");
    for (let i = WEEK_BARS - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - 7 * i);
      const wk = isoWeek(fmtDate(d));
      out.push([wk, m[wk] || 0, weekStart(fmtDate(d))]);
    }
    return out;
  }, [weekCounts]);
  const byDate = useMemo(() => sessions.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0), [sessions]);
  const volSeries = useMemo(() => byDate.map(s => ({ date: s.date, v: Math.round(s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w || 0) * (x.r || 0), 0), 0)) })).filter(d => d.v > 0), [byDate]);
  const bwSeries = useMemo(() => byDate.filter(s => s.bodyweight != null).map(s => ({ date: s.date, v: s.bodyweight })), [byDate]);
  const feelSeries = useMemo(() => byDate.filter(s => s.feel != null).map(s => ({ date: s.date, v: s.feel })), [byDate]);
  return (
    <div>
      <div className="stats">
        <div><div className="v">{sessions.length}</div><div className="k">Workouts</div></div>
        <div><div className="v">{weekCounts.length}</div><div className="k">Weeks trained</div></div>
        <div><div className="v">{weekCounts.length ? (sessions.length / weekCounts.length).toFixed(1) : "0"}</div><div className="k">Per week</div></div>
      </div>
      <Line title="Estimated Workout Score" sub={ewsStats ? `Best ${ewsStats.best}, average of last 6 ${ewsStats.avg}` : null}
        data={ewsSeries} unit="" marks={ewsSeries.map(d => d.pr)} markLabel="New best" />
      <Bars title="Workouts per week" sub={`Last ${WEEK_BARS} weeks`} data={weekBars} />
      <Line title="Volume" sub="Weight × reps per workout" data={volSeries} unit="kg" />
      {bwSeries.length > 0 && <Line title="Bodyweight" data={bwSeries} unit="kg" />}
      {feelSeries.length > 0 && <Line title="How you felt" sub="1 is wrecked, 10 is primed" data={feelSeries} unit="" fixedMin={1} fixedMax={10} />}
    </div>
  );
}

/* per-muscle weekly-sets trend + the workouts that hit that muscle */
function MuscleDetail({ sessions, muscle, exResolve, onBack, onPickExercise }) {
  const weekSeries = useMemo(() => {
    const byWeek = {};
    sessions.forEach(s => {
      let n = 0;
      s.entries.forEach(e => { if (muscleOfEntry(e, exResolve) === muscle) n += workSets(e.sets).length; });
      if (n > 0) { const w = weekStart(s.date); byWeek[w] = (byWeek[w] || 0) + n; }
    });
    return Object.entries(byWeek).sort().map(([wk, v]) => ({ date: wk, v }));
  }, [sessions, muscle, exResolve]);
  const hitSessions = useMemo(() => {
    return sessions.map(s => {
      const items = s.entries
        .filter(e => muscleOfEntry(e, exResolve) === muscle && e.sets && e.sets.length)
        .map(e => ({ key: e.key, name: e.name, t: e.t, sets: e.sets }));
      if (!items.length) return null;
      const total = items.reduce((a, e) => a + workSets(e.sets).length, 0);
      return { id: s.id, date: s.date, dayName: s.dayName, total, items };
    }).filter(Boolean).sort((a, b) => a.date < b.date ? 1 : -1);
  }, [sessions, muscle, exResolve]);
  const lm = LANDMARKS[muscle];
  return (
    <div>
      <NavBar title="" onBack={onBack} backLabel="Trends" />
      <div className="page-head">
        <h2>{muscle}</h2>
        {lm && <div className="sub">Weekly sets: minimum effective {lm[1]}, best results up to {lm[2]}, recoverable up to {lm[3]}</div>}
      </div>
      <Line title="Sets per week" data={weekSeries} unit="sets" bands={lm ? { lo: lm[1], hi: lm[2] } : null} />
      <GroupLabel>Workouts</GroupLabel>
      {hitSessions.length === 0 ? <div className="group"><div className="row muted">No sets for this muscle yet.</div></div> :
        hitSessions.map(s => (
          <div key={s.id} className="group" style={{ marginTop: 10 }}>
            <div className="row">
              <div className="row-main">
                <div className="row-title">{s.dayName}</div>
                <div className="row-sub">{fmtDay(s.date)}</div>
              </div>
              <div className="row-value">{plural(s.total, "set")}</div>
            </div>
            {s.items.map((e, j) => (
              <button key={j} className="row" onClick={() => onPickExercise && onPickExercise(e.key)}>
                <div className="row-main">
                  <div className="row-title" style={{ fontSize: 15 }}>{e.name}</div>
                  <div className="row-sub num-t">{prevSummary(e.t, e.sets)}</div>
                </div>
                <span className="row-chev"><Icon n="chevR" s={18} /></span>
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}

function MuscleList({ sessions, exResolve, onPick }) {
  const rows = useMemo(() => {
    const counts = setsByMuscle(sessions, exResolve);
    return MUSCLES.filter(m => LANDMARKS[m] != null).map(m => ({ m, sets: counts[m] || 0 })).filter(r => r.sets > 0);
  }, [sessions, exResolve]);
  if (rows.length === 0) return null;
  return (
    <>
      <GroupLabel>History by muscle</GroupLabel>
      <div className="group">
        {rows.map(r => (
          <button key={r.m} className="row" onClick={() => onPick(r.m)}>
            <span className="row-main row-title">{r.m}</span>
            <span className="row-value">{plural(r.sets, "set")} total</span>
            <span className="row-chev"><Icon n="chevR" s={18} /></span>
          </button>
        ))}
      </div>
    </>
  );
}

function Trends({ sessions, allEx, exResolve, scoreOf }) {
  const [view, setView] = useState("overview");
  const [exKey, setExKey] = useState(null);
  const [muscle, setMuscle] = useState(null);
  const exMap = useExMap(sessions, allEx);
  const open = fn => v => { fn(v); window.scrollTo(0, 0); };

  if (exKey) return <ExerciseDetail sessions={sessions} exMap={exMap} exKey={exKey} onBack={() => setExKey(null)} />;
  if (muscle) return (
    <MuscleDetail sessions={sessions} muscle={muscle} exResolve={exResolve}
      onBack={() => setMuscle(null)}
      onPickExercise={k => { setMuscle(null); open(setExKey)(k); }} />
  );
  return (
    <div>
      <NavBar large title="Trends" />
      {sessions.length === 0 ? <Empty title="Nothing to chart yet" msg="Log a few workouts and your scores, volume and lifts show up here." /> : (
        <>
          <Seg value={view} onChange={setView} options={[["overview", "Overview"], ["exercises", "Exercises"], ["muscles", "Muscles"]]} style={{ marginTop: 6 }} />
          {view === "overview" && <TrendsOverview sessions={sessions} scoreOf={scoreOf} />}
          {view === "exercises" && <ExerciseList sessions={sessions} exMap={exMap} onPick={open(setExKey)} />}
          {view === "muscles" && <>
            <VolumeTab sessions={sessions} exResolve={exResolve} />
            <MuscleList sessions={sessions} exResolve={exResolve} onPick={open(setMuscle)} />
          </>}
        </>
      )}
    </div>
  );
}

/* ============================================================
   Muscle volume: sets per muscle vs RP MEV/MAV/MRV landmarks
   ============================================================ */
const LIB_BY_NAME = (() => { const m = new Map(); LIB.forEach(e => m.set(e.n, e.m)); return m; })();
function muscleOfEntry(e, exResolve) {
  if (exResolve) { const ex = exResolve(e.key); if (ex && ex.m) return ex.m; }
  return LIB_BY_NAME.get(e.name) || null;
}
// working sets per muscle; a top set plus its drops = 1 (RP convention)
function setsByMuscle(sessionList, exResolve) {
  const out = {};
  sessionList.forEach(s => s.entries.forEach(e => {
    const mus = muscleOfEntry(e, exResolve);
    if (!mus) return;
    out[mus] = (out[mus] || 0) + workSets(e.sets).length;
  }));
  return out;
}
const ZONE_COLOR = { below: C.ink3, optimal: C.good, high: C.warn, over: C.bad };
const ZONE_LABEL = { below: "Below minimum", optimal: "Productive", high: "High", over: "Over recoverable" };

/* bar per muscle. weekly=true judges against landmarks; weekly=false (one
   session) shows raw sets only, since one session can't be judged weekly. */
function MuscleVolumeBars({ counts, weekly, title, foot }) {
  const rows = MUSCLES
    .filter(m => LANDMARKS[m] != null)
    .map(m => ({ m, sets: counts[m] || 0 }))
    .filter(r => r.sets > 0 || weekly)
    .map(r => ({ ...r, band: volumeBand(r.m, r.sets) }));
  if (rows.length === 0) return null;
  const scaleMax = weekly
    ? Math.max(...rows.map(r => Math.max(r.band ? r.band.mrv : r.sets, r.sets)), 1)
    : Math.max(...rows.map(r => r.sets), 1);
  return (
    <>
      {title && <GroupLabel>{title}</GroupLabel>}
      <div className="group">
        {rows.map(r => {
          const b = r.band;
          const barPct = Math.min(100, (r.sets / scaleMax) * 100);
          const col = weekly && b ? ZONE_COLOR[b.zone] : C.ink2;
          return (
            <div key={r.m} className="vol-row">
              <div className="vol-top">
                <span style={{ fontSize: 15, fontWeight: 500 }}>{r.m}</span>
                <span className="num-t" style={{ fontSize: 14 }}>
                  <b>{r.sets}</b>{weekly && b ? <span style={{ color: col }}>  {ZONE_LABEL[b.zone]}</span> : <span className="muted"> {r.sets === 1 ? "set" : "sets"}</span>}
                </span>
              </div>
              <div className="vol-track">
                <div className="vol-fill" style={{ width: `${barPct}%`, background: col }} />
                {weekly && b && <div className="vol-tick" style={{ left: `${Math.min(100, (b.mev / scaleMax) * 100)}%` }} title="Minimum effective" />}
                {weekly && b && <div className="vol-tick" style={{ left: `${Math.min(100, (b.mav / scaleMax) * 100)}%` }} title="Maximum adaptive" />}
              </div>
            </div>
          );
        })}
      </div>
      {foot && <div className="group-foot">{foot}</div>}
    </>
  );
}
function SessionMuscleBreakdown({ session, exResolve }) {
  const counts = useMemo(() => setsByMuscle([session], exResolve), [session, exResolve]);
  if (Object.keys(counts).length === 0) return null;
  return <MuscleVolumeBars counts={counts} weekly={false} title="Sets by muscle" />;
}

/* current week + trailing-4-week rollups */
function VolumeTab({ sessions, exResolve }) {
  const today = TODAY();
  const thisWeek = isoWeek(today);
  const weekSessions = useMemo(() => sessions.filter(s => isoWeek(s.date) === thisWeek), [sessions, thisWeek]);
  // nothing logged yet this week: open on the 4-week view so the screen isn't all zeros
  const [scope, setScope] = useState(() => weekSessions.length ? "week" : "month");
  const monthSessions = useMemo(() => {
    const cutoff = new Date(today + "T00:00:00");
    cutoff.setDate(cutoff.getDate() - 27);
    return sessions.filter(s => new Date(s.date + "T00:00:00") >= cutoff);
  }, [sessions, today]);
  const list = scope === "week" ? weekSessions : monthSessions;
  const counts = useMemo(() => setsByMuscle(list, exResolve), [list, exResolve]);
  const judgedCounts = useMemo(() => {
    if (scope === "week") return counts;
    const out = {}; Object.entries(counts).forEach(([m, v]) => { out[m] = Math.round(v / 4); });
    return out;
  }, [counts, scope]);
  return (
    <div>
      <Seg value={scope} onChange={setScope} options={[["week", "This week"], ["month", "4-week average"]]} style={{ marginTop: 12 }} />
      <MuscleVolumeBars counts={judgedCounts} weekly={true}
        title={scope === "week" ? `Sets this week, ${plural(weekSessions.length, "workout")}` : `Average sets per week, ${plural(monthSessions.length, "workout")} in 28 days`}
        foot="Marks show the minimum effective volume and the top of the productive range. Grey is below the minimum, green is productive, amber is high, red is past what you can recover from." />
    </div>
  );
}

/* ============================================================
   Program tab: the plan, plus the less-used tools behind it
   ============================================================ */
function ProgramTab(props) {
  const { program, setProgram, onAdvanceWeek, onExitMeso, restPrefs, injuries, custom } = props;
  const [sub, setSub] = useState(null); // null | {k:"day", id} | {k:"build"|"injuries"|"rest"|"exercises"|"backup"}
  const [confirmExit, setConfirmExit] = useState(false);
  const go = s => { setSub(s); window.scrollTo(0, 0); };
  const back = () => go(null);
  const st = mesoStatus(program);

  if (sub && sub.k === "day") {
    const day = program.days.find(d => d.id === sub.id);
    if (day) return <DayEditor {...props} day={day} onBack={back} />;
  }
  if (sub && sub.k === "build") return <GoalsTab onInstall={p => { props.onInstall(p); setSub(null); }} current={program} onBack={back} />;
  if (sub && sub.k === "injuries") return <InjuryTab injuries={injuries} saveInjuries={props.saveInjuries} sessions={props.sessions} onBack={back} />;
  if (sub && sub.k === "rest") return <RestSettings prefs={restPrefs} save={props.saveRestPrefs} onBack={back} />;
  if (sub && sub.k === "exercises") return <CustomLibrary program={program} custom={custom} removeCustom={props.removeCustom} updateCustom={props.updateCustom} onBack={back} />;
  if (sub && sub.k === "backup") return <BackupPage {...props} onBack={back} />;

  const addDay = () => {
    const id = uid();
    setProgram({ ...program, days: [...program.days, { id, name: `Day ${program.days.length + 1}`, items: [] }] });
    go({ k: "day", id });
  };
  const activeInj = injuries.filter(i => !i.closed).length;
  const finished = st && st.week >= st.total;

  return (
    <div>
      <NavBar large title="Program" />
      {st && (
        <>
          <GroupLabel>Current mesocycle</GroupLabel>
          <div className="group">
            <div className="row">
              <div className="row-main">
                <div className={cx("row-title", st.isDeload && "warn")}>{st.label}</div>
                <div className="row-sub">{st.splitName}, {st.goalLabel.toLowerCase()}</div>
              </div>
              {st.rir && <div className="row-value">{st.rir.lo}–{st.rir.hi} RIR</div>}
            </div>
            {(st.cardio || st.nutrition) && (
              <div className="row" style={{ display: "block" }}>
                {st.cardio && <div className="row-sub" style={{ marginTop: 0 }}>Cardio: {st.cardio.note}</div>}
                {st.nutrition && <div className="row-sub">Calories {st.nutrition.cal}. Protein {st.nutrition.protein}.</div>}
              </div>
            )}
            {st.type === "531" && st.tms && (
              <div className="row">
                <div className="row-main">
                  <div className="row-title">Training maxes</div>
                  <div className="row-sub">{[["press", "Press"], ["bench", "Bench"], ["squat", "Squat"], ["dead", "Deadlift"]].filter(([k]) => st.tms[k]).map(([k, l]) => `${l} ${st.tms[k]} kg`).join(", ") || "None set"}</div>
                </div>
              </div>
            )}
            <button className="row" onClick={onAdvanceWeek} disabled={finished}>
              <span className={cx("row-main row-title", finished ? "muted" : "row-action")}>
                {finished ? "Mesocycle complete" : st.week + 1 > st.accumWeeks ? "Start deload week" : `Move to week ${st.week + 1}`}
              </span>
            </button>
            <button className="row" onClick={() => setConfirmExit(true)}>
              <span className="row-main row-title dim">End mesocycle</span>
            </button>
          </div>
          <div className="group-foot">
            {st.type === "531"
              ? "Each week moves the percentage wave: 5s, 3s, 5/3/1, then deload. After the deload, build a new cycle with maxes up 2.5 kg for upper lifts and 5 kg for lower."
              : "Moving to the next week adds sets and lowers the reps-in-reserve target. Weights keep progressing workout to workout."}
          </div>
        </>
      )}

      <GroupLabel>Workout days</GroupLabel>
      <div className="group">
        {program.days.map(d => (
          <button key={d.id} className="row" onClick={() => go({ k: "day", id: d.id })}>
            <div className="row-main">
              <div className="row-title">{d.name}</div>
              <div className="row-sub">{d.items.length ? d.items.slice(0, 3).map(it => (props.exByKey(it.key) || {}).n || "Missing exercise").join(", ") + (d.items.length > 3 ? `, ${d.items.length - 3} more` : "") : "No exercises yet"}</div>
            </div>
            <span className="row-chev"><Icon n="chevR" s={18} /></span>
          </button>
        ))}
        <button className="row" onClick={addDay}>
          <span className="row-action" style={{ display: "flex", alignItems: "center", gap: 8 }}><Icon n="plus" s={20} w={2.2} />Add workout day</span>
        </button>
      </div>

      <GroupLabel>Training</GroupLabel>
      <div className="group">
        <div className="row">
          <span className="row-main row-title">Workouts per week</span>
          <Stepper value={program.target || 0} min={1} max={14} onChange={v => setProgram({ ...program, target: v })} />
        </div>
        <div className="row">
          <div className="row-main">
            <div className="row-title">Back-off sets</div>
            <div className="row-sub">After the top set, suggest 10% lighter on heavy lifts and 5% on other compounds</div>
          </div>
          <Switch label="Back-off sets" on={program.workDown !== false} onChange={v => setProgram({ ...program, workDown: v })} />
        </div>
      </div>

      <GroupLabel>Tools</GroupLabel>
      <div className="group">
        {[
          ["build", "Build a new program", "Hypertrophy mesocycle or 5/3/1", null],
          ["injuries", "Injuries", null, activeInj ? `${activeInj} active` : "None"],
          ["rest", "Rest timer and alerts", null, fmtRest(restPrefs.len)],
          ["exercises", "Your exercises", null, String(custom.length)],
          ["backup", "Backup and reset", null, null]
        ].map(([k, title, subT, val]) => (
          <button key={k} className="row" onClick={() => go({ k })}>
            <div className="row-main">
              <div className="row-title">{title}</div>
              {subT && <div className="row-sub">{subT}</div>}
            </div>
            {val && <span className="row-value">{val}</span>}
            <span className="row-chev"><Icon n="chevR" s={18} /></span>
          </button>
        ))}
      </div>

      {confirmExit && <ActionSheet onClose={() => setConfirmExit(false)}
        message="End the mesocycle? Your days and exercises stay as an editable program. Logged workouts are kept."
        actions={[{ label: "End mesocycle", danger: true, onClick: onExitMeso }]} />}
    </div>
  );
}

function DayEditor({ program, setProgram, exByKey, openPicker, day, onBack }) {
  const [menu, setMenu] = useState(false);
  const [itemMenu, setItemMenu] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const dId = day.id;
  const idx = program.days.findIndex(d => d.id === dId);
  const setDays = fn => setProgram({ ...program, days: fn(program.days) });
  const rename = name => setDays(ds => ds.map(d => d.id === dId ? { ...d, name } : d));
  const moveDay = dir => setDays(ds => { const j = idx + dir; if (j < 0 || j >= ds.length) return ds; const a = [...ds]; [a[idx], a[j]] = [a[j], a[idx]]; return a; });
  const dupDay = () => setDays(ds => ds.flatMap(d => d.id === dId ? [d, { id: uid(), name: d.name + " copy", items: d.items.map(it => ({ ...it, target: it.target ? { ...it.target } : null })) }] : [d]));
  const rmDay = () => { setDays(ds => ds.filter(d => d.id !== dId)); onBack(); };
  const addItem = exKey => setDays(ds => ds.map(d => d.id === dId ? { ...d, items: [...d.items, { key: exKey, target: T(3, 8, 12, null) }] } : d));
  const swapItem = (i, exKey) => setDays(ds => ds.map(d => d.id === dId ? { ...d, items: d.items.map((it, j) => j === i ? { ...it, key: exKey, est: false } : it) } : d));
  const rmItem = i => setDays(ds => ds.map(d => d.id === dId ? { ...d, items: d.items.filter((_, j) => j !== i) } : d));
  const moveItem = (from, to) => setDays(ds => ds.map(d => {
    if (d.id !== dId) return d; const a = [...d.items]; if (to < 0 || to >= a.length) return d;
    const [x] = a.splice(from, 1); a.splice(to, 0, x); return { ...d, items: a };
  }));
  const setTarget = (i, k, v) => setDays(ds => ds.map(d => d.id === dId ? { ...d, items: d.items.map((it, j) => j === i ? { ...it, target: { ...(it.target || T(3, 8, 12, null)), [k]: v === "" ? (k === "w" ? null : 0) : Number(v) } } : it) } : d));

  return (
    <div>
      <NavBar title="" onBack={onBack} backLabel="Program" right={<button className="icon-btn" aria-label="Day options" onClick={() => setMenu(true)} style={{ color: C.acc }}><Icon n="more" /></button>} />
      <input className="session-title" aria-label="Day name" value={day.name} onChange={e => rename(e.target.value)} style={{ marginTop: 4 }} />
      <div className="session-meta"><span>{plural(day.items.length, "exercise")}</span></div>

      {day.items.length === 0 && <Empty msg="Add the exercises for this day. Targets you set here become the starting point when you log." />}
      {day.items.map((it, i) => {
        const ex = exByKey(it.key);
        const nth = day.items.slice(0, i).filter(x => x.key === it.key).length;
        const wr = ex && (ex.t === "wr" || ex.t === "wd");
        return (
          <div key={it.key + "#" + nth} data-move className="ex">
            <div className="ex-head" style={{ paddingBottom: 8 }}>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                <div className="ex-name">{ex ? ex.n : "Missing exercise"}</div>
                <div className="ex-lines">{ex ? [ex.m, ex.e, rpHint(ex)].filter(Boolean).join(", ") : "Swap in a replacement"}</div>
              </div>
              {day.items.length > 1 && <MoveBtns index={i} count={day.items.length} onMove={moveItem} name={ex ? ex.n : "exercise"} />}
              <button className="icon-btn" aria-label={`Options for ${ex ? ex.n : "exercise"}`} onClick={() => setItemMenu(i)}><Icon n="more" /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: wr ? "repeat(4,1fr)" : "repeat(3,1fr)", gap: 8, padding: "0 16px 16px" }}>
              <TgtField label="Sets" val={it.target?.sets} onChange={v => setTarget(i, "sets", v)} />
              <TgtField label="Rep min" val={it.target?.repLo} onChange={v => setTarget(i, "repLo", v)} />
              <TgtField label="Rep max" val={it.target?.repHi} onChange={v => setTarget(i, "repHi", v)} />
              {wr && <TgtField label="kg" val={it.target?.w ?? ""} onChange={v => setTarget(i, "w", v)} />}
            </div>
          </div>
        );
      })}
      <button className="btn btn-secondary block" style={{ marginTop: 14 }} onClick={() => openPicker(k => addItem(k))}><Icon n="plus" s={20} w={2.2} />Add exercise</button>

      {menu && <ActionSheet onClose={() => setMenu(false)} message={day.name} actions={[
        idx > 0 && { label: "Move earlier in the week", onClick: () => moveDay(-1) },
        idx < program.days.length - 1 && { label: "Move later in the week", onClick: () => moveDay(1) },
        { label: "Duplicate day", onClick: dupDay },
        { label: "Delete day", danger: true, onClick: () => setConfirmDel(true) }
      ]} />}
      {confirmDel && <ActionSheet onClose={() => setConfirmDel(false)} message={`Delete ${day.name}? Logged workouts are kept.`}
        actions={[{ label: "Delete day", danger: true, onClick: rmDay }]} />}
      {itemMenu != null && day.items[itemMenu] && (() => {
        const it = day.items[itemMenu]; const ex = exByKey(it.key);
        return <ActionSheet onClose={() => setItemMenu(null)} message={ex ? ex.n : "Missing exercise"} actions={[
          { label: "Swap for another exercise", onClick: () => { const i = itemMenu; openPicker(k => swapItem(i, k), ex ? ex.m : ""); } },
          { label: "Remove from day", danger: true, onClick: () => rmItem(itemMenu) }
        ]} />;
      })()}
    </div>
  );
}
function TgtField({ label, val, onChange }) {
  return (
    <label style={{ display: "block" }}>
      <span className="lbl" style={{ textAlign: "center", marginBottom: 4, whiteSpace: "nowrap" }}>{label}</span>
      <input className="cell" inputMode="decimal" value={val ?? ""} placeholder="–" onFocus={e => e.target.select()} onChange={e => onChange(e.target.value)} />
    </label>
  );
}

function BackupPage({ exportJson, importJson, onReset, onBack }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmImport, setConfirmImport] = useState(null);
  const fileRef = useRef(null);
  return (
    <div>
      <NavBar title="Backup" onBack={onBack} backLabel="Program" />
      <div className="group" style={{ marginTop: 12 }}>
        <button className="row" onClick={exportJson}>
          <div className="row-main"><div className="row-title row-action">Export backup</div><div className="row-sub">Downloads a file with your program, workouts, exercises and injuries</div></div>
        </button>
        <button className="row" onClick={() => fileRef.current && fileRef.current.click()}>
          <div className="row-main"><div className="row-title row-action">Restore from backup</div><div className="row-sub">Replaces what's on this device with the file's contents</div></div>
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: "none" }}
          onChange={e => { const f = e.target.files[0]; e.target.value = ""; if (f) setConfirmImport(f); }} />
      </div>
      <div className="group-foot">Your data lives only in this browser on this device. Export a backup regularly.</div>
      <div className="group" style={{ marginTop: 24 }}>
        <button className="row" onClick={() => setConfirmReset(true)}>
          <div className="row-main"><div className="row-title bad">Reset program</div><div className="row-sub">Replaces your program with the built-in push, pull, legs split. Logged workouts stay.</div></div>
        </button>
      </div>
      {confirmImport && <ActionSheet onClose={() => setConfirmImport(null)} message={`Restore from ${confirmImport.name}? Data on this device will be replaced.`}
        actions={[{ label: "Restore", danger: true, onClick: () => importJson(confirmImport) }]} />}
      {confirmReset && <ActionSheet onClose={() => setConfirmReset(false)} message="Reset your program to the built-in split? Logged workouts stay."
        actions={[{ label: "Reset program", danger: true, onClick: onReset }]} />}
    </div>
  );
}

/* ============================================================
   Injuries
   ============================================================ */
function InjuryTab({ injuries, saveInjuries, sessions, onBack }) {
  const [name, setName] = useState("");
  const [del, setDel] = useState(null);
  const add = () => { const n = name.trim(); if (!n) return; saveInjuries([...injuries, { id: uid(), name: n, created: TODAY(), closed: false }]); setName(""); };
  const close = id => saveInjuries(injuries.map(i => i.id === id ? { ...i, closed: true, closedOn: TODAY() } : i));
  const reopen = id => saveInjuries(injuries.map(i => i.id === id ? { ...i, closed: false, closedOn: undefined } : i));
  const remove = id => saveInjuries(injuries.filter(i => i.id !== id));
  const logsFor = nm => {
    const out = [];
    sessions.forEach(s => (s.injuries || []).forEach(inj => { if (inj.name === nm) out.push({ date: s.date, ...inj }); }));
    return out.sort((a, b) => a.date < b.date ? -1 : 1);
  };
  const active = injuries.filter(i => !i.closed);
  const closed = injuries.filter(i => i.closed);
  return (
    <div>
      <NavBar title="Injuries" onBack={onBack} backLabel="Program" />
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input className="field" value={name} placeholder="Track an injury, e.g. left knee" enterKeyHint="done" onChange={e => setName(e.target.value)} onKeyDown={e => e.key === "Enter" && add()} />
        <button className="btn btn-primary btn-sm" style={{ minHeight: 44 }} disabled={!name.trim()} onClick={add}>Add</button>
      </div>
      <div className="group-foot">While an injury is active, each workout asks for pain, swelling and a note. Mark it healed when it's gone; its history stays.</div>

      {active.map(inj => {
        const logs = logsFor(inj.name);
        const series = logs.map(l => ({ date: l.date, v: l.pain || 0 }));
        return (
          <div key={inj.id}>
            <GroupLabel>{inj.name}</GroupLabel>
            <div className="group">
              <div className="row">
                <div className="row-main">
                  <div className="row-sub" style={{ marginTop: 0 }}>Active since {fmtDay(inj.created, false)}, {plural(logs.length, "check-in")}</div>
                </div>
                <button className="btn btn-tinted btn-sm" onClick={() => close(inj.id)}>Mark healed</button>
              </div>
              {series.length > 0 && <div className="row" style={{ display: "block" }}><Line title="Pain" data={series} unit="of 10" embedded fixedMin={0} fixedMax={10} /></div>}
              {logs.slice().reverse().slice(0, 8).map((l, i) => (
                <div key={i} className="row">
                  <div className="row-main">
                    <div className="row-title" style={{ fontSize: 15 }}>{fmtDay(l.date)}</div>
                    {l.note && <div className="row-sub">{l.note}</div>}
                  </div>
                  <div className={cx("row-value", l.pain >= 6 && "bad")}>Pain {l.pain}{l.swelling ? ", swelling" : ""}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {active.length === 0 && closed.length === 0 && <Empty msg="No injuries tracked." />}
      {closed.length > 0 && (
        <>
          <GroupLabel>Healed</GroupLabel>
          <div className="group">
            {closed.map(inj => (
              <div key={inj.id} className="row">
                <div className="row-main">
                  <div className="row-title">{inj.name}</div>
                  <div className="row-sub">Healed {fmtDay(inj.closedOn, false)}</div>
                </div>
                <button className="text-btn" onClick={() => reopen(inj.id)}>Reopen</button>
                <button className="text-btn" style={{ color: C.bad, marginLeft: 8 }} onClick={() => setDel(inj)}>Delete</button>
              </div>
            ))}
          </div>
        </>
      )}
      {del && <ActionSheet onClose={() => setDel(null)} message={`Delete ${del.name}? Check-ins already logged in workouts are kept.`}
        actions={[{ label: "Delete", danger: true, onClick: () => remove(del.id) }]} />}
    </div>
  );
}

/* ============================================================
   Build a program (mesocycle generator)
   ============================================================ */
function GoalsTab({ onInstall, current, onBack }) {
  const [mode, setMode] = useState("hyp");
  const [days, setDays] = useState(6);
  const [goal, setGoal] = useState("gain");
  const [accum, setAccum] = useState(4);
  const [bench, setBench] = useState("");
  const [squat, setSquat] = useState("");
  const [dead, setDead] = useState("");
  const [press, setPress] = useState("");
  const [bw, setBw] = useState("");
  const [options, setOptions] = useState(null);
  const [preview, setPreview] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const num = v => v === "" ? null : Number(v) || null;
  const stats = { bench: num(bench), squat: num(squat), dead: num(dead), press: num(press), bodyweight: num(bw) };

  const generate = () => {
    if (mode === "str") {
      const prog = generate531({ stats });
      setOptions([{ split: { id: "531bbb", name: "5/3/1 Boring But Big",
        blurb: "4 days. One main lift a day on a percentage wave (5s, 3s, 5/3/1, deload), then 5 × 10 supplemental and accessories. Training max is 90% of your 1RM." }, prog }]);
    } else {
      setOptions(splitsForDays(days).map(s => ({ split: s, prog: generateProgram({ splitId: s.id, goal, daysPerWeek: days, accumWeeks: accum, stats }) })));
    }
    setPreview(null);
    setTimeout(() => { const el = document.getElementById("build-options"); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 30);
  };
  const install = prog => setConfirm(prog);
  const reset = () => { setOptions(null); setPreview(null); };

  if (preview) {
    const p = preview.prog;
    return (
      <div>
        <NavBar title="" onBack={() => { setPreview(null); window.scrollTo(0, 0); }} backLabel="Options" />
        <div className="page-head"><h2>{preview.split.name}</h2><div className="sub">{plural(p.days.length, "day")} a week</div></div>
        {p.meso.cardio && <div className="group-foot" style={{ marginTop: 10 }}>Cardio: {p.meso.cardio.note}. Calories {p.meso.nutrition.cal}. Protein {p.meso.nutrition.protein}.</div>}
        {p.days.map(d => (
          <div key={d.id}>
            <GroupLabel>{d.name}</GroupLabel>
            <div className="group">
              {d.items.map((it, i) => {
                const ex = LIB.find(l => l.key === it.key);
                const t = it.target;
                const reps = t.repLo === t.repHi ? `${t.repLo}` : `${t.repLo}–${t.repHi}`;
                const line = t.plan
                  ? t.plan.map(pp => `${pp.w}×${pp.r}${pp.plus ? "+" : ""}`).join(", ")
                  : `${t.sets} × ${reps}${t.w != null ? `, ${t.w} kg${it.est ? "*" : ""}` : ""}`;
                return (
                  <div key={i} className="row">
                    <span className="row-main row-title" style={{ fontSize: 15 }}>{ex ? ex.n : it.key}</span>
                    <span className="row-value num-t" style={{ fontSize: 14 }}>{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div className="group-foot">
          {p.meso && p.meso.type === "531"
            ? "Main-lift weights follow the weekly wave; move weeks from the Program tab. After the deload, build again with maxes up 2.5 kg upper and 5 kg lower."
            : "* Estimated starting load. Check it on your first workout. Set counts shown are week 1 and rise each week."}
        </div>
        <button className="btn btn-primary block" style={{ marginTop: 20 }} onClick={() => install(p)}>Use this program</button>
        {confirm && <ConfirmInstall current={current} onClose={() => setConfirm(null)} onConfirm={() => onInstall(confirm)} />}
      </div>
    );
  }

  return (
    <div>
      <NavBar title="New program" onBack={onBack} backLabel="Program" />
      <Seg lg value={mode} onChange={k => { setMode(k); reset(); }} options={[["hyp", "Hypertrophy"], ["str", "Strength 5/3/1"]]} style={{ marginTop: 12 }} />

      {mode === "hyp" && <>
        <GroupLabel>Days per week</GroupLabel>
        <Seg value={days} onChange={d => { setDays(d); reset(); }} options={[3, 4, 5, 6].map(d => [d, String(d)])} lg />
        <GroupLabel>Goal</GroupLabel>
        <Seg value={goal} onChange={g => { setGoal(g); reset(); }} options={Object.values(GOALS).map(g => [g.id, g.label.replace(/\s*\(.*\)/, "")])} lg />
        <GroupLabel>Length</GroupLabel>
        <div className="group">
          <div className="row">
            <div className="row-main">
              <div className="row-title">Building weeks</div>
              <div className="row-sub">Plus one deload week, {accum + 1} weeks in total</div>
            </div>
            <Stepper value={accum} min={3} max={6} onChange={v => { setAccum(v); reset(); }} />
          </div>
        </div>
      </>}

      <GroupLabel>{mode === "str" ? "Your 1RMs (kg)" : "Your lifts (kg)"}</GroupLabel>
      <div className="group">
        {[["Bench press", bench, setBench], ["Squat", squat, setSquat], ["Deadlift", dead, setDead],
          ...(mode === "str" ? [["Overhead press", press, setPress]] : []), ["Bodyweight", bw, setBw]].map(([l, v, set]) => (
          <label key={l} className="row">
            <span className="row-main row-title">{l}</span>
            <input className="inline-num" inputMode="decimal" placeholder="Optional" value={v} onChange={e => { set(e.target.value); reset(); }} />
          </label>
        ))}
      </div>
      <div className="group-foot">
        {mode === "str"
          ? "Actual or estimated maxes. Every working weight is a percentage of a training max set at 90%."
          : "A working weight or estimated 1RM. These set the starting loads; leave a lift blank and its weights start blank too."}
      </div>

      <button className="btn btn-primary block" style={{ marginTop: 20 }} onClick={generate}>{mode === "str" ? "Create 5/3/1 cycle" : "Show program options"}</button>

      {options && options.length > 0 && (
        <div id="build-options" style={{ scrollMarginTop: 70 }}>
          <GroupLabel>{options.length > 1 ? `${options.length} options for ${days} days` : "Your cycle"}</GroupLabel>
          {options.map(({ split, prog }) => (
            <div key={split.id} className="chart">
              <div style={{ fontSize: 17, fontWeight: 600 }}>{split.name}</div>
              <div className="dim" style={{ fontSize: 14.5, marginTop: 4, lineHeight: 1.45 }}>{split.blurb}</div>
              <div className="muted small" style={{ marginTop: 8 }}>{prog.days.map(d => d.name).join(", ")}</div>
              <div className="btn-row" style={{ marginTop: 14 }}>
                <button className="btn btn-secondary btn-sm" style={{ minHeight: 44 }} onClick={() => { setPreview({ split, prog }); window.scrollTo(0, 0); }}>Preview</button>
                <button className="btn btn-primary btn-sm" style={{ minHeight: 44 }} onClick={() => install(prog)}>Use this</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {confirm && <ConfirmInstall current={current} onClose={() => setConfirm(null)} onConfirm={() => onInstall(confirm)} />}
    </div>
  );
}
function ConfirmInstall({ current, onClose, onConfirm }) {
  return <ActionSheet onClose={onClose}
    message={current && current.meso ? `This replaces your current mesocycle (${current.meso.splitName}, week ${current.meso.week} of ${current.meso.totalWeeks}). Logged workouts are kept.` : "This replaces your current program. Logged workouts are kept."}
    actions={[{ label: "Replace program", onClick: onConfirm }]} />;
}

/* ============================================================
   Rest timer settings
   ============================================================ */
function RestSettings({ prefs, save, onBack }) {
  const [perm, setPerm] = useState(notifState());
  const [picker, setPicker] = useState(false);
  const [testMsg, setTestMsg] = useState("");
  const enableNotify = async on => {
    if (!on) { save({ notify: false }); return; }
    if (!notifSupported()) { setPerm("unsupported"); return; }
    let p = Notification.permission;
    if (p !== "granted") { try { p = await Notification.requestPermission(); } catch (e) { p = Notification.permission; } }
    setPerm(p);
    save({ notify: p === "granted" });
  };
  const test = () => { ensureAudio(); fireRestAlert(prefs, "Test alert"); setTestMsg("Alert sent"); setTimeout(() => setTestMsg(""), 1600); };
  const overrides = Object.entries(prefs.byEx || {});
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);
  const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const permNote = perm === "granted" ? null
    : perm === "denied" ? "Blocked. Allow notifications for this app in your phone's settings."
    : perm === "unsupported" ? (isIOS && !standalone ? "On iPhone, add the app to your Home Screen first." : "This browser doesn't support notifications.")
    : "You'll be asked to allow notifications.";
  return (
    <div>
      <NavBar title="Rest timer" onBack={onBack} backLabel="Program" />
      <div className="group" style={{ marginTop: 12 }}>
        <button className="row" onClick={() => setPicker(true)}>
          <span className="row-main row-title">Rest between sets</span>
          <span className="row-value">{fmtRestLong(prefs.len)}</span>
          <span className="row-chev"><Icon n="chevR" s={18} /></span>
        </button>
        <div className="row">
          <span className="row-main row-title">Extend button adds</span>
          <Seg value={prefs.step} onChange={v => save({ step: v })} options={[[15, "15 s"], [30, "30 s"], [60, "60 s"]]} style={{ width: 190 }} />
        </div>
      </div>
      <div className="group-foot">Starts when you tick a set. A rest set on an exercise overrides this.</div>

      <GroupLabel>When rest ends</GroupLabel>
      <div className="group">
        <div className="row">
          <div className="row-main">
            <div className="row-title">Notification</div>
            {permNote && <div className={cx("row-sub", perm === "denied" && "bad")}>{permNote}</div>}
          </div>
          <Switch label="Notification" on={!!prefs.notify && perm === "granted"} onChange={enableNotify} disabled={perm === "denied" || perm === "unsupported"} />
        </div>
        <div className="row">
          <div className="row-main"><div className="row-title">Sound</div><div className="row-sub">Three short beeps. Needs the ringer on.</div></div>
          <Switch label="Sound" on={!!prefs.sound} onChange={v => save({ sound: v })} />
        </div>
        <div className="row">
          <div className="row-main"><div className="row-title">Vibrate</div><div className="row-sub">Android only</div></div>
          <Switch label="Vibrate" on={!!prefs.vibrate} onChange={v => save({ vibrate: v })} />
        </div>
        <button className="row" onClick={test}>
          <span className="row-main row-title row-action">Send a test alert</span>
          {testMsg && <span className="row-value good">{testMsg}</span>}
        </button>
      </div>
      <div className="group-foot">Alerts come from the app itself, so they arrive while it's open or for a few seconds after you switch away. If the phone locks during rest, the alert fires when you reopen the app.</div>

      {overrides.length > 0 && (
        <>
          <GroupLabel>Exercise-specific rest</GroupLabel>
          <div className="group">
            {overrides.map(([k, sec]) => (
              <div key={k} className="row">
                <span className="row-main row-title">{k.replace(/^lib:/, "").replace(/^cus:(.*):[a-z0-9]+$/, "$1")}</span>
                <span className="row-value">{fmtRest(sec)}</span>
                <button className="text-btn" style={{ color: C.bad, marginLeft: 6 }} onClick={() => save(p => { const byEx = { ...(p.byEx || {}) }; delete byEx[k]; return { byEx }; })}>Remove</button>
              </div>
            ))}
          </div>
        </>
      )}
      {picker && <RestPicker title="Rest between sets" value={prefs.len} fallback={null} onPick={v => { save({ len: v }); setPicker(false); }} onClose={() => setPicker(false)} />}
    </div>
  );
}

/* ============================================================
   Your exercises (custom library)
   ============================================================ */
function CustomLibrary({ program, custom, removeCustom, updateCustom, onBack }) {
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const usage = useMemo(() => {
    const m = {};
    (program?.days || []).forEach(d => d.items.forEach(it => { m[it.key] = (m[it.key] || 0) + 1; }));
    return m;
  }, [program]);
  const allNames = useMemo(() => [...LIB.map(e => e.n), ...custom.map(c => c.n)], [custom]);
  const editRow = custom.find(c => c.key === editing);
  return (
    <div>
      <NavBar title="Your exercises" onBack={onBack} backLabel="Program" />
      {custom.length === 0 ? (
        <Empty title="No exercises of your own" msg="When an exercise isn't in the library, search for it while adding an exercise and choose Create." />
      ) : (
        <div className="group" style={{ marginTop: 12 }}>
          {custom.map(c => {
            const used = usage[c.key] || 0;
            return (
              <div key={c.key} className="row">
                <div className="row-main">
                  <div className="row-title">{c.n}</div>
                  <div className="row-sub">{[c.m, c.e, T_LABEL[c.t], used ? `in ${plural(used, "program day")}` : null].filter(Boolean).join(", ")}</div>
                </div>
                <button className="text-btn" onClick={() => setEditing(c.key)}>Edit</button>
                <button className="text-btn" style={{ color: C.bad, marginLeft: 8 }} onClick={() => setConfirmDel(c)}>Delete</button>
              </div>
            );
          })}
        </div>
      )}
      {editRow && (
        <Sheet title="Edit exercise" onClose={() => setEditing(null)}>
          <CustomForm initial={editRow} existingNames={allNames} saveLabel="Save changes" onCancel={() => setEditing(null)}
            onSave={async ex => { await updateCustom(editRow.key, ex); setEditing(null); }} />
        </Sheet>
      )}
      {confirmDel && <ActionSheet onClose={() => setConfirmDel(null)}
        message={`Delete ${confirmDel.n}?${usage[confirmDel.key] ? ` It's used in ${plural(usage[confirmDel.key], "program day")}; those slots will need a replacement.` : ""} Logged workouts keep the name but drop out of muscle totals.`}
        actions={[{ label: "Delete exercise", danger: true, onClick: () => removeCustom(confirmDel.key) }]} />}
    </div>
  );
}

/* ============================================================
   Exercise picker (library + create your own)
   ============================================================ */
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
  const qTrim = q.trim();
  const seedMuscle = MUSCLES.find(m => m.toLowerCase() === qTrim.toLowerCase()) || null;
  const seedName = seedMuscle ? "" : qTrim;

  if (adding) {
    return (
      <Sheet title="New exercise" onClose={onClose}>
        <CustomForm initialName={seedName} initialMuscle={seedMuscle} existingNames={existingNames}
          onCancel={() => setAdding(false)}
          onSave={async ex => { const k = await onAddCustom(ex); setAdding(false); setQ(""); onPick(k); }} />
      </Sheet>
    );
  }
  return (
    <Sheet title="Choose exercise" onClose={onClose} bodyStyle={{ paddingTop: 0 }}
      foot={<button className="btn btn-secondary block" onClick={() => setAdding(true)}><Icon n="plus" s={20} w={2.2} />{seedName ? `Create “${seedName}”` : "Create an exercise"}</button>}>
      <div className="search" style={{ position: "sticky", top: 0, background: C.surface, paddingBottom: 6, zIndex: 1 }}>
        <Icon n="search" s={18} />
        <input className="field" type="search" value={q} placeholder="Search exercises" aria-label="Search exercises" onChange={e => setQ(e.target.value)} />
      </div>
      {groups.map(([m, list]) => (
        <div key={m}>
          <div className="group-label" style={{ marginTop: 18 }}>{m}</div>
          <div className="group" style={{ background: C.surface2 }}>
            {list.map(e => (
              <button key={e.key} className="row" onClick={() => onPick(e.key)}>
                <span className="row-main row-title">{e.n}{e.key.startsWith("cus:") && <span className="tag est" style={{ marginLeft: 8 }}>Yours</span>}</span>
                <span className="row-value small" style={{ fontSize: 14 }}>{e.e}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {groups.length === 0 && <Empty msg={`Nothing in the library matches "${qTrim}". Create it below.`} />}
    </Sheet>
  );
}
function CustomForm({ initial, initialName, initialMuscle, existingNames, saveLabel, onCancel, onSave }) {
  const [n, setN] = useState(initial?.n ?? initialName ?? "");
  const [m, setM] = useState(initial?.m ?? initialMuscle ?? MUSCLES[0]);
  const [e, setE] = useState(initial?.e ?? "Barbell");
  const [t, setT] = useState(initial?.t ?? "wr");
  const [role, setRole] = useState(initial?.role ?? "compound");
  const RP_RANGE = { heavy: [5, 10], compound: [8, 12], iso: [10, 15], small: [12, 20], rehab: [10, 15] };
  const trimmed = n.trim();
  const dupe = trimmed.length > 0 && (existingNames || [])
    .some(x => x.toLowerCase() === trimmed.toLowerCase() && x.toLowerCase() !== (initial?.n || "").toLowerCase());
  const canSave = trimmed.length > 0 && !dupe;
  const sel = (label, value, set, opts) => (
    <div style={{ marginTop: 14 }}>
      <label className="lbl">{label}</label>
      <select className="field" value={value} onChange={ev => set(ev.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
    </div>
  );
  return (
    <div>
      <label className="lbl" htmlFor="cf-name">Name</label>
      <input id="cf-name" className={cx("field", dupe && "err")} value={n} onChange={ev => setN(ev.target.value)} autoFocus />
      {dupe && <div className="field-err">An exercise called “{trimmed}” already exists.</div>}
      {sel("Muscle", m, setM, MUSCLES.map(x => [x, x]))}
      {sel("Equipment", e, setE, ["Barbell", "Dumbbell", "Machine", "Cable", "Bodyweight", "Band"].map(x => [x, x]))}
      {sel("What you log", t, setT, [["wr", "Weight and reps"], ["rep", "Bodyweight reps"], ["time", "Timed hold"], ["wd", "Load and distance"], ["cardio", "Cardio"]])}
      {sel("Rep range", role, setRole, [["heavy", "Heavy compound, 5 to 10"], ["compound", "Compound, 8 to 12"], ["iso", "Isolation, 10 to 15"], ["small", "Small muscle, 12 to 20"], ["rehab", "Rehab, 10 to 15"]])}
      <div className="btn-row" style={{ marginTop: 22 }}>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" disabled={!canSave} onClick={() => canSave && onSave({ n: trimmed, m, e, t, role, rp: RP_RANGE[role] })}>{saveLabel || "Create and add"}</button>
      </div>
    </div>
  );
}

/* ============================================================
   Charts (inline SVG)
   ============================================================ */
function Line({ title, sub, data, unit, embedded, marks, markLabel, fixedMin, fixedMax, bands }) {
  const W = 340, H = 132, padR = 8, padT = 8, padB = 20;
  const vals = data.map(d => d.v);
  let min = fixedMin != null ? fixedMin : Math.min(...vals);
  let max = fixedMax != null ? fixedMax : Math.max(...vals);
  if (bands) { max = Math.max(max, bands.hi); min = Math.min(min, 0); }
  if (fixedMin == null && !bands) { const span0 = max - min || Math.abs(max) || 1; min = min - span0 * 0.12; max = max + span0 * 0.12; }
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const fmtT = v => Math.abs(span) >= 6 ? Math.round(v).toLocaleString() : (Math.round(v * 10) / 10).toString();
  const ticks = [max, (max + min) / 2, min];
  const padL = 12 + Math.max(...ticks.map(t => fmtT(t).length)) * 6;
  const x = i => padL + (data.length === 1 ? (W - padL - padR) / 2 : (i / (data.length - 1)) * (W - padL - padR));
  const y = v => padT + (1 - (v - min) / span) * (H - padT - padB);
  const pts = data.map((d, i) => [x(i), y(d.v)]);
  const path = pts.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = data[data.length - 1];
  const body = (
    <>
      <div className="chart-head">
        <div>
          <div className="chart-title">{title}</div>
          {sub && <div className="chart-sub">{sub}</div>}
        </div>
        {last && <div className="chart-val">{typeof last.v === "number" ? last.v.toLocaleString() : last.v}{unit ? <small>{unit}</small> : null}</div>}
      </div>
      {data.length === 0
        ? <div className="chart-empty">No data yet.</div>
        : <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label={`${title}, latest ${last.v}${unit ? " " + unit : ""}`}>
            {bands && <rect x={padL} width={W - padL - padR} y={y(bands.hi)} height={Math.max(0, y(bands.lo) - y(bands.hi))} fill={C.good} opacity=".12" />}
            {ticks.map((t, i) => (
              <g key={i}>
                <line x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} stroke={C.line} strokeWidth="1" />
                <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill={C.ink3} style={{ fontVariantNumeric: "tabular-nums" }}>{fmtT(t)}</text>
              </g>
            ))}
            <path d={path} fill="none" stroke={C.acc} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => marks && marks[i]
              ? <circle key={i} cx={p[0]} cy={p[1]} r="4.5" fill={C.surface} stroke={C.ink} strokeWidth="2" />
              : (i === pts.length - 1 || data.length <= 12) ? <circle key={i} cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 3.5 : 2.2} fill={C.acc} /> : null)}
            <text x={padL} y={H - 4} fontSize="10" fill={C.ink3}>{fmtDay(data[0].date, false)}</text>
            {data.length > 1 && <text x={W - padR} y={H - 4} fontSize="10" fill={C.ink3} textAnchor="end">{fmtDay(last.date, false)}</text>}
          </svg>}
      {marks && marks.some(Boolean) && (
        <div className="legend">
          <svg width="12" height="12" aria-hidden="true"><circle cx="6" cy="6" r="4" fill={C.surface} stroke={C.ink} strokeWidth="2" /></svg>
          {markLabel || "PR"}, {marks.filter(Boolean).length} of {data.length}
        </div>
      )}
    </>
  );
  return embedded ? <div>{body}</div> : <div className="chart">{body}</div>;
}

/* vertical bars: one per week, fixed window, zero weeks drawn as a stub */
function Bars({ title, sub, data }) {
  const max = Math.max(...data.map(([, v]) => v), 1);
  const BAR_H = 72;
  return (
    <div className="chart">
      <div className="chart-head">
        <div><div className="chart-title">{title}</div>{sub && <div className="chart-sub">{sub}</div>}</div>
      </div>
      <div style={{ display: "flex", gap: 5, alignItems: "flex-end" }} role="img" aria-label={`${title}: ${data.map(d => d[1]).join(", ")}`}>
        {data.map(([wk, v], i) => (
          <div key={wk} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <div className="num-t" style={{ fontSize: 11, height: 14, color: v ? C.ink2 : "transparent", fontWeight: 600 }}>{v || 0}</div>
            <div style={{ height: BAR_H, width: "100%", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
              <div style={{ width: "100%", maxWidth: 22, height: v ? Math.max(4, (v / max) * BAR_H) : 2, background: v ? (i === data.length - 1 ? C.acc : C.ink3) : C.surface3, borderRadius: v ? "4px 4px 1px 1px" : 1 }} />
            </div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: C.ink3, marginTop: 6 }}>
        <span>Week of {fmtDay(data[0][2], false)}</span><span>This week</span>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
