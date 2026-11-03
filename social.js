/* ============================================================
   social.js — accounts and the shared workout feed (JSX, compiled
   in-browser by Babel). Loaded before app.js.

   Model
     - Your workouts still live on this phone (storage.js). Nothing
       is uploaded unless you post it.
     - Sign in with email and password (the gym app's own Supabase
       project; separate accounts from the habit app).
     - "Show me in the feed" is the account-level switch. While it's
       on you can post chosen workouts and you see everyone else who
       has it on. Turning it off hides your posts; it doesn't delete
       them.
     - A post is a copy of the workout at the time you posted it (or
       last edited it). No bodyweight, readiness, injuries, notes or
       check-ins go up.

   Uses app.js primitives (NavBar, Icon, Sheet, Switch, Empty,
   GroupLabel, C, cx, fmtDay, relDay, plural, fmtDur, setLine,
   workSets) at render time only, so load order is fine.
   Exposes window.GymSocial.
   ============================================================ */
(function () {
  /* ---- configuration: the gym app's Supabase project ----
     Supabase dashboard -> Project Settings -> API. The publishable key
     is meant to be public; row level security (gym_feed.sql) is what
     protects the data. Leave both blank to hide every social feature. */
  const SUPABASE_URL = "https://rbknnmdjolkvxyunzyzt.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_qgtg8SENItklehyL4CTrAA_bApyMDdY";

  const { useState, useEffect, useCallback, useRef } = React;
  const PAGE = 30;

  let sb = null;
  try {
    if (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient) {
      sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      });
    }
  } catch (e) { sb = null; }

  /* Supabase error -> sentence a person can act on */
  function errText(e) {
    const m = String((e && (e.message || e.error_description)) || e || "");
    if (/invalid login credentials/i.test(m)) return "That email and password don't match an account.";
    if (/email not confirmed/i.test(m)) return "Confirm your email first. The link is in your inbox.";
    if (/already registered|already exists/i.test(m)) return "There's already an account with that email. Sign in instead.";
    if (/password should be at least/i.test(m)) return "Use a password of at least 6 characters.";
    if (/rate limit|too many/i.test(m)) return "Too many attempts. Wait a minute and try again.";
    if (/signups not allowed|signup is disabled/i.test(m)) return "New accounts are switched off. Ask whoever runs the app to add you.";
    if (/failed to fetch|network|load failed/i.test(m)) return "No connection. Check your signal and try again.";
    if (/row-level security|violates/i.test(m)) return "Turn on Show me in the feed first.";
    return m || "Something went wrong. Try again.";
  }

  /* ============================================================
     useSocial: auth state, profile, which of your workouts are posted
     ============================================================ */
  function useSocial() {
    const [ready, setReady] = useState(!sb);
    const [user, setUser] = useState(null);
    const [profile, setProfile] = useState(null);        // null = no row yet
    const [profileLoaded, setProfileLoaded] = useState(false);
    const [posted, setPosted] = useState(() => new Set()); // your session ids that are in the feed

    useEffect(() => {
      if (!sb) return;
      let live = true;
      sb.auth.getSession().then(({ data }) => {
        if (!live) return;
        setUser((data && data.session && data.session.user) || null);
        setReady(true);
      }).catch(() => { if (live) setReady(true); });
      const { data } = sb.auth.onAuthStateChange((_ev, session) => {
        setUser(prev => {
          const next = (session && session.user) || null;
          return prev && next && prev.id === next.id ? prev : next;
        });
      });
      return () => { live = false; data && data.subscription && data.subscription.unsubscribe(); };
    }, []);

    const loadMine = useCallback(async uid => {
      const [p, ids] = await Promise.all([
        sb.from("gym_profiles").select("user_id, display_name, in_feed").eq("user_id", uid).maybeSingle(),
        sb.from("gym_posts").select("session_id").eq("user_id", uid)
      ]);
      if (!p.error) setProfile(p.data || null);
      if (!ids.error) setPosted(new Set((ids.data || []).map(r => r.session_id)));
      setProfileLoaded(true);
    }, []);

    useEffect(() => {
      if (!sb) return;
      if (!user) { setProfile(null); setPosted(new Set()); setProfileLoaded(false); return; }
      loadMine(user.id).catch(() => setProfileLoaded(true));
    }, [user, loadMine]);

    const signIn = useCallback(async (email, password) => {
      const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(errText(error));
    }, []);
    /* returns true when Supabase wants the email confirmed before first sign in */
    const signUp = useCallback(async (email, password) => {
      const { data, error } = await sb.auth.signUp({ email: email.trim(), password });
      if (error) throw new Error(errText(error));
      return !(data && data.session);
    }, []);
    const signOut = useCallback(async () => { await sb.auth.signOut(); }, []);
    const resetPassword = useCallback(async email => {
      const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: location.href.split("#")[0] });
      if (error) throw new Error(errText(error));
    }, []);

    /* patch: { display_name?, in_feed? } */
    const saveProfile = useCallback(async patch => {
      if (!user) throw new Error("Sign in first.");
      const row = { user_id: user.id, display_name: (patch.display_name != null ? patch.display_name : (profile && profile.display_name) || "").trim(),
        in_feed: patch.in_feed != null ? patch.in_feed : !!(profile && profile.in_feed), updated_at: new Date().toISOString() };
      if (!row.display_name) throw new Error("Add a name first.");
      const { data, error } = await sb.from("gym_profiles").upsert(row, { onConflict: "user_id" }).select("user_id, display_name, in_feed").single();
      if (error) throw new Error(errText(error));
      setProfile(data);
      return data;
    }, [user, profile]);

    const publish = useCallback(async (sessionId, payload) => {
      if (!user) throw new Error("Sign in first.");
      const { error } = await sb.from("gym_posts").upsert({
        user_id: user.id, session_id: sessionId, workout_date: payload.date,
        title: (payload.title || "Workout").slice(0, 120), data: payload, updated_at: new Date().toISOString()
      }, { onConflict: "user_id,session_id" });
      if (error) throw new Error(errText(error));
      setPosted(s => { const n = new Set(s); n.add(sessionId); return n; });
    }, [user]);

    const unpublish = useCallback(async sessionId => {
      if (!user) return;
      const { error } = await sb.from("gym_posts").delete().eq("user_id", user.id).eq("session_id", sessionId);
      if (error) throw new Error(errText(error));
      setPosted(s => { const n = new Set(s); n.delete(sessionId); return n; });
    }, [user]);

    /* one page of the feed, newest workout first */
    const fetchFeed = useCallback(async offset => {
      const { data, error } = await sb.from("gym_posts")
        .select("id, user_id, session_id, workout_date, title, data, created_at, gym_profiles(display_name)")
        .order("workout_date", { ascending: false }).order("created_at", { ascending: false })
        .range(offset, offset + PAGE - 1);
      if (error) throw new Error(errText(error));
      return data || [];
    }, []);

    return {
      enabled: !!sb, ready, user, profile, profileLoaded,
      inFeed: !!(user && profile && profile.in_feed),
      posted, signIn, signUp, signOut, resetPassword, saveProfile, publish, unpublish, fetchFeed
    };
  }

  const initial = name => (String(name || "?").trim()[0] || "?").toUpperCase();
  function Avatar({ name, you }) {
    return <div className={cx("avatar", you && "you")} aria-hidden="true">{initial(name)}</div>;
  }

  /* ============================================================
     Account sheet: sign in / create account, then name + feed switch
     ============================================================ */
  function AccountSheet({ social, onClose, flash }) {
    const [mode, setMode] = useState("in");       // in | up
    const [email, setEmail] = useState("");
    const [pw, setPw] = useState("");
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState("");
    const [info, setInfo] = useState("");
    const [name, setName] = useState("");
    const [confirmOut, setConfirmOut] = useState(false);
    const signedIn = !!social.user;
    useEffect(() => {
      if (signedIn && social.profileLoaded) setName((social.profile && social.profile.display_name) || (social.user.email || "").split("@")[0]);
    }, [signedIn, social.profileLoaded, social.profile, social.user]);

    const run = async fn => { setErr(""); setInfo(""); setBusy(true); try { await fn(); } catch (e) { setErr(e.message || String(e)); } finally { setBusy(false); } };
    const submit = () => run(async () => {
      if (!email.trim() || !pw) throw new Error("Enter your email and password.");
      if (mode === "in") { await social.signIn(email, pw); setPw(""); }
      else {
        const needsConfirm = await social.signUp(email, pw);
        setPw("");
        if (needsConfirm) { setMode("in"); setInfo("Check your email to confirm the account, then sign in here."); }
      }
    });
    const forgot = () => run(async () => {
      if (!email.trim()) throw new Error("Enter your email first.");
      await social.resetPassword(email);
      setInfo("Password reset email sent.");
    });

    if (!signedIn) {
      return (
        <Sheet title={mode === "in" ? "Sign in" : "Create account"} onClose={onClose}
          foot={<button className="btn btn-primary block" disabled={busy} onClick={submit}>{busy ? "One moment" : mode === "in" ? "Sign in" : "Create account"}</button>}>
          <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.45 }}>
            Your workouts stay on this phone. Only the ones you post are shared.
          </div>
          <label className="lbl" htmlFor="acc-email">Email</label>
          <input id="acc-email" className="field" type="email" autoComplete="email" inputMode="email" autoCapitalize="none" value={email} onChange={e => setEmail(e.target.value)} />
          <label className="lbl" htmlFor="acc-pw" style={{ marginTop: 14 }}>Password</label>
          <input id="acc-pw" className="field" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={pw}
            onChange={e => setPw(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()} />
          {err && <div className="field-err">{err}</div>}
          {info && <div className="small good" style={{ marginTop: 8 }}>{info}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14 }}>
            <button className="text-btn" onClick={() => { setMode(m => m === "in" ? "up" : "in"); setErr(""); setInfo(""); }}>
              {mode === "in" ? "Create an account" : "I have an account"}
            </button>
            {mode === "in" && <button className="text-btn" style={{ color: C.ink2 }} onClick={forgot}>Forgot password</button>}
          </div>
        </Sheet>
      );
    }

    const p = social.profile;
    const nameChanged = name.trim() && name.trim() !== ((p && p.display_name) || "");
    const toggleFeed = on => run(async () => {
      await social.saveProfile({ display_name: name, in_feed: on });
      flash(on ? "You're in the feed." : "You've left the feed. Your posts are hidden.");
    });
    return (
      <Sheet title="Account" onClose={onClose}>
        <div className="muted small" style={{ marginBottom: 4 }}>Signed in as {social.user.email}</div>
        <GroupLabel>Name in the feed</GroupLabel>
        <div style={{ display: "flex", gap: 8 }}>
          <input className="field" value={name} maxLength={40} placeholder="Your name" onChange={e => setName(e.target.value)} />
          {nameChanged && p && <button className="btn btn-primary btn-sm" style={{ minHeight: 44 }} disabled={busy}
            onClick={() => run(async () => { await social.saveProfile({ display_name: name }); flash("Name saved."); })}>Save</button>}
        </div>
        <div className="group" style={{ marginTop: 16, background: C.surface2 }}>
          <div className="row">
            <div className="row-main">
              <div className="row-title">Show me in the feed</div>
              <div className="row-sub">{social.inFeed ? "You see friends' posts and can post your own" : "Off: nobody sees your workouts and you don't see theirs"}</div>
            </div>
            <Switch label="Show me in the feed" on={social.inFeed} disabled={busy || !social.profileLoaded || !name.trim()} onChange={toggleFeed} />
          </div>
        </div>
        <div className="group-foot">
          Posting is per workout: you're asked after you finish one, and you can post or remove any workout from History. Posts show exercises, sets, duration and gym. Not bodyweight, readiness, injuries or notes.
        </div>
        {err && <div className="field-err" style={{ marginTop: 10 }}>{err}</div>}
        <button className="btn btn-secondary block" style={{ marginTop: 24 }} onClick={() => setConfirmOut(true)}>Sign out</button>
        {confirmOut && <ActionSheet onClose={() => setConfirmOut(false)} message="Sign out? Workouts on this phone stay. Your posts stay in the feed."
          actions={[{ label: "Sign out", danger: true, onClick: () => run(async () => { await social.signOut(); onClose(); }) }]} />}
      </Sheet>
    );
  }

  /* ============================================================
     Feed (History > Friends)
     ============================================================ */
  const fmtVol = v => v >= 10000 ? `${(v / 1000).toFixed(1)}t` : `${Math.round(v).toLocaleString()} kg`;
  function postMeta(d) {
    return [d.durationMin != null ? fmtDur(d.durationMin) : null, d.sets ? plural(d.sets, "set") : null,
      d.volume > 0 ? fmtVol(d.volume) : null, d.gym || null].filter(Boolean).join(", ");
  }
  /* one line per exercise: "Bench Press, 3 sets, best 80 kg × 8" */
  function exLine(e) {
    const work = workSets(e.sets || []);
    const n = plural(work.length || (e.sets || []).length, "set");
    if (e.t === "wr" && work.length) {
      const best = work.slice().sort((a, b) => ((b.w || 0) - (a.w || 0)) || ((b.r || 0) - (a.r || 0)))[0];
      return `${n}, top ${setLine("wr", best, e.key).replace(/, RPE.*$/, "")}`;
    }
    if (e.t === "rep" && work.length) return `${n}, best ${plural(Math.max(...work.map(s => s.r || 0)), "rep")}`;
    if (e.t === "cardio") {
      const min = (e.sets || []).reduce((a, s) => a + (s.min || 0), 0), km = (e.sets || []).reduce((a, s) => a + (s.dist || 0), 0);
      return [min ? `${min} min` : null, km ? `${Math.round(km * 10) / 10} km` : null].filter(Boolean).join(", ") || n;
    }
    return n;
  }

  function FeedCard({ post, you, onOpen }) {
    const d = post.data || {};
    const name = you ? "You" : (post.gym_profiles && post.gym_profiles.display_name) || "Someone";
    const ents = d.entries || [];
    return (
      <button className="feed-card" onClick={onOpen}>
        <div className="feed-head">
          <Avatar name={you ? (post.gym_profiles && post.gym_profiles.display_name) || "You" : name} you={you} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="feed-name">{name}</div>
            <div className="feed-when">{relDay(post.workout_date)}</div>
          </div>
          {d.prs > 0 && <span className="tag pr">{d.prs === 1 ? "PR" : `${d.prs} PRs`}</span>}
        </div>
        <div className="feed-title">{post.title}</div>
        <div className="feed-meta">{postMeta(d)}</div>
        {ents.length > 0 && (
          <div className="feed-ex">
            {ents.slice(0, 4).map((e, i) => (
              <div key={i} className="feed-ex-row">
                <span className="feed-ex-name">{e.name}{e.pr && <span className="acc"> PR</span>}</span>
                <span className="feed-ex-val num-t">{exLine(e)}</span>
              </div>
            ))}
            {ents.length > 4 && <div className="feed-more">{plural(ents.length - 4, "more exercise")}</div>}
          </div>
        )}
      </button>
    );
  }

  function FeedDetail({ post, you, onBack, onRemove }) {
    const d = post.data || {};
    const name = you ? "You" : (post.gym_profiles && post.gym_profiles.display_name) || "Someone";
    const [confirm, setConfirm] = useState(false);
    const gl = {}; let gn = 0; const seen = {};
    (d.entries || []).forEach(e => { if (e.group && !(e.group in gl)) gl[e.group] = gn++; });
    return (
      <div>
        <NavBar title="" onBack={onBack} backLabel="Friends" />
        <div className="feed-head" style={{ marginTop: 6 }}>
          <Avatar name={you ? (post.gym_profiles && post.gym_profiles.display_name) || "You" : name} you={you} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="feed-name">{name}</div>
            <div className="feed-when">{fmtDay(post.workout_date)}</div>
          </div>
        </div>
        <div className="page-head"><h2>{post.title}</h2>{d.gym && <div className="sub">{d.gym}</div>}</div>
        <div className="stats">
          <div><div className="v">{d.durationMin != null ? fmtDur(d.durationMin) : "–"}</div><div className="k">Duration</div></div>
          <div><div className="v">{d.sets || 0}</div><div className="k">Working sets</div></div>
          <div><div className="v">{d.volume > 0 ? Math.round(d.volume).toLocaleString() : "–"}</div><div className="k">Volume, kg</div></div>
        </div>
        {(d.entries || []).map((e, idx) => {
          let tag = null;
          if (e.group && e.group in gl) { seen[e.group] = (seen[e.group] || 0) + 1; tag = String.fromCharCode(65 + gl[e.group]) + seen[e.group]; }
          let n = 0;
          return (
            <div key={idx} className={cx("chart", tag && "ex ss")} style={{ marginTop: 12 }}>
              <div className="ex-name">{tag && <span className="ex-tag">{tag}</span>}{e.name}{e.pr && <> <span className="tag pr">PR</span></>}</div>
              <table className="set-table" style={{ marginTop: 8 }}>
                <tbody>
                  {(e.sets || []).map((s, i) => {
                    if (!s.drop) n++;
                    return (
                      <tr key={i}>
                        <td className="n" style={s.drop ? { color: C.warn, fontSize: 12, fontWeight: 600 } : null}>{s.drop ? "Drop" : n}</td>
                        <td>{setLine(e.t, s, e.key)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {you && onRemove && <button className="btn btn-secondary block" style={{ marginTop: 24 }} onClick={() => setConfirm(true)}>Remove from feed</button>}
        {confirm && <ActionSheet onClose={() => setConfirm(false)} message="Remove this workout from the feed? It stays in your History."
          actions={[{ label: "Remove from feed", danger: true, onClick: onRemove }]} />}
      </div>
    );
  }

  /* everything under History > Friends. Returns its own detail page
     when a post is open (the caller hides its own header then). */
  function FriendsFeed({ social, onAccount, flash, onDetail }) {
    const [posts, setPosts] = useState([]);
    const [state, setState] = useState("idle"); // idle | loading | error
    const [err, setErr] = useState("");
    const [more, setMore] = useState(false);
    const [open, setOpen] = useState(null);
    const lastLoad = useRef(0);

    const load = useCallback(async (append) => {
      setState("loading"); setErr("");
      try {
        const rows = await social.fetchFeed(append ? posts.length : 0);
        setPosts(p => append ? [...p, ...rows.filter(r => !p.some(x => x.id === r.id))] : rows);
        setMore(rows.length === PAGE);
        setState("idle"); lastLoad.current = Date.now();
      } catch (e) { setErr(e.message || String(e)); setState("error"); }
    }, [social.fetchFeed, posts.length]);

    const inFeed = social.inFeed;
    useEffect(() => { if (inFeed) load(false); else setPosts([]); /* eslint-disable-next-line */ }, [inFeed, social.posted]);
    // come back to the app after a while: refresh
    useEffect(() => {
      if (!inFeed) return;
      const on = () => { if (document.visibilityState === "visible" && Date.now() - lastLoad.current > 60000) load(false); };
      document.addEventListener("visibilitychange", on);
      return () => document.removeEventListener("visibilitychange", on);
    }, [inFeed, load]);
    useEffect(() => { onDetail && onDetail(!!open); }, [open, onDetail]);

    if (!social.ready) return <div className="muted" style={{ padding: "40px 0", textAlign: "center" }}>Loading</div>;
    if (!social.user) {
      return <Empty title="See what your friends lifted" msg="Sign in or create an account. Your own workouts stay on this phone unless you post them."
        action={<button className="btn btn-primary" onClick={onAccount}>Sign in</button>} />;
    }
    if (!social.profileLoaded) return <div className="muted" style={{ padding: "40px 0", textAlign: "center" }}>Loading</div>;
    if (!inFeed) {
      return <Empty title="You're not in the feed" msg="Turn on Show me in the feed to see friends' workouts and post your own. Only people who have it on can see posts."
        action={<button className="btn btn-primary" onClick={onAccount}>Feed settings</button>} />;
    }

    if (open) {
      const you = open.user_id === social.user.id;
      return <FeedDetail post={open} you={you} onBack={() => { setOpen(null); window.scrollTo(0, 0); }}
        onRemove={you ? async () => {
          try { await social.unpublish(open.session_id); setOpen(null); flash("Removed from the feed."); }
          catch (e) { flash(e.message || String(e)); }
        } : null} />;
    }

    const groups = [];
    posts.forEach(p => {
      const g = groups[groups.length - 1];
      const label = relDay(p.workout_date);
      if (g && g.label === label) g.items.push(p); else groups.push({ label, items: [p] });
    });
    return (
      <div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="text-btn" disabled={state === "loading"} onClick={() => load(false)}>{state === "loading" ? "Refreshing" : "Refresh"}</button>
        </div>
        {state === "error" && <div className="banner" role="alert"><div style={{ flex: 1 }}>{err}</div></div>}
        {posts.length === 0 && state !== "loading" && state !== "error" && (
          <Empty title="Nothing posted yet" msg="When you or a friend posts a workout it shows up here. Post one of yours from History." />
        )}
        {groups.map(g => (
          <div key={g.label + g.items[0].id}>
            <GroupLabel>{g.label}</GroupLabel>
            {g.items.map(p => <FeedCard key={p.id} post={p} you={p.user_id === social.user.id} onOpen={() => { setOpen(p); window.scrollTo(0, 0); }} />)}
          </div>
        ))}
        {more && <button className="btn btn-secondary block" style={{ marginTop: 16 }} disabled={state === "loading"} onClick={() => load(true)}>Show older</button>}
      </div>
    );
  }

  window.GymSocial = { useSocial, AccountSheet, FriendsFeed, Avatar };
})();
