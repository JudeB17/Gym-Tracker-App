/* ============================================================
   app.js — Load/Log gym tracker (JSX, compiled in-browser by Babel)
   Depends on: window.GymData, window.GymStore
   ============================================================ */
const { useState, useEffect, useMemo, useCallback, useRef } = React;
const { MUSCLES, LIB, T, rpHint, defaultProgram } = window.GymData;
const { sGet, sSet, sDel, available } = window.GymStore;

/* ---------- theme ---------- */
const C = {
  bg: "#0E1116", panel: "#151A21", panel2: "#1C232C", line: "#2A323C",
  ink: "#E7ECF2", dim: "#7C8794", acc: "#4DD6A6", blue: "#5BA8F5",
  warn: "#E56B6B", knee: "#E56B6B", gold: "#E5B86B"
};
const card = { background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginTop: 12 };
const inp = { background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 15, width: "100%", textAlign: "center", outline: "none" };
const btn = (bg, fg) => ({ background: bg, color: fg, border: "none", borderRadius: 10, padding: "11px 14px", fontSize: 14, fontWeight: 600, width: "100%", cursor: "pointer" });
const T_LABEL = { wr: "weight×reps", rep: "reps", time: "hold", wd: "load+dist", cardio: "cardio" };

/* ---------- helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const TODAY = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const e1rm = (w, r) => (!w || !r) ? 0 : w * (1 + r / 30); // Epley
function blankSet(t) {
  return { wr:{w:"",r:"",rpe:""}, rep:{r:"",rpe:""}, time:{sec:""}, wd:{w:"",dist:""}, cardio:{sec:"",dist:""} }[t];
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
      } catch (e) {
        setLoadErr((e && e.message) ? ("Load error: " + e.message) : ("Load error: " + String(e)));
        const p = defaultProgram();
        setProgram(p); setActiveDayId(p.days[0].id); setCustom([]); setSessions([]); setInjuries([]);
      } finally { done = true; clearTimeout(watchdog); setLoading(false); }
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

  const effectiveTargetW = useCallback((key, target) => {
    // auto-bump: if last session hit top of rep range on all sets, nudge target weight
    if (!target || target.w == null) return target ? target.w : null;
    const prev = lastForExercise(key);
    if (!prev || !prev.length) return target.w;
    const top = target.repHi || target.repLo;
    const allHit = prev.every(s => (s.r || 0) >= top && (s.w || 0) >= target.w);
    if (allHit) { const inc = target.w >= 60 ? 2.5 : target.w >= 20 ? 2 : 1; return Math.round((target.w + inc) * 2) / 2; }
    return target.w;
  }, [lastForExercise]);

  /* ---- session lifecycle ---- */
  const startSession = useCallback(() => {
    const day = program.days.find(d => d.id === activeDayId);
    if (!day) return;
    setDraft({
      id: uid(), date: TODAY(), dayId: day.id, dayName: day.name, bodyweight: "",
      injuries: injuries.filter(i => !i.closed).map(i => ({ name: i.name, pain: 0, swelling: false, note: "" })),
      entries: day.items.map(it => {
        const ex = exByKey(it.key); if (!ex) return null;
        const tw = effectiveTargetW(it.key, it.target);
        const nSets = it.target?.sets || 1;
        return { eid: uid(), key: it.key, name: ex.n, t: ex.t, note: "",
          target: { ...it.target, w: tw },
          sets: Array.from({ length: nSets }, () => blankSet(ex.t)) };
      }).filter(Boolean)
    });
    setViewSession(null); setTab("log");
  }, [program, activeDayId, exByKey, effectiveTargetW, injuries]);

  const addExerciseToDraft = useCallback(exKey => {
    const ex = exByKey(exKey); if (!ex) return;
    setDraft(d => ({ ...d, entries: [...d.entries, { eid: uid(), key: exKey, name: ex.n, t: ex.t, note: "", target: null, sets: [blankSet(ex.t)] }] }));
  }, [exByKey]);

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
    setDraft(null); setTab("history"); flash(existingIdx >= 0 ? "Updated." : "Saved.");
  }, [draft, sessions, flash]);

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
    const draftFromSession = {
      id: session.id, date: session.date, dayId: session.dayId, dayName: session.dayName,
      bodyweight: toStr(session.bodyweight),
      injuries: (session.injuries || []).map(i => ({ name: i.name, pain: i.pain || 0, swelling: !!i.swelling, note: i.note || "" })),
      entries: session.entries.map(e => ({
        eid: uid(), key: e.key, name: e.name, t: e.t, note: e.note || "", target: null,
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
  }, []);

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
      <Header tab={tab} setTab={setTab} />
      {errBanner}
      <div style={{ padding: "0 14px 90px" }}>
        {tab === "log" && (
          draft
            ? <DraftView draft={draft} setDraft={setDraft} onSave={saveSession} onDiscard={() => setDraft(null)}
                lastForExercise={lastForExercise} exByKey={exByKey}
                onAddExercise={() => openPicker(k => { addExerciseToDraft(k); setPicker(null); })} />
            : <StartView program={program} activeDayId={activeDayId} setActiveDayId={setActiveDayId} onStart={startSession} sessions={sessions} />
        )}
        {tab === "history" && (
          viewSession
            ? <SessionDetail session={viewSession} onBack={() => setViewSession(null)} onDelete={deleteSession} onEdit={editSession} exByKey={exByKey} />
            : <HistoryList sessions={sessions} onOpen={setViewSession} />
        )}
        {tab === "progress" && <Progress sessions={sessions} allEx={allEx} />}
        {tab === "trends" && <Trends sessions={sessions} />}
        {tab === "injury" && <InjuryTab injuries={injuries} saveInjuries={saveInjuries} sessions={sessions} />}
        {tab === "program" && <ProgramEditor program={program} setProgram={saveProgram} exByKey={exByKey}
          openPicker={openPicker} custom={custom} removeCustom={removeCustom}
          exportJson={exportJson} importJson={importJson} onReset={resetProgram} />}
      </div>
      {picker && <Picker custom={custom} onAddCustom={addCustom} onPick={picker.onPick} onClose={() => setPicker(null)} />}
      {toast && <div style={{ position:"fixed", bottom:84, left:"50%", transform:"translateX(-50%)", background:C.panel2, color:C.ink, border:`1px solid ${C.line}`, borderRadius:20, padding:"8px 18px", fontSize:13, zIndex:50 }}>{toast}</div>}
    </Shell>
  );
}

