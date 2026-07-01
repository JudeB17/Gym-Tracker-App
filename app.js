/* ============================================================
   app.js — Load/Log gym tracker (JSX, compiled in-browser by Babel)
   Depends on: window.GymData, window.GymStore
   ============================================================ */
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { MUSCLES, LIB, T, rpHint, defaultProgram,
        GOALS, SPLITS, splitsForDays, generateProgram, applyWeek, mesoStatus,
        seedWeight, volumeBand, LANDMARKS } = window.GymData;
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
  });
  return best;
}
function blankSet(t) {
  const b = { wr:{w:"",r:"",rpe:""}, rep:{r:"",rpe:""}, time:{sec:""}, wd:{w:"",dist:""}, cardio:{sec:"",dist:""} }[t];
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

const exMapFromLib = () => { const m = new Map(); LIB.forEach(e => m.set(e.key, e)); return m; };

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

  const flash = useCallback(m => { setToast(m); setTimeout(() => setToast(""), 1800); }, []);
  const allEx = useMemo(() => [...LIB, ...custom], [custom]);
  const exByKey = useCallback(k => allEx.find(e => e.key === k), [allEx]);

  const saveProgram = useCallback(async p => { setProgram(p); await sSet("program:current", p); }, []);

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

  const prefillFor = useCallback((key, target, exType, exName) => {
    const t = target ? { ...target } : null;
    let ghostW = "", ghostR = "", est = false;

    const prev = lastForExercise(key);
    if (prev && prev.length) {
      // weight log: take the heaviest set as the working reference
      if (exType === "wr" || exType === "wd") {
        const ref = prev.reduce((a, s) => (s.w || 0) >= (a.w || 0) ? s : a, prev[0]);
        let w = ref.w || 0;
        ghostR = ref.r != null ? String(ref.r) : "";
        if (t && t.w != null && !mesoDeload) {
          // overload: bump only if every set last time met top of the rep band
          const top = t.repHi || t.repLo || 0;
          const allHit = prev.every(s => (s.r || 0) >= top && (s.w || 0) >= w * 0.999);
          if (allHit && w > 0) {
            const inc = w >= 60 ? 2.5 : w >= 20 ? 2 : 1;
            w = Math.round((w + inc) * 2) / 2;
          }
        }
        ghostW = w > 0 ? String(w) : "";
        if (t) t.w = w > 0 ? w : t.w;
      } else if (exType === "rep") {
        const ref = prev.reduce((a, s) => (s.r || 0) >= (a.r || 0) ? s : a, prev[0]);
        ghostR = ref.r != null ? String(ref.r) : "";
      } else if (exType === "time") {
        const ref = prev.reduce((a, s) => (s.sec || 0) >= (a.sec || 0) ? s : a, prev[0]);
        ghostR = ref.sec != null ? String(ref.sec) : "";
      }
      return { target: t, ghostW, ghostR, est: false };
    }

    // no history -> program target weight
    if (t && t.w != null) {
      ghostW = String(t.w);
      ghostR = t.repLo != null ? String(t.repLo) : "";
      return { target: t, ghostW, ghostR, est: !!(t && t._seeded) };
    }

    // no history, no target weight -> population seed for library movements
    if ((exType === "wr") && exName) {
      const reps = (t && t.repLo) ? t.repLo : 8;
      const seeded = seedWeight(exName, reps, { ...mesoStats, bodyweight: lastBodyweight || mesoStats.bodyweight });
      if (seeded && seeded.w != null) {
        ghostW = String(seeded.w);
        ghostR = String(reps);
        est = true;
        if (t) t.w = seeded.w;
        return { target: t, ghostW, ghostR, est };
      }
    }

    // fall through: reps ghost from target if present
    if (t && t.repLo != null) ghostR = String(t.repLo);
    return { target: t, ghostW, ghostR, est };
  }, [lastForExercise, mesoDeload, mesoStats, lastBodyweight]);

  /* ---- session lifecycle ---- */
  const startSession = useCallback(() => {
    const day = program.days.find(d => d.id === activeDayId);
    if (!day) return;
    setDraft({
      id: uid(), date: TODAY(), dayId: day.id, dayName: day.name, bodyweight: "", feel: null, startedAt: Date.now(),
      injuries: injuries.filter(i => !i.closed).map(i => ({ name: i.name, pain: 0, swelling: false, note: "" })),
      entries: day.items.map(it => {
        const ex = exByKey(it.key); if (!ex) return null;
        const pf = prefillFor(it.key, it.target, ex.t, ex.n);
        const nSets = it.target?.sets || 1;
        return { eid: uid(), key: it.key, name: ex.n, t: ex.t, note: "",
          est: pf.est, target: pf.target, ghostW: pf.ghostW, ghostR: pf.ghostR,
          sets: Array.from({ length: nSets }, () => blankSet(ex.t)) };
      }).filter(Boolean)
    });
    setViewSession(null); setTab("log");
  }, [program, activeDayId, exByKey, prefillFor, injuries]);

  const addExerciseToDraft = useCallback(exKey => {
    const ex = exByKey(exKey); if (!ex) return;
    const pf = prefillFor(exKey, null, ex.t, ex.n);
    setDraft(d => ({ ...d, entries: [...d.entries, { eid: uid(), key: exKey, name: ex.n, t: ex.t, note: "",
      target: pf.target, ghostW: pf.ghostW, ghostR: pf.ghostR, est: pf.est, sets: [blankSet(ex.t)] }] }));
  }, [exByKey, prefillFor]);

  const saveSession = useCallback(async () => {
    const notEmpty = (t, s) => ({
      wr: () => s.w !== "" || s.r !== "", rep: () => s.r !== "",
      time: () => s.sec !== "", wd: () => s.w !== "" || s.dist !== "",
      cardio: () => s.sec !== "" || s.dist !== ""
    })[t]();
    const num = v => v === "" ? 0 : Number(v) || 0;
    const clean = {
      ...draft,
      bodyweight: draft.bodyweight === "" ? null : Number(draft.bodyweight),
      feel: (draft.feel == null || draft.feel === "") ? null : Math.max(1, Math.min(10, Number(draft.feel))),
      injuries: (draft.injuries || []).filter(i => i.pain > 0 || i.swelling || i.note),
      entries: draft.entries.map(e => ({
        key: e.key, name: e.name, t: e.t, note: e.note || "",
        sets: e.sets.filter(s => notEmpty(e.t, s)).map(s => {
          if (e.t === "wr") return { w: num(s.w), r: num(s.r), rpe: s.rpe === "" ? null : Number(s.rpe) };
          if (e.t === "rep") return { r: num(s.r), rpe: s.rpe === "" ? null : Number(s.rpe) };
          if (e.t === "time") return { sec: num(s.sec) };
          if (e.t === "wd") return { w: num(s.w), dist: num(s.dist) };
          return { sec: num(s.sec), dist: num(s.dist) };
        })
      })).filter(e => e.sets.length > 0 || e.note)
    };
    if (clean.entries.length === 0 && clean.injuries.length === 0) { flash("Nothing logged."); return; }
    // duration: from live timer on new sessions, preserved on edits
    clean.durationMin = draft.startedAt
      ? Math.max(1, Math.round((Date.now() - draft.startedAt) / 60000))
      : (draft.durationMin ?? null);
    delete clean.startedAt;
    // PR scan: any wr exercise whose best e1RM beats all prior history
    let prCount = 0;
    clean.entries.forEach(e => {
      if (e.t !== "wr") return;
      const best = Math.max(0, ...e.sets.map(s => e1rm(s.w, s.r)));
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
    await sDel("draft:current");
    setDraft(null); setTab("history");
    flash((existingIdx >= 0 ? "Updated." : "Saved.") + (prCount ? ` ${prCount} PR${prCount > 1 ? "s" : ""}.` : ""));
  }, [draft, sessions, flash]);

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
      bodyweight: toStr(session.bodyweight),
      durationMin: session.durationMin ?? null,
      feel: session.feel == null ? null : session.feel,
      injuries: [...logged, ...extra],
      entries: session.entries.map(e => ({
        eid: uid(), key: e.key, name: e.name, t: e.t, note: e.note || "", target: null, ghostW: "", ghostR: "",
        sets: (e.sets.length ? e.sets : [blankSet(e.t)]).map(s => {
          if (e.t === "wr") return { w: toStr(s.w), r: toStr(s.r), rpe: toStr(s.rpe) };
          if (e.t === "rep") return { r: toStr(s.r), rpe: toStr(s.rpe) };
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
  const removeCustom = useCallback(async key => {
    const next = custom.filter(c => c.key !== key); setCustom(next); await sSet("library:custom", next);
  }, [custom]);

  /* ---- injuries ---- */
  const saveInjuries = useCallback(async list => { setInjuries(list); await sSet("injuries:list", list); }, []);

  /* ---- import/export ---- */
  const exportJson = useCallback(() => {
    const data = { program, custom, sessions, injuries, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `gym-backup-${TODAY()}.json`; a.click();
    URL.revokeObjectURL(a.href);
  }, [program, custom, sessions, injuries]);
  const importJson = useCallback(async file => {
    try {
      const d = JSON.parse(await file.text());
      if (d.program && d.program.days) { const p = migrate(d.program); setProgram(p); setActiveDayId(p.days[0]?.id ?? null); await sSet("program:current", p); }
      if (Array.isArray(d.custom)) { setCustom(d.custom); await sSet("library:custom", d.custom); }
      if (Array.isArray(d.injuries)) { setInjuries(d.injuries); await sSet("injuries:list", d.injuries); }
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

  const openPicker = useCallback(onPick => setPicker({ onPick }), []);

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
            ? <DraftView draft={draft} setDraft={setDraft} onSave={saveSession} onDiscard={discardDraft}
                lastForExercise={lastForExercise} exByKey={exByKey}
                onAddExercise={() => openPicker(k => { addExerciseToDraft(k); setPicker(null); })} />
            : <StartView program={program} activeDayId={activeDayId} setActiveDayId={setActiveDayId} onStart={startSession} sessions={sessions} />
        )}
        {tab === "history" && (
          viewSession
            ? <SessionDetail session={viewSession} onBack={() => setViewSession(null)} onDelete={deleteSession} onEdit={editSession} exByKey={exByKey} />
            : <HistoryList sessions={sessions} onOpen={setViewSession} />
        )}
        {tab === "trends" && <Trends sessions={sessions} allEx={allEx} exResolve={exByKey} />}
        {tab === "injury" && <InjuryTab injuries={injuries} saveInjuries={saveInjuries} sessions={sessions} />}
        {tab === "goals" && <GoalsTab onInstall={installGenerated} current={program} setTab={setTab} />}
        {tab === "program" && <ProgramEditor program={program} setProgram={saveProgram} exByKey={exByKey}
          openPicker={openPicker} custom={custom} removeCustom={removeCustom}
          exportJson={exportJson} importJson={importJson} onReset={resetProgram}
          onAdvanceWeek={advanceWeek} onExitMeso={exitMeso} />}
      </div>
      {picker && <Picker custom={custom} onAddCustom={addCustom} onPick={picker.onPick} onClose={() => setPicker(null)} />}
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
          {st.label} · RIR {st.rir.lo}–{st.rir.hi}
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
            <div style={{ fontSize:18, fontWeight:700 }}>RIR {st.rir.lo}–{st.rir.hi}</div>
            <div style={{ fontSize:10, color:C.dim }}>reps in reserve</div>
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
function DraftView({ draft, setDraft, onSave, onDiscard, lastForExercise, exByKey, onAddExercise }) {
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

  /* rest timer: fires when a set is marked done. length pref persisted. */
  const [restLen, setRestLen] = useState(120); // 0 = off
  const [restEnd, setRestEnd] = useState(null);
  const restLenRef = useRef(120);
  useEffect(() => { restLenRef.current = restLen; }, [restLen]);
  useEffect(() => { (async () => { const v = await sGet("prefs:restLen"); if (v != null) setRestLen(v); })(); }, []);
  const cycleRest = () => {
    const order = [0, 90, 120, 180];
    const next = order[(order.indexOf(restLen) + 1) % order.length];
    setRestLen(next); sSet("prefs:restLen", next);
    if (next === 0) setRestEnd(null);
  };
  const startRest = useCallback(() => {
    if (restLenRef.current > 0) setRestEnd(Date.now() + restLenRef.current * 1000);
  }, []);

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
          <button onClick={cycleRest} style={{ background:C.bg, border:`1px solid ${C.line}`, color: restLen ? C.acc : C.dim, borderRadius:12, padding:"3px 10px", fontSize:11, fontWeight:600, cursor:"pointer" }}>
            rest {restLen ? `${restLen}s` : "off"}
          </button>
        </div>
        <div style={{ fontSize:10, color:C.dim, marginTop:4 }}>tap a set number to mark it done · long-press ⠿ to reorder</div>
      </div>

      <DragList
        items={draft.entries}
        keyOf={e => e.eid || e.key}
        onMove={moveEntry}
        render={(e, i, dragHandle) => (
          <ExerciseCard entry={e} setEntry={setEntry} rmEntry={rmEntry} prev={lastForExercise(e.key)} ex={exByKey(e.key)} dragHandle={dragHandle} onSetDone={startRest} />
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

      {restEnd && <RestPill endAt={restEnd} onExtend={() => setRestEnd(t => t + 30000)} onClear={() => setRestEnd(null)} />}
    </div>
  );
}

/* floating rest countdown, sits above the bottom nav */
function RestPill({ endAt, onExtend, onClear }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 500); return () => clearInterval(t); }, []);
  const rem = Math.max(0, Math.ceil((endAt - now) / 1000));
  const finished = rem === 0;
  const buzzed = useRef(false);
  useEffect(() => {
    if (finished && !buzzed.current) { buzzed.current = true; if (navigator.vibrate) navigator.vibrate([180, 80, 180]); }
    if (!finished) buzzed.current = false;
  }, [finished]);
  return (
    <div style={{ position:"fixed", bottom:"calc(64px + env(safe-area-inset-bottom))", left:"50%", transform:"translateX(-50%)",
      display:"flex", alignItems:"center", gap:12, zIndex:60,
      background: finished ? C.acc : C.panel2, color: finished ? "#04150E" : C.ink,
      border:`1px solid ${finished ? C.acc : C.line}`, borderRadius:24, padding:"9px 16px",
      boxShadow:"0 4px 16px rgba(0,0,0,.5)", animation: finished ? "pulse 1.2s infinite" : "none" }}>
      <span style={{ fontSize:15, fontWeight:800, fontVariantNumeric:"tabular-nums", minWidth:44 }}>
        {finished ? "GO" : fmtSec(rem)}
      </span>
      {!finished && <button onClick={onExtend} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.ink, borderRadius:12, padding:"2px 10px", fontSize:12, fontWeight:600, cursor:"pointer" }}>+30s</button>}
      <button onClick={onClear} style={{ background:"transparent", border:"none", color:"inherit", fontSize:17, cursor:"pointer", padding:0, lineHeight:1 }}>×</button>
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

function ExerciseCard({ entry, setEntry, rmEntry, prev, ex, dragHandle, onSetDone }) {
  const blank = blankSet(entry.t);
  const [collapsed, setCollapsed] = useState(false);
  const [plates, setPlates] = useState(false);
  const addSet = () => setEntry(entry.eid, e => ({ ...e, sets: [...e.sets, { ...(e.sets[e.sets.length-1] || blank), done: false }] }));
  const rmSet = i => setEntry(entry.eid, e => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }));
  const upd = (i, k, v) => setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j===i ? { ...s, [k]: v } : s) }));
  const toggleDone = i => {
    const wasDone = !!entry.sets[i].done;
    setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j===i ? { ...s, done: !s.done } : s) }));
    if (!wasDone && onSetDone) onSetDone();
  };
  const setNote = v => setEntry(entry.eid, e => ({ ...e, note: v }));
  // copy last session's actual values into the inputs (placeholders don't save)
  const useLast = () => {
    if (!prev || !prev.length) return;
    const toStr = v => v == null ? "" : String(v);
    setEntry(entry.eid, e => ({ ...e, sets: prev.map(s => {
      if (e.t === "wr") return { w: toStr(s.w), r: toStr(s.r), rpe: toStr(s.rpe), done: false };
      if (e.t === "rep") return { r: toStr(s.r), rpe: toStr(s.rpe), done: false };
      if (e.t === "time") return { sec: toStr(s.sec), done: false };
      if (e.t === "wd") return { w: toStr(s.w), dist: toStr(s.dist), done: false };
      return { sec: toStr(s.sec), dist: toStr(s.dist), done: false };
    }) }));
  };

  const cols = { wr:["kg","reps","rpe"], rep:["reps","rpe"], time:["sec"], wd:["kg","dist m"], cardio:["min","dist km"] }[entry.t];
  const keys = { wr:["w","r","rpe"], rep:["r","rpe"], time:["sec"], wd:["w","dist"], cardio:["sec","dist"] }[entry.t];
  const grid = `30px ${cols.map(() => "1fr").join(" ")} 24px`;
  const hint = targetHint(entry.t, entry.target);
  const rp = rpHint(ex);
  const prevStr = prev ? prevSummary(entry.t, prev) : null;
  const nDone = entry.sets.filter(s => s.done).length;
  const ph = k => {
    // prefer the program GOAL (target); fall back to computed ghost
    // (last session / overload estimate / seed) only when the goal is absent.
    const t = entry.target;
    if (k === "w") {
      if (t && t.w != null) return String(t.w);   // goal weight
      if (entry.ghostW) return entry.ghostW;       // overload estimate / seed
      return "—";
    }
    if (k === "r") {
      if (t && t.repLo != null) return String(t.repLo); // goal reps
      if (entry.ghostR) return entry.ghostR;
      return "—";
    }
    if (k === "sec") {
      if (t && t.repLo != null) return String(t.repLo);
      if (entry.ghostR) return entry.ghostR;
      return "—";
    }
    return "—";
  };
  // seed for the plate calculator: first typed weight, else placeholder weight
  const plateSeed = () => {
    if (entry.t !== "wr" && entry.t !== "wd") return "";
    const typed = entry.sets.find(s => s.w !== "");
    if (typed) return typed.w;
    const p = ph("w");
    return p === "—" ? "" : p;
  };

  return (
    <div style={card}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {dragHandle}
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{entry.name} <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>· {T_LABEL[entry.t]}</span></div>
          <div style={{ display:"flex", gap:8, marginTop:2, flexWrap:"wrap" }}>
            {hint && <span style={{ fontSize:11, color:C.acc }}>{hint}</span>}
            {entry.est && (entry.ghostW || (entry.target && entry.target.w != null)) && <span style={{ fontSize:10, color:C.gold }}>est · confirm</span>}
            {rp && <span style={{ fontSize:11, color:C.dim }}>{rp}</span>}
          </div>
          {prevStr && (
            <div style={{ display:"flex", gap:8, alignItems:"baseline", marginTop:3, flexWrap:"wrap" }}>
              <span style={{ fontSize:11, color:C.blue, fontWeight:600 }}>last: {prevStr}</span>
              <button onClick={useLast} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.blue, borderRadius:10, padding:"1px 8px", fontSize:10, fontWeight:600, cursor:"pointer" }}>use last</button>
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
              border:`1px solid ${s.done ? C.acc : C.line}` }}>
              {s.done ? "✓" : i+1}
            </button>
            {keys.map(k => <input key={k} style={inp} inputMode="decimal" enterKeyHint="next" value={s[k]} placeholder={ph(k)}
              onFocus={ev => ev.target.select()} onChange={ev => upd(i, k, ev.target.value)} />)}
            <button onClick={() => rmSet(i)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:16 }}>×</button>
          </div>
        ))}
        <div style={{ display:"flex", gap:6 }}>
          <button onClick={addSet} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.acc, borderRadius:8, padding:"6px 0", fontSize:12, flex:1, cursor:"pointer" }}>+ set</button>
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
  if (t === "wr") return sets.map(s => `${s.w}×${s.r}`).join(", ");
  if (t === "rep") return sets.map(s => `${s.r}`).join(", ");
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
function HistoryList({ sessions, onOpen }) {
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
            const totalSets = s.entries.reduce((a, e) => a + e.sets.length, 0);
            const vol = s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w||0)*(x.r||0), 0), 0);
            return (
              <button key={s.id} onClick={() => onOpen(s)} style={{ ...card, width:"100%", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:14, fontWeight:600 }}>{s.dayName}</div>
                  <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>
                    {s.date} · {s.entries.length} exercises · {totalSets} sets{s.durationMin != null ? ` · ${fmtDur(s.durationMin)}` : ""}
                  </div>
                </div>
                <div style={{ textAlign:"right" }}>
                  {vol > 0 && <div style={{ fontSize:13, fontWeight:700, color:C.blue }}>{Math.round(vol).toLocaleString()}<span style={{ fontSize:10, color:C.dim }}> kg·r</span></div>}
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

function SessionDetail({ session, onBack, onDelete, onEdit, exByKey }) {
  const [confirm, setConfirm] = useState(false);
  return (
    <div>
      <div style={{ display:"flex", gap:10, alignItems:"center", marginTop:12 }}>
        <button onClick={onBack} style={{ background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer" }}>← Back</button>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:16, fontWeight:700 }}>{session.dayName}</div>
          <div style={{ fontSize:11, color:C.dim }}>{session.date}{session.durationMin!=null ? ` · ${fmtDur(session.durationMin)}` : ""}{session.bodyweight!=null ? ` · BW ${session.bodyweight}kg` : ""}{session.feel!=null ? ` · feel ${session.feel}/10` : ""}</div>
        </div>
        <button onClick={() => onEdit(session)} style={{ background:C.panel2, color:C.acc, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 14px", fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>Edit</button>
      </div>
      {session.entries.map((e, idx) => {
        const ex = exByKey(e.key);
        return (
          <div key={idx} style={card}>
            <div style={{ fontSize:14, fontWeight:600 }}>{e.name} <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>· {T_LABEL[e.t]}</span></div>
            <div style={{ marginTop:8 }}>
              {e.sets.map((s, i) => (
                <div key={i} style={{ display:"flex", gap:10, fontSize:13, padding:"3px 0", borderBottom: i<e.sets.length-1 ? `1px solid ${C.line}` : "none" }}>
                  <span style={{ color:C.dim, width:20 }}>{i+1}</span>
                  <span>{setLine(e.t, s)}</span>
                </div>
              ))}
              {e.sets.length > 0 && e.t === "wr" && <div style={{ fontSize:11, color:C.dim, marginTop:6 }}>best e1RM: {Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r))))}kg</div>}
            </div>
            {e.note && <div style={{ fontSize:13, color:C.gold, marginTop:8, fontStyle:"italic" }}>“{e.note}”</div>}
          </div>
        );
      })}
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
function setLine(t, s) {
  if (t === "wr") return `${s.w} kg × ${s.r}${s.rpe!=null ? ` @ RPE ${s.rpe}` : ""}`;
  if (t === "rep") return `${s.r} reps${s.rpe!=null ? ` @ RPE ${s.rpe}` : ""}`;
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
function exerciseHistory(sessions, picked, ex) {
  if (!ex) return [];
  return sessions.map(s => {
    const e = s.entries.find(x => x.key === picked);
    if (!e || !e.sets.length) return null;
    let metric = 0, label = "";
    if (ex.t === "wr") { metric = Math.round(Math.max(...e.sets.map(x => e1rm(x.w, x.r)))); label = metric + " e1RM"; }
    else if (ex.t === "rep") { metric = Math.max(...e.sets.map(x => x.r||0)); label = metric + " reps"; }
    else if (ex.t === "time") { metric = Math.max(...e.sets.map(x => x.sec||0)); label = metric + "s"; }
    else if (ex.t === "wd") { metric = Math.max(...e.sets.map(x => x.w||0)); label = metric + "kg"; }
    else { metric = Math.round(e.sets.reduce((a, x) => a + (x.dist||0), 0)*10)/10; label = metric + "km"; }
    return { date: s.date, metric, label, sets: e.sets, note: e.note, t: ex.t };
  }).filter(Boolean);
}

/* per-exercise drill-down: chart + every session. Fixed exercise (no dropdown). */
function ExerciseDetail({ sessions, exMap, exKey, onBack }) {
  const ex = exMap.get(exKey);
  const history = useMemo(() => exerciseHistory(sessions, exKey, ex), [sessions, exKey, ex]);
  const series = history.filter(h => h.metric > 0).map(h => ({ date: h.date, v: h.metric }));
  const unit = ex ? ({ wr:"kg e1RM", rep:"reps", time:"s", wd:"kg", cardio:"km" }[ex.t]) : "";
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
      <Line title="Progression" data={series} color={C.acc} unit={unit} />
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Every session</div>
        {history.length === 0 && <div style={{ fontSize:12, color:C.dim }}>No sets logged yet.</div>}
        {(() => {
          // flag sessions where the metric set a new running max (skip the first — baseline, not a PR)
          let runMax = -Infinity;
          const withPr = history.map((h, i) => {
            const pr = i > 0 && h.metric > runMax && h.metric > 0;
            if (h.metric > runMax) runMax = h.metric;
            return { ...h, pr };
          });
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
function TrendsOverview({ sessions }) {
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
      s.entries.forEach(e => { if (muscleOfEntry(e, exResolve) === muscle) n += (e.sets ? e.sets.length : 0); });
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
      const total = items.reduce((a, e) => a + e.sets.length, 0);
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
function Trends({ sessions, allEx, exResolve }) {
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
      {view === "overview" && <TrendsOverview sessions={sessions} />}
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

// count working sets per muscle across a list of sessions. one logged set = 1.
function setsByMuscle(sessionList, exResolve) {
  const out = {};
  sessionList.forEach(s => s.entries.forEach(e => {
    const mus = muscleOfEntry(e, exResolve);
    if (!mus) return;
    out[mus] = (out[mus] || 0) + (e.sets ? e.sets.length : 0);
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
  const [days, setDays] = useState(6);
  const [goal, setGoal] = useState("gain");
  const [accum, setAccum] = useState(4);
  const [bench, setBench] = useState("");
  const [squat, setSquat] = useState("");
  const [dead, setDead] = useState("");
  const [bw, setBw] = useState("");
  const [options, setOptions] = useState(null);
  const [preview, setPreview] = useState(null); // generated program being previewed

  const sel = { background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", fontSize:14, width:"100%" };
  const num = v => v === "" ? null : Number(v) || null;
  const stats = { bench:num(bench), squat:num(squat), dead:num(dead), bodyweight:num(bw) };

  const generate = () => {
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
        <div style={{ fontSize:12, color:C.dim, marginBottom:12, textTransform:"uppercase", letterSpacing:0.5 }}>Build a mesocycle</div>

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

        <div style={{ fontSize:11, color:C.dim, marginBottom:6 }}>Strength stats — working weight or est. 1RM (kg). Used to seed barbell loads; leave blank to start those blank too.</div>
        <div style={{ display:"flex", gap:8, marginBottom:8 }}>
          <StatIn label="Bench" val={bench} onChange={setBench} />
          <StatIn label="Squat" val={squat} onChange={setSquat} />
          <StatIn label="Deadlift" val={dead} onChange={setDead} />
        </div>
        <StatIn label="Bodyweight" val={bw} onChange={setBw} wide />

        <button onClick={generate} style={{ ...btn(C.acc, "#04150E"), marginTop:14 }}>Generate programs</button>
      </div>

      {options && options.length > 0 && !preview && (
        <div style={{ marginTop:4 }}>
          <div style={{ fontSize:12, color:C.dim, margin:"16px 4px 4px", textTransform:"uppercase", letterSpacing:0.5 }}>{options.length} option{options.length>1?"s":""} for {days} days</div>
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
                return (
                  <div key={i} style={{ display:"flex", justifyContent:"space-between", fontSize:13, padding:"4px 0", borderBottom: i<d.items.length-1?`1px solid ${C.line}`:"none" }}>
                    <span>{ex ? ex.n : it.key}</span>
                    <span style={{ color:C.dim }}>{t.sets}×{reps}{t.w!=null ? ` · ${t.w}kg${it.est?"*":""}` : ""}</span>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ fontSize:11, color:C.dim, margin:"6px 4px" }}>* estimated starting load — confirm/adjust on first session. Set counts shown are week 1; they ramp up each week.</div>
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
function ProgramEditor({ program, setProgram, exByKey, openPicker, custom, removeCustom, exportJson, importJson, onReset, onAdvanceWeek, onExitMeso }) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const st = mesoStatus(program);
  const addDay = () => setProgram({ ...program, days: [...program.days, { id: uid(), name:"New day", items: [] }] });
  const rmDay = id => setProgram({ ...program, days: program.days.filter(d => d.id !== id) });
  const rename = (id, name) => setProgram({ ...program, days: program.days.map(d => d.id===id ? { ...d, name } : d) });
  const addItem = (dId, exKey) => setProgram({ ...program, days: program.days.map(d => d.id===dId ? { ...d, items: [...d.items, { key:exKey, target: T(3,8,12,null) }] } : d) });
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
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{st.splitName} · {st.goalLabel} · RIR {st.rir.lo}–{st.rir.hi}</div>
            </div>
            <div style={{ fontSize:11, color:C.dim, textAlign:"right" }}>{st.accumWeeks} accum<br/>+1 deload</div>
          </div>
          {(st.cardio || st.nutrition) && (
            <div style={{ marginTop:10, paddingTop:10, borderTop:`1px solid ${C.line}`, fontSize:12, color:C.dim, lineHeight:1.5 }}>
              {st.cardio && <div>Cardio: {st.cardio.note}</div>}
              {st.nutrition && <div>Calories: {st.nutrition.cal} · Protein: {st.nutrition.protein}</div>}
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
          <div style={{ fontSize:10, color:C.dim, marginTop:8 }}>Advancing recomputes set counts (volume ramp) and the RIR target. Your logged/edited weights are kept — load progression runs per-session.</div>
        </div>
      )}

      <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontSize:13, fontWeight:600 }}>Weekly target</div><div style={{ fontSize:11, color:C.dim }}>sessions per week</div></div>
        <input style={{ ...inp, width:60 }} inputMode="numeric" value={program.target} onChange={e => setProgram({ ...program, target: Number(e.target.value)||0 })} />
      </div>

      {program.days.map(d => (
        <div key={d.id} style={card}>
          <div style={{ display:"flex", gap:8, marginBottom:10 }}>
            <input style={{ ...inp, textAlign:"left", fontWeight:600 }} value={d.name} onChange={e => rename(d.id, e.target.value)} />
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

      {custom.length > 0 && (
        <div style={{ ...card, marginTop:20 }}>
          <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Your custom exercises</div>
          {custom.map(c => (
            <div key={c.key} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
              <div style={{ fontSize:13 }}>{c.n} <span style={{ color:C.dim, fontSize:11 }}>· {c.m} · {T_LABEL[c.t]}</span></div>
              <button onClick={() => removeCustom(c.key)} style={{ background:"transparent", border:`1px solid ${C.line}`, color:C.dim, borderRadius:6, padding:"2px 10px", cursor:"pointer", fontSize:12 }}>del</button>
            </div>
          ))}
        </div>
      )}

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
function Picker({ custom, onAddCustom, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const all = useMemo(() => [...LIB, ...custom], [custom]);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const filtered = all.filter(e => !ql || e.n.toLowerCase().includes(ql) || e.m.toLowerCase().includes(ql) || e.e.toLowerCase().includes(ql));
    const by = {}; filtered.forEach(e => { (by[e.m] = by[e.m] || []).push(e); });
    return MUSCLES.filter(m => by[m]).map(m => [m, by[m]]);
  }, [all, q]);

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
        <div style={{ overflowY:"auto", padding:14 }}>
          {adding
            ? <CustomForm onCancel={() => setAdding(false)} onSave={async ex => { const k = await onAddCustom(ex); onPick(k); }} />
            : <>
                {groups.map(([m, list]) => (
                  <div key={m} style={{ marginBottom:14 }}>
                    <div style={{ fontSize:11, color:C.dim, textTransform:"uppercase", letterSpacing:0.5, marginBottom:6 }}>{m}</div>
                    {list.map(e => (
                      <button key={e.key} onClick={() => onPick(e.key)} style={{ display:"flex", justifyContent:"space-between", width:"100%", background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", marginBottom:6, cursor:"pointer", textAlign:"left" }}>
                        <span style={{ fontSize:14 }}>{e.n}</span>
                        <span style={{ fontSize:11, color:C.dim }}>{e.e}{rpHint(e) ? " · " + rpHint(e) : ""}</span>
                      </button>
                    ))}
                  </div>
                ))}
                {groups.length === 0 && <Empty msg="No matches." />}
                <button onClick={() => setAdding(true)} style={{ ...btn(C.panel2, C.acc), border:`1px dashed ${C.line}`, marginTop:6 }}>+ create custom exercise</button>
              </>}
        </div>
      </div>
    </div>
  );
}
function CustomForm({ onCancel, onSave }) {
  const [n, setN] = useState(""); const [m, setM] = useState(MUSCLES[0]);
  const [e, setE] = useState("Barbell"); const [t, setT] = useState("wr"); const [role, setRole] = useState("compound");
  const sel = { background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 10px", fontSize:14, width:"100%" };
  const RP_RANGE = { heavy:[5,10], compound:[8,12], iso:[10,15], small:[12,20], rehab:[10,15] };
  return (
    <div>
      <label style={{ fontSize:11, color:C.dim }}>name</label>
      <input style={{ ...inp, textAlign:"left", marginBottom:10 }} value={n} onChange={ev => setN(ev.target.value)} autoFocus />
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
        <button onClick={() => n.trim() && onSave({ n: n.trim(), m, e, t, role, rp: RP_RANGE[role] })} style={btn(C.acc, "#04150E")}>Add & use</button>
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
function Line({ title, data, color, unit, header, embedded }) {
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
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.5" fill={color} />)}
          </svg>}
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