/* ============================================================
   Shell + nav
   ============================================================ */
function Shell({ children }) {
  return <div style={{ maxWidth: 520, margin: "0 auto", minHeight: "100vh", background: C.bg, color: C.ink, fontFamily: "system-ui,-apple-system,sans-serif" }}>{children}</div>;
}
function Header({ tab, setTab }) {
  const tabs = [["log","Log"],["history","History"],["progress","Progress"],["trends","Trends"],["injury","Injury"],["program","Program"]];
  return (
    <div style={{ position:"sticky", top:0, zIndex:40, background:C.bg, borderBottom:`1px solid ${C.line}` }}>
      <div style={{ padding:"14px 16px 8px", fontSize:20, fontWeight:800, letterSpacing:1 }}>GYM</div>
      <div style={{ display:"flex", overflowX:"auto", gap:4, padding:"0 10px 8px" }}>
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{
            background: tab===k ? C.panel2 : "transparent", color: tab===k ? C.acc : C.dim,
            border: tab===k ? `1px solid ${C.line}` : "1px solid transparent",
            borderRadius:8, padding:"6px 12px", fontSize:13, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>{label}</button>
        ))}
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
  return (
    <div>
      <div style={{ ...card, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div><div style={{ fontSize:13, color:C.dim }}>This week</div>
          <div style={{ fontSize:22, fontWeight:700 }}>{doneThisWeek}<span style={{ fontSize:14, color:C.dim }}> / {program.target}</span></div></div>
        <div style={{ fontSize:11, color:C.dim, textAlign:"right" }}>sessions logged<br/>vs weekly target</div>
      </div>
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Start a session</div>
        {program.days.map(d => (
          <button key={d.id} onClick={() => setActiveDayId(d.id)} style={{
            display:"flex", justifyContent:"space-between", alignItems:"center", width:"100%",
            background: activeDayId===d.id ? C.panel2 : C.bg, color:C.ink,
            border:`1px solid ${activeDayId===d.id ? C.acc : C.line}`, borderRadius:10, padding:"12px 14px",
            marginBottom:8, cursor:"pointer", textAlign:"left" }}>
            <span style={{ fontWeight:600 }}>{d.name}</span>
            <span style={{ fontSize:11, color:C.dim }}>{d.items.length} exercises</span>
          </button>
        ))}
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

  return (
    <div>
      <div style={{ ...card, display:"flex", gap:10, alignItems:"center" }}>
        <div style={{ flex:1 }}>
          <input style={{ ...inp, textAlign:"left", fontWeight:700, fontSize:16, padding:"4px 8px" }} value={draft.dayName}
            onChange={e => setDraft(d => ({ ...d, dayName: e.target.value }))} />
          <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{draft.date} · long-press ⠿ to reorder · rename above (program unchanged)</div>
        </div>
        <div style={{ width:120 }}>
          <label style={{ fontSize:10, color:C.dim }}>bodyweight kg</label>
          <input style={inp} inputMode="decimal" value={draft.bodyweight} placeholder="—"
            onChange={e => setDraft(d => ({ ...d, bodyweight: e.target.value }))} />
        </div>
      </div>

      <DragList
        items={draft.entries}
        keyOf={e => e.eid || e.key}
        onMove={moveEntry}
        render={(e, i, dragHandle) => (
          <ExerciseCard entry={e} setEntry={setEntry} rmEntry={rmEntry} prev={lastForExercise(e.key)} ex={exByKey(e.key)} dragHandle={dragHandle} />
        )}
      />

      <button onClick={onAddExercise} style={{ ...btn(C.panel2, C.acc), marginTop:12, border:`1px dashed ${C.line}` }}>+ add exercise from library</button>

      <DraftInjuries draft={draft} setDraft={setDraft} />

      <div style={{ display:"flex", gap:10, marginTop:16 }}>
        <button style={{ ...btn(C.panel2, C.dim), flex:"0 0 90px" }} onClick={onDiscard}>Discard</button>
        <button style={btn(C.acc, "#04150E")} onClick={onSave}>Save session</button>
      </div>
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

function ExerciseCard({ entry, setEntry, rmEntry, prev, ex, dragHandle }) {
  const blank = blankSet(entry.t);
  const addSet = () => setEntry(entry.eid, e => ({ ...e, sets: [...e.sets, { ...(e.sets[e.sets.length-1] || blank) }] }));
  const rmSet = i => setEntry(entry.eid, e => ({ ...e, sets: e.sets.filter((_, j) => j !== i) }));
  const upd = (i, k, v) => setEntry(entry.eid, e => ({ ...e, sets: e.sets.map((s, j) => j===i ? { ...s, [k]: v } : s) }));
  const setNote = v => setEntry(entry.eid, e => ({ ...e, note: v }));

  const cols = { wr:["kg","reps","rpe"], rep:["reps","rpe"], time:["sec"], wd:["kg","dist m"], cardio:["min","dist km"] }[entry.t];
  const keys = { wr:["w","r","rpe"], rep:["r","rpe"], time:["sec"], wd:["w","dist"], cardio:["sec","dist"] }[entry.t];
  const grid = `22px ${cols.map(() => "1fr").join(" ")} 24px`;
  const hint = targetHint(entry.t, entry.target);
  const rp = rpHint(ex);
  const prevStr = prev ? prevSummary(entry.t, prev) : null;
  const ph = k => { const t = entry.target; if (!t) return "—"; if (k==="w") return t.w!=null ? String(t.w) : "—"; if (k==="r") return t.repLo ? String(t.repLo) : "—"; return "—"; };

  return (
    <div style={card}>
      <div style={{ display:"flex", alignItems:"center", gap:4 }}>
        {dragHandle}
        <div style={{ flex:1 }}>
          <div style={{ fontSize:14, fontWeight:600 }}>{entry.name} <span style={{ fontSize:10, color:C.dim, fontWeight:400 }}>· {T_LABEL[entry.t]}</span></div>
          <div style={{ display:"flex", gap:8, marginTop:2, flexWrap:"wrap" }}>
            {hint && <span style={{ fontSize:11, color:C.acc }}>{hint}</span>}
            {rp && <span style={{ fontSize:11, color:C.dim }}>{rp}</span>}
          </div>
          {prevStr && <div style={{ fontSize:10, color:C.dim, marginTop:2 }}>last: {prevStr}</div>}
        </div>
        <button onClick={() => rmEntry(entry.eid)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:13 }}>remove</button>
      </div>

      <div style={{ marginTop:10 }}>
        <div style={{ display:"grid", gridTemplateColumns:grid, gap:6, fontSize:10, color:C.dim, marginBottom:4, textAlign:"center" }}>
          <span>#</span>{cols.map(c => <span key={c}>{c}</span>)}<span/>
        </div>
        {entry.sets.map((s, i) => (
          <div key={i} style={{ display:"grid", gridTemplateColumns:grid, gap:6, marginBottom:6, alignItems:"center" }}>
            <span style={{ fontSize:12, color:C.dim, textAlign:"center" }}>{i+1}</span>
            {keys.map(k => <input key={k} style={inp} inputMode="decimal" value={s[k]} placeholder={ph(k)} onChange={e => upd(i, k, e.target.value)} />)}
            <button onClick={() => rmSet(i)} style={{ background:"transparent", border:"none", color:C.dim, cursor:"pointer", fontSize:16 }}>×</button>
          </div>
        ))}
        <button onClick={addSet} style={{ background:"transparent", border:`1px dashed ${C.line}`, color:C.acc, borderRadius:8, padding:"6px 0", fontSize:12, width:"100%", cursor:"pointer" }}>+ set</button>
      </div>

      <input style={{ ...inp, textAlign:"left", marginTop:8, fontSize:13 }} value={entry.note || ""} placeholder="note (form cue, pain, tempo…)" onChange={e => setNote(e.target.value)} />
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
  if (sessions.length === 0) return <Empty msg="No sessions logged yet. Start one from the Log tab." />;
  const rev = sessions.slice().reverse();
  return (
    <div>
      {rev.map(s => {
        const totalSets = s.entries.reduce((a, e) => a + e.sets.length, 0);
        const vol = s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w||0)*(x.r||0), 0), 0);
        return (
          <button key={s.id} onClick={() => onOpen(s)} style={{ ...card, width:"100%", textAlign:"left", cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600 }}>{s.dayName}</div>
              <div style={{ fontSize:11, color:C.dim, marginTop:2 }}>{s.date} · {s.entries.length} exercises · {totalSets} sets</div>
            </div>
            <div style={{ textAlign:"right" }}>
              {vol > 0 && <div style={{ fontSize:13, fontWeight:700, color:C.blue }}>{Math.round(vol).toLocaleString()}<span style={{ fontSize:10, color:C.dim }}> kg·r</span></div>}
              {(s.injuries||[]).length > 0 && <div style={{ fontSize:10, color:C.knee, marginTop:2 }}>{s.injuries.length} injury note{s.injuries.length>1?"s":""}</div>}
            </div>
          </button>
        );
      })}
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
          <div style={{ fontSize:11, color:C.dim }}>{session.date}{session.bodyweight!=null ? ` · BW ${session.bodyweight}kg` : ""}</div>
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
function Progress({ sessions, allEx }) {
  const exMap = useMemo(() => {
    const m = new Map(); allEx.forEach(e => m.set(e.key, e));
    sessions.forEach(s => s.entries.forEach(e => { if (!m.has(e.key)) m.set(e.key, { key:e.key, n:e.name, t:e.t }); }));
    return m;
  }, [allEx, sessions]);
  const logged = useMemo(() => {
    const set = new Set(); sessions.forEach(s => s.entries.forEach(e => set.add(e.key)));
    return [...set].map(k => exMap.get(k)).filter(Boolean).sort((a, b) => a.n.localeCompare(b.n));
  }, [sessions, exMap]);
  const [exKey, setExKey] = useState(null);
  const picked = exKey ?? logged[0]?.key;
  const ex = picked ? exMap.get(picked) : null;

  const history = useMemo(() => {
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
  }, [sessions, picked, ex]);

  const series = history.filter(h => h.metric > 0).map(h => ({ date: h.date, v: h.metric }));
  const unit = ex ? ({ wr:"kg e1RM", rep:"reps", time:"s", wd:"kg", cardio:"km" }[ex.t]) : "";

  if (logged.length === 0) return <Empty msg="Log sessions and per-exercise progress appears here." />;
  const first = series[0]?.v, last = series[series.length-1]?.v;
  const delta = (first && last) ? Math.round((last - first) / first * 1000)/10 : null;

  return (
    <div>
      <div style={{ ...card, display:"flex", gap:10, alignItems:"center" }}>
        <select value={picked || ""} onChange={e => setExKey(e.target.value)} style={{ flex:1, background:C.bg, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 10px", fontSize:14 }}>
          {logged.map(e => <option key={e.key} value={e.key}>{e.n}</option>)}
        </select>
      </div>
      {series.length > 0 && (
        <Stat row={[
          ["Sessions", history.length],
          ["Best", Math.max(...series.map(s => s.v)) + (unit==="kg e1RM" ? "" : "")],
          ["Change", delta!=null ? (delta >= 0 ? "+" : "") + delta + "%" : "—"]
        ]} />
      )}
      <Line title="Progression" data={series} color={C.acc} unit={unit} />
      <div style={{ ...card }}>
        <div style={{ fontSize:12, color:C.dim, marginBottom:10, textTransform:"uppercase", letterSpacing:0.5 }}>Every session</div>
        {history.slice().reverse().map((h, i) => (
          <div key={i} style={{ padding:"8px 0", borderBottom: i < history.length-1 ? `1px solid ${C.line}` : "none" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline" }}>
              <span style={{ fontSize:13, fontWeight:600 }}>{h.date}</span>
              <span style={{ fontSize:13, color:C.acc, fontWeight:700 }}>{h.label}</span>
            </div>
            <div style={{ fontSize:12, color:C.dim, marginTop:3 }}>{prevSummary(h.t, h.sets)}</div>
            {h.note && <div style={{ fontSize:12, color:C.gold, marginTop:3, fontStyle:"italic" }}>“{h.note}”</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============================================================
   Trends — aggregate (volume / bodyweight / frequency)
   ============================================================ */
function Trends({ sessions }) {
  const weekCounts = useMemo(() => {
    const m = {}; sessions.forEach(s => { const w = isoWeek(s.date); m[w] = (m[w]||0)+1; });
    return Object.entries(m).sort();
  }, [sessions]);
  const volSeries = useMemo(() => sessions.map(s => ({ date:s.date, v: s.entries.reduce((a, e) => a + e.sets.reduce((b, x) => b + (x.w||0)*(x.r||0), 0), 0) })).filter(d => d.v > 0), [sessions]);
  const bwSeries = useMemo(() => sessions.filter(s => s.bodyweight != null).map(s => ({ date:s.date, v:s.bodyweight })), [sessions]);
  if (sessions.length === 0) return <Empty msg="Log sessions and trends appear here." />;
  return (
    <div>
      <Stat row={[["Sessions", sessions.length], ["Weeks active", weekCounts.length], ["Avg/wk", weekCounts.length ? (sessions.length/weekCounts.length).toFixed(1) : "0"]]} />
      <Line title="Session volume (kg·reps)" data={volSeries} color={C.blue} unit="" />
      {bwSeries.length > 0 && <Line title="Bodyweight" data={bwSeries} color={C.warn} unit="kg" />}
      <Bars title="Sessions per week" data={weekCounts} />
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
   Program editor — drag reorder of exercises within a day
   ============================================================ */
function ProgramEditor({ program, setProgram, exByKey, openPicker, custom, removeCustom, exportJson, importJson, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false);
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
