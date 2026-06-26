/* ============================================================
   data.js — exercise library, RP rep-range model, default program,
   + RP-style mesocycle generator (volume landmarks, split templates,
     %1RM weight seeding, weekly set ramp, fixed deload).
   Loaded as a plain <script> before app.js. Exposes window.GymData.
   ============================================================ */
(function () {
  const MUSCLES = ["Chest","Back","Shoulders","Quads","Hamstrings","Glutes","Calves","Biceps","Triceps","Core","Forearms","Cardio","Mobility/Rehab"];

  /* RP-style rep ranges by movement role (Israetel/Renaissance Periodization
     hypertrophy framing): heavy compounds live lower, isolations higher.
     role -> [repLo, repHi]. These are shown as a reference hint when logging;
     they do NOT overwrite your own per-exercise targets. */
  const RP_RANGE = {
    heavy:   [5, 10],   // primary barbell compounds (bench, squat, deadlift, row, OHP)
    compound:[8, 12],   // secondary compounds, presses, machine compounds
    iso:     [10, 15],  // single-joint isolation
    small:   [12, 20],  // small muscles: rear delt, calves, forearms, abs
    rehab:   [10, 15]
  };

  /* exercise rows: n=name, m=muscle, e=equipment, t=logType, role=RP role.
     logType: wr weight×reps×rpe | rep bodyweight reps | time hold | wd load+dist | cardio */
  const RAW = [
    // ---- Chest ----
    ["Barbell Bench Press","Chest","Barbell","wr","heavy"],
    ["Incline Barbell Bench","Chest","Barbell","wr","heavy"],
    ["Decline Barbell Bench","Chest","Barbell","wr","compound"],
    ["Smith Machine Bench","Chest","Machine","wr","compound"],
    ["Dumbbell Bench Press","Chest","Dumbbell","wr","compound"],
    ["Incline Dumbbell Press","Chest","Dumbbell","wr","compound"],
    ["Dumbbell Fly","Chest","Dumbbell","wr","iso"],
    ["Incline Dumbbell Fly","Chest","Dumbbell","wr","iso"],
    ["Cable Fly","Chest","Cable","wr","iso"],
    ["Low-to-High Cable Fly","Chest","Cable","wr","iso"],
    ["Cable Crossover","Chest","Cable","wr","iso"],
    ["Machine Chest Press","Chest","Machine","wr","compound"],
    ["Incline Machine Press","Chest","Machine","wr","compound"],
    ["Pec Deck","Chest","Machine","wr","iso"],
    ["Push-up","Chest","Bodyweight","rep","compound"],
    ["Deficit Push-up","Chest","Bodyweight","rep","compound"],
    ["Dips (Chest)","Chest","Bodyweight","rep","compound"],
    // ---- Back ----
    ["Deadlift","Back","Barbell","wr","heavy"],
    ["Barbell Row","Back","Barbell","wr","heavy"],
    ["Pendlay Row","Back","Barbell","wr","heavy"],
    ["Meadows Row","Back","Barbell","wr","compound"],
    ["T-Bar Row","Back","Machine","wr","compound"],
    ["Dumbbell Row","Back","Dumbbell","wr","compound"],
    ["Chest-Supported Row","Back","Machine","wr","compound"],
    ["Seal Row","Back","Barbell","wr","compound"],
    ["Seated Cable Row","Back","Cable","wr","compound"],
    ["Lat Pulldown","Back","Cable","wr","compound"],
    ["Wide-Grip Pulldown","Back","Cable","wr","compound"],
    ["Neutral-Grip Pulldown","Back","Cable","wr","compound"],
    ["Pull-up","Back","Bodyweight","rep","compound"],
    ["Chin-up","Back","Bodyweight","rep","compound"],
    ["Straight-Arm Pulldown","Back","Cable","wr","iso"],
    ["Rack Pull","Back","Barbell","wr","heavy"],
    ["Face Pull","Back","Cable","wr","small"],
    ["Machine Row","Back","Machine","wr","compound"],
    // ---- Shoulders ----
    ["Overhead Press","Shoulders","Barbell","wr","heavy"],
    ["Push Press","Shoulders","Barbell","wr","compound"],
    ["Seated DB Shoulder Press","Shoulders","Dumbbell","wr","compound"],
    ["Arnold Press","Shoulders","Dumbbell","wr","compound"],
    ["Machine Shoulder Press","Shoulders","Machine","wr","compound"],
    ["Lateral Raise","Shoulders","Dumbbell","wr","small"],
    ["Cable Lateral Raise","Shoulders","Cable","wr","small"],
    ["Machine Lateral Raise","Shoulders","Machine","wr","small"],
    ["Rear Delt Fly","Shoulders","Dumbbell","wr","small"],
    ["Reverse Pec Deck","Shoulders","Machine","wr","small"],
    ["Front Raise","Shoulders","Dumbbell","wr","small"],
    ["Cuban Press","Shoulders","Dumbbell","wr","small"],
    ["Upright Row","Shoulders","Barbell","wr","iso"],
    ["Barbell Shrug","Shoulders","Barbell","wr","iso"],
    ["Dumbbell Shrug","Shoulders","Dumbbell","wr","iso"],
    // ---- Quads ----
    ["Back Squat","Quads","Barbell","wr","heavy"],
    ["Front Squat","Quads","Barbell","wr","heavy"],
    ["Zercher Squat","Quads","Barbell","wr","compound"],
    ["Hack Squat","Quads","Machine","wr","compound"],
    ["Leg Press","Quads","Machine","wr","compound"],
    ["Pendulum Squat","Quads","Machine","wr","compound"],
    ["Leg Extension","Quads","Machine","wr","iso"],
    ["Goblet Squat","Quads","Dumbbell","wr","compound"],
    ["Bulgarian Split Squat","Quads","Dumbbell","wr","compound"],
    ["Walking Lunge","Quads","Dumbbell","wr","compound"],
    ["Step-up","Quads","Dumbbell","wr","compound"],
    ["Sissy Squat","Quads","Bodyweight","rep","iso"],
    ["Wall Sit","Quads","Bodyweight","time","rehab"],
    ["Spanish Squat (band)","Quads","Band","rep","rehab"],
    ["Terminal Knee Extension","Quads","Band","rep","rehab"],
    // ---- Hamstrings ----
    ["Romanian Deadlift","Hamstrings","Barbell","wr","heavy"],
    ["Stiff-Leg Deadlift","Hamstrings","Barbell","wr","compound"],
    ["Seated Leg Curl","Hamstrings","Machine","wr","iso"],
    ["Lying Leg Curl","Hamstrings","Machine","wr","iso"],
    ["Nordic Curl","Hamstrings","Bodyweight","rep","iso"],
    ["Good Morning","Hamstrings","Barbell","wr","compound"],
    ["Single-Leg RDL","Hamstrings","Dumbbell","wr","compound"],
    ["Cable Pull-Through","Hamstrings","Cable","wr","iso"],
    ["Glute-Ham Raise","Hamstrings","Bodyweight","rep","iso"],
    // ---- Glutes ----
    ["Hip Thrust","Glutes","Barbell","wr","compound"],
    ["Machine Hip Thrust","Glutes","Machine","wr","compound"],
    ["Glute Bridge","Glutes","Bodyweight","rep","iso"],
    ["Cable Kickback","Glutes","Cable","wr","iso"],
    ["Hip Abduction Machine","Glutes","Machine","wr","small"],
    ["Banded Clamshell","Glutes","Band","rep","rehab"],
    ["Banded Lateral Walk","Glutes","Band","rep","rehab"],
    ["Frog Pump","Glutes","Bodyweight","rep","small"],
    // ---- Calves ----
    ["Standing Calf Raise","Calves","Machine","wr","small"],
    ["Seated Calf Raise","Calves","Machine","wr","small"],
    ["Leg Press Calf Raise","Calves","Machine","wr","small"],
    ["Single-Leg Calf Raise","Calves","Bodyweight","rep","small"],
    // ---- Biceps ----
    ["Barbell Curl","Biceps","Barbell","wr","iso"],
    ["EZ-Bar Curl","Biceps","Barbell","wr","iso"],
    ["Dumbbell Curl","Biceps","Dumbbell","wr","iso"],
    ["Hammer Curl","Biceps","Dumbbell","wr","iso"],
    ["Incline DB Curl","Biceps","Dumbbell","wr","iso"],
    ["Spider Curl","Biceps","Dumbbell","wr","iso"],
    ["Preacher Curl","Biceps","Machine","wr","iso"],
    ["Cable Curl","Biceps","Cable","wr","iso"],
    ["Bayesian Cable Curl","Biceps","Cable","wr","iso"],
    ["Concentration Curl","Biceps","Dumbbell","wr","iso"],
    // ---- Triceps ----
    ["Close-Grip Bench","Triceps","Barbell","wr","compound"],
    ["Skull Crusher","Triceps","Barbell","wr","iso"],
    ["JM Press","Triceps","Barbell","wr","iso"],
    ["Triceps Pushdown","Triceps","Cable","wr","iso"],
    ["Rope Pushdown","Triceps","Cable","wr","iso"],
    ["Overhead Cable Extension","Triceps","Cable","wr","iso"],
    ["DB Overhead Extension","Triceps","Dumbbell","wr","iso"],
    ["Dips (Triceps)","Triceps","Bodyweight","rep","compound"],
    ["Bench Dips","Triceps","Bodyweight","rep","iso"],
    // ---- Core ----
    ["Plank","Core","Bodyweight","time","small"],
    ["Side Plank","Core","Bodyweight","time","small"],
    ["Hanging Leg Raise","Core","Bodyweight","rep","small"],
    ["Cable Crunch","Core","Cable","wr","small"],
    ["Ab Wheel Rollout","Core","Bodyweight","rep","small"],
    ["Russian Twist","Core","Dumbbell","wr","small"],
    ["Pallof Press","Core","Cable","wr","small"],
    ["Dead Bug","Core","Bodyweight","rep","rehab"],
    ["Bird Dog","Core","Bodyweight","rep","rehab"],
    ["Hollow Hold","Core","Bodyweight","time","small"],
    ["Cable Woodchop","Core","Cable","wr","small"],
    // ---- Forearms ----
    ["Wrist Curl","Forearms","Barbell","wr","small"],
    ["Reverse Wrist Curl","Forearms","Barbell","wr","small"],
    ["Farmer's Carry","Forearms","Dumbbell","wd","compound"],
    ["Dead Hang","Forearms","Bodyweight","time","small"],
    ["Reverse Curl","Forearms","Barbell","wr","small"],
    // ---- Cardio ----
    ["Treadmill Run","Cardio","Machine","cardio","compound"],
    ["Incline Walk","Cardio","Machine","cardio","compound"],
    ["Stationary Bike","Cardio","Machine","cardio","compound"],
    ["Rowing Machine","Cardio","Machine","cardio","compound"],
    ["Stair Climber","Cardio","Machine","cardio","compound"],
    ["Elliptical","Cardio","Machine","cardio","compound"],
    ["Assault Bike","Cardio","Machine","cardio","compound"],
    ["Ski Erg","Cardio","Machine","cardio","compound"],
    ["Sled Push","Cardio","Machine","wd","compound"],
    // ---- Mobility / Rehab ----
    ["Stationary Bike (warm-up)","Mobility/Rehab","Machine","cardio","rehab"],
    ["Heel Slide","Mobility/Rehab","Bodyweight","rep","rehab"],
    ["Quad Set","Mobility/Rehab","Bodyweight","time","rehab"],
    ["Straight-Leg Raise","Mobility/Rehab","Bodyweight","rep","rehab"],
    ["Isometric Wall Sit","Mobility/Rehab","Bodyweight","time","rehab"],
    ["Balance / Single-Leg Stand","Mobility/Rehab","Bodyweight","time","rehab"],
    ["Step-Down (controlled)","Mobility/Rehab","Bodyweight","rep","rehab"],
    ["Hip Flexor Stretch","Mobility/Rehab","Bodyweight","time","rehab"],
    ["Hamstring Stretch","Mobility/Rehab","Bodyweight","time","rehab"],
    ["Foam Roll Quads","Mobility/Rehab","Bodyweight","time","rehab"]
  ];

  const LIB = RAW.map(([n, m, e, t, role]) => ({
    key: "lib:" + n, n, m, e, t, role,
    rp: RP_RANGE[role] || RP_RANGE.compound
  }));
  const LIB_BY_NAME = new Map(LIB.map(e => [e.n, e]));

  // rp range as display string, e.g. "RP 8–12"
  function rpHint(ex) {
    if (!ex || !ex.rp) return null;
    if (ex.t === "time" || ex.t === "cardio") return null;
    return `RP ${ex.rp[0]}–${ex.rp[1]}`;
  }

  const T = (sets, repLo, repHi, w = null) => ({ sets, repLo, repHi, w });

  /* ==========================================================
     RP MESOCYCLE ENGINE
     ========================================================== */

  /* --- Weekly volume landmarks (sets/muscle/week), Israetel/RP hypertrophy.
     [MV, MEV, MAV, MRV]. MEV = where we start a meso, MRV = ceiling we ramp toward.
     We ramp MEV -> ~MRV across accumulation weeks, then deload. --- */
  const LANDMARKS = {
    Chest:      [8, 10, 18, 22],
    Back:       [10, 12, 22, 26],   // includes lats+upper back; high tolerance
    Shoulders:  [6, 8, 22, 26],     // side/rear delts; very high tolerance
    Quads:      [8, 10, 18, 22],
    Hamstrings: [4, 6, 16, 20],
    Glutes:     [0, 4, 12, 16],
    Calves:     [6, 8, 16, 20],
    Biceps:     [6, 8, 16, 20],
    Triceps:    [6, 8, 16, 18],
    Core:       [0, 6, 16, 25],
    Forearms:   [2, 4, 12, 16]
    // Cardio + Mobility/Rehab intentionally excluded from set ramp.
  };
  const RAMP_MUSCLES = Object.keys(LANDMARKS);

  /* --- %1RM <-> reps (Brzycki-style table, conservative). Used to seed
     working weight for a target rep count from a known 1RM. --- */
  const PCT_1RM = { 1:1.00,2:0.97,3:0.94,4:0.92,5:0.89,6:0.86,7:0.83,8:0.81,9:0.78,10:0.75,
                    11:0.73,12:0.71,13:0.70,14:0.68,15:0.67,16:0.65,17:0.64,18:0.63,19:0.61,20:0.60 };
  function pctForReps(r) {
    if (!r || r < 1) return 0.75;
    if (r > 20) return 0.55;
    return PCT_1RM[Math.round(r)] || 0.75;
  }
  // estimate 1RM from a working set (Epley) — inverse of e1rm in app.js
  function est1RM(w, r) { return (!w || !r) ? 0 : w * (1 + r / 30); }
  // round to gym-realistic increment
  function roundLoad(w) {
    if (!w || w <= 0) return null;
    if (w >= 60) return Math.round(w / 2.5) * 2.5;
    if (w >= 20) return Math.round(w / 2) * 2;
    if (w >= 5)  return Math.round(w);
    return Math.round(w * 2) / 2;
  }

  /* --- Accessory seeding model.
     Each library exercise that needs a guessed weight is mapped to ONE of:
       {from:"BENCH"|"SQUAT"|"DEAD", k:fraction}   -> fraction of that lift's est working weight
       {bw:fraction}                               -> fraction of bodyweight (total load on bar/stack)
       {bwHand:fraction}                           -> fraction of bodyweight, PER HAND (dumbbell)
     These are deliberately rough population heuristics. Anything seeded is flagged
     est:true so the UI can mark it, and history overrides it after the first log. --- */
  const SEED = {
    // chest
    "Barbell Bench Press": {lift:"BENCH", k:1.0},
    "Incline Barbell Bench": {lift:"BENCH", k:0.82},
    "Decline Barbell Bench": {lift:"BENCH", k:1.02},
    "Smith Machine Bench": {lift:"BENCH", k:0.95},
    "Dumbbell Bench Press": {lift:"BENCH", k:0.38, perHand:true},
    "Incline Dumbbell Press": {lift:"BENCH", k:0.32, perHand:true},
    "Machine Chest Press": {lift:"BENCH", k:0.85},
    "Incline Machine Press": {lift:"BENCH", k:0.72},
    "Dumbbell Fly": {bwHand:0.12},
    "Incline Dumbbell Fly": {bwHand:0.10},
    "Cable Fly": {bw:0.18}, "Low-to-High Cable Fly": {bw:0.16}, "Cable Crossover": {bw:0.18},
    "Pec Deck": {bw:0.45},
    // back
    "Deadlift": {lift:"DEAD", k:1.0},
    "Rack Pull": {lift:"DEAD", k:1.15},
    "Barbell Row": {lift:"DEAD", k:0.55},
    "Pendlay Row": {lift:"DEAD", k:0.52},
    "Meadows Row": {lift:"DEAD", k:0.30},
    "T-Bar Row": {lift:"DEAD", k:0.45},
    "Seal Row": {lift:"DEAD", k:0.40},
    "Dumbbell Row": {lift:"DEAD", k:0.28, perHand:true},
    "Chest-Supported Row": {bw:0.55},
    "Seated Cable Row": {bw:0.75}, "Machine Row": {bw:0.70},
    "Lat Pulldown": {bw:0.70}, "Wide-Grip Pulldown": {bw:0.65}, "Neutral-Grip Pulldown": {bw:0.70},
    "Straight-Arm Pulldown": {bw:0.30},
    "Face Pull": {bw:0.22},
    // shoulders
    "Overhead Press": {lift:"BENCH", k:0.62},
    "Push Press": {lift:"BENCH", k:0.78},
    "Seated DB Shoulder Press": {lift:"BENCH", k:0.24, perHand:true},
    "Arnold Press": {lift:"BENCH", k:0.20, perHand:true},
    "Machine Shoulder Press": {lift:"BENCH", k:0.55},
    "Lateral Raise": {bwHand:0.06}, "Cable Lateral Raise": {bwHand:0.05},
    "Machine Lateral Raise": {bw:0.20}, "Rear Delt Fly": {bwHand:0.06},
    "Reverse Pec Deck": {bw:0.30}, "Front Raise": {bwHand:0.07}, "Cuban Press": {bwHand:0.06},
    "Upright Row": {bw:0.40}, "Barbell Shrug": {lift:"DEAD", k:0.5}, "Dumbbell Shrug": {bwHand:0.35},
    // quads
    "Back Squat": {lift:"SQUAT", k:1.0},
    "Front Squat": {lift:"SQUAT", k:0.80},
    "Zercher Squat": {lift:"SQUAT", k:0.65},
    "Hack Squat": {lift:"SQUAT", k:0.85}, "Leg Press": {lift:"SQUAT", k:1.6},
    "Pendulum Squat": {lift:"SQUAT", k:0.75},
    "Leg Extension": {bw:0.55}, "Goblet Squat": {bwHand:0.4},
    "Bulgarian Split Squat": {bwHand:0.22}, "Walking Lunge": {bwHand:0.22}, "Step-up": {bwHand:0.22},
    // hamstrings
    "Romanian Deadlift": {lift:"DEAD", k:0.72},
    "Stiff-Leg Deadlift": {lift:"DEAD", k:0.68},
    "Good Morning": {lift:"SQUAT", k:0.40},
    "Single-Leg RDL": {bwHand:0.25},
    "Seated Leg Curl": {bw:0.45}, "Lying Leg Curl": {bw:0.40}, "Cable Pull-Through": {bw:0.40},
    // glutes
    "Hip Thrust": {lift:"SQUAT", k:0.9}, "Machine Hip Thrust": {bw:1.0},
    "Cable Kickback": {bw:0.15}, "Hip Abduction Machine": {bw:0.7},
    // calves
    "Standing Calf Raise": {bw:0.9}, "Seated Calf Raise": {bw:0.6},
    "Leg Press Calf Raise": {bw:1.4},
    // biceps
    "Barbell Curl": {bw:0.35}, "EZ-Bar Curl": {bw:0.32},
    "Dumbbell Curl": {bwHand:0.14}, "Hammer Curl": {bwHand:0.15}, "Incline DB Curl": {bwHand:0.12},
    "Spider Curl": {bwHand:0.12}, "Preacher Curl": {bw:0.28}, "Cable Curl": {bw:0.30},
    "Bayesian Cable Curl": {bw:0.16}, "Concentration Curl": {bwHand:0.12},
    // triceps
    "Close-Grip Bench": {lift:"BENCH", k:0.82},
    "Skull Crusher": {bw:0.30}, "JM Press": {bw:0.35},
    "Triceps Pushdown": {bw:0.45}, "Rope Pushdown": {bw:0.40},
    "Overhead Cable Extension": {bw:0.35}, "DB Overhead Extension": {bwHand:0.18},
    // core
    "Cable Crunch": {bw:0.5}, "Russian Twist": {bwHand:0.1}, "Pallof Press": {bw:0.2},
    "Cable Woodchop": {bw:0.25},
    // forearms
    "Wrist Curl": {bw:0.25}, "Reverse Wrist Curl": {bw:0.15}, "Reverse Curl": {bw:0.22},
    "Farmer's Carry": {bwHand:0.5}
  };

  /* Given the user's stats {bench,squat,dead,bodyweight} (working est-1RMs or
     working weights — we treat them as est-1RM proxies), return a seeded
     working weight for a target rep count, plus est flag. */
  function seedWeight(exName, reps, stats) {
    const map = SEED[exName];
    if (!map) return { w: null, est: false };
    const bw = stats.bodyweight || 75;
    const pct = pctForReps(reps);
    if (map.lift) {
      const oneRM = stats[map.lift.toLowerCase()] || 0;
      if (!oneRM) return { w: null, est: false }; // no stat given -> leave blank
      let w = oneRM * map.k * pct;
      if (map.perHand) w = w; // per-hand fraction already baked into k
      return { w: roundLoad(w), est: true };
    }
    if (map.bwHand != null) return { w: roundLoad(bw * map.bwHand), est: true };
    if (map.bw != null)     return { w: roundLoad(bw * map.bw * (pct/0.75)), est: true };
    return { w: null, est: false };
  }

  /* ==========================================================
     SPLIT TEMPLATES
     A split = ordered list of "day blueprints". Each blueprint names a set of
     muscles it trains and the exercises (by library name) to slot in, tagged
     primary/secondary so we know which get the heavy rep range. The generator
     allocates SETS per exercise from the weekly landmark / training frequency.
     ========================================================== */

  // pri = heavy compound (low reps), sec = compound, iso = isolation/small
  const EX = (name, tier) => ({ name, tier });

  /* Day blueprints keyed by an id. muscles[] drives volume accounting. */
  const DAY = {
    pushHeavy: { name:"Push (heavy)", muscles:["Chest","Shoulders","Triceps"], ex:[
      EX("Barbell Bench Press","pri"), EX("Overhead Press","pri"),
      EX("Incline Dumbbell Press","sec"), EX("Lateral Raise","iso"),
      EX("Triceps Pushdown","iso") ] },
    pushVol: { name:"Push (volume)", muscles:["Chest","Shoulders","Triceps"], ex:[
      EX("Incline Barbell Bench","sec"), EX("Machine Shoulder Press","sec"),
      EX("Cable Fly","iso"), EX("Cable Lateral Raise","iso"),
      EX("Overhead Cable Extension","iso") ] },
    pullHeavy: { name:"Pull (heavy)", muscles:["Back","Biceps"], ex:[
      EX("Barbell Row","pri"), EX("Lat Pulldown","sec"),
      EX("Seated Cable Row","sec"), EX("Face Pull","iso"),
      EX("Barbell Curl","iso") ] },
    pullVol: { name:"Pull (volume)", muscles:["Back","Biceps"], ex:[
      EX("Chest-Supported Row","sec"), EX("Wide-Grip Pulldown","sec"),
      EX("Straight-Arm Pulldown","iso"), EX("Rear Delt Fly","iso"),
      EX("Incline DB Curl","iso") ] },
    legHeavy: { name:"Legs (heavy)", muscles:["Quads","Hamstrings","Glutes","Calves"], ex:[
      EX("Back Squat","pri"), EX("Romanian Deadlift","pri"),
      EX("Leg Press","sec"), EX("Seated Leg Curl","iso"),
      EX("Standing Calf Raise","iso") ] },
    legVol: { name:"Legs (volume)", muscles:["Quads","Hamstrings","Glutes","Calves"], ex:[
      EX("Hack Squat","sec"), EX("Bulgarian Split Squat","sec"),
      EX("Lying Leg Curl","iso"), EX("Leg Extension","iso"),
      EX("Seated Calf Raise","iso") ] },
    upperHeavy: { name:"Upper (heavy)", muscles:["Chest","Back","Shoulders","Biceps","Triceps"], ex:[
      EX("Barbell Bench Press","pri"), EX("Barbell Row","pri"),
      EX("Overhead Press","sec"), EX("Lat Pulldown","sec"),
      EX("Barbell Curl","iso"), EX("Triceps Pushdown","iso") ] },
    upperVol: { name:"Upper (volume)", muscles:["Chest","Back","Shoulders","Biceps","Triceps"], ex:[
      EX("Incline Dumbbell Press","sec"), EX("Chest-Supported Row","sec"),
      EX("Lateral Raise","iso"), EX("Cable Fly","iso"),
      EX("Incline DB Curl","iso"), EX("Rope Pushdown","iso") ] },
    lowerHeavy: { name:"Lower (heavy)", muscles:["Quads","Hamstrings","Glutes","Calves"], ex:[
      EX("Back Squat","pri"), EX("Romanian Deadlift","pri"),
      EX("Leg Press","sec"), EX("Seated Leg Curl","iso"),
      EX("Standing Calf Raise","iso") ] },
    lowerVol: { name:"Lower (volume)", muscles:["Quads","Hamstrings","Glutes","Calves"], ex:[
      EX("Hack Squat","sec"), EX("Hip Thrust","sec"),
      EX("Lying Leg Curl","iso"), EX("Leg Extension","iso"),
      EX("Seated Calf Raise","iso") ] },
    fullA: { name:"Full Body A", muscles:["Quads","Chest","Back","Shoulders","Triceps"], ex:[
      EX("Back Squat","pri"), EX("Barbell Bench Press","pri"),
      EX("Barbell Row","sec"), EX("Lateral Raise","iso"),
      EX("Triceps Pushdown","iso") ] },
    fullB: { name:"Full Body B", muscles:["Hamstrings","Back","Chest","Shoulders","Biceps"], ex:[
      EX("Romanian Deadlift","pri"), EX("Overhead Press","pri"),
      EX("Lat Pulldown","sec"), EX("Incline Dumbbell Press","sec"),
      EX("Barbell Curl","iso") ] },
    fullC: { name:"Full Body C", muscles:["Quads","Chest","Back","Glutes","Calves"], ex:[
      EX("Leg Press","sec"), EX("Incline Barbell Bench","sec"),
      EX("Seated Cable Row","sec"), EX("Hip Thrust","sec"),
      EX("Standing Calf Raise","iso") ] },
    arms: { name:"Arms", muscles:["Biceps","Triceps","Forearms"], ex:[
      EX("Barbell Curl","sec"), EX("Close-Grip Bench","sec"),
      EX("Incline DB Curl","iso"), EX("Rope Pushdown","iso"),
      EX("Hammer Curl","iso"), EX("Overhead Cable Extension","iso") ] },
    chestBack: { name:"Chest & Back", muscles:["Chest","Back"], ex:[
      EX("Barbell Bench Press","pri"), EX("Barbell Row","pri"),
      EX("Incline Dumbbell Press","sec"), EX("Lat Pulldown","sec"),
      EX("Cable Fly","iso"), EX("Straight-Arm Pulldown","iso") ] },
    delts: { name:"Shoulders & Calves", muscles:["Shoulders","Calves"], ex:[
      EX("Overhead Press","pri"), EX("Lateral Raise","iso"),
      EX("Rear Delt Fly","iso"), EX("Cable Lateral Raise","iso"),
      EX("Standing Calf Raise","iso") ] }
  };

  /* Split catalogue. Each entry: how many days it needs, and the day sequence.
     Keyed so the generator can offer the ones that fit the chosen day count. */
  const SPLITS = [
    { id:"ppl6", name:"Push / Pull / Legs ×2", days:6, blurb:"Each muscle 2×/week. Highest volume ceiling.",
      seq:["pushHeavy","pullHeavy","legHeavy","pushVol","pullVol","legVol"] },
    { id:"ul4", name:"Upper / Lower ×2", days:4, blurb:"Balanced frequency, time-efficient.",
      seq:["upperHeavy","lowerHeavy","upperVol","lowerVol"] },
    { id:"ul6", name:"Upper / Lower ×3", days:6, blurb:"High frequency, every muscle 3×.",
      seq:["upperHeavy","lowerHeavy","upperVol","lowerVol","upperHeavy","lowerHeavy"] },
    { id:"full3", name:"Full Body ×3", days:3, blurb:"Whole body each session. Best for 3 days.",
      seq:["fullA","fullB","fullC"] },
    { id:"ppl3", name:"Push / Pull / Legs ×1", days:3, blurb:"Classic 3-day split, 1× frequency.",
      seq:["pushHeavy","pullHeavy","legHeavy"] },
    { id:"ul5", name:"Upper / Lower / Full", days:5, blurb:"4 split days + 1 full-body top-up.",
      seq:["upperHeavy","lowerHeavy","upperVol","lowerVol","fullA"] },
    { id:"bro5", name:"Body-part (Arms/Chest+Back/Legs/Delts/Push)", days:5,
      blurb:"Bro-style body-part split. Lower frequency, high per-session volume.",
      seq:["chestBack","legHeavy","delts","arms","pushVol"] },
    { id:"ppl5", name:"Push / Pull / Legs + Upper/Lower", days:5,
      blurb:"PPL once + an extra upper/lower. Hybrid 5-day.",
      seq:["pushHeavy","pullHeavy","legHeavy","upperVol","lowerVol"] },
    { id:"full4", name:"Full Body ×4", days:4, blurb:"Four whole-body sessions, rotated.",
      seq:["fullA","fullB","fullC","fullA"] }
  ];

  function splitsForDays(d) {
    // offer exact matches first, then anything that needs <= d days
    const exact = SPLITS.filter(s => s.days === d);
    const fewer = SPLITS.filter(s => s.days < d).sort((a,b)=>b.days-a.days);
    return [...exact, ...fewer].slice(0, 4);
  }

  /* ==========================================================
     GOAL MODEL — what gain/maintain/lose drives
     ========================================================== */
  const GOALS = {
    gain:     { id:"gain", label:"Gain (bulk)",
                volMult:1.0,  rirOffset:0,  cardioMin:0,   cardioSessions:0,
                cal:"+10–20% over maintenance", protein:"1.6–2.2 g/kg" },
    maintain: { id:"maintain", label:"Maintain",
                volMult:0.9,  rirOffset:0,  cardioMin:20,  cardioSessions:2,
                cal:"at maintenance", protein:"1.6–2.0 g/kg" },
    lose:     { id:"lose", label:"Lose (cut)",
                volMult:0.8,  rirOffset:0.5, cardioMin:30, cardioSessions:3,
                cal:"−15–25% under maintenance", protein:"2.0–2.6 g/kg" }
  };

  function cardioBlock(goal) {
    const g = GOALS[goal];
    if (!g || g.cardioSessions === 0) return null;
    return { sessions: g.cardioSessions, minutes: g.cardioMin,
             note: `${g.cardioSessions}×/wk · ${g.cardioMin} min LISS or 10 min HIIT, after lifting or separate day` };
  }

  /* ==========================================================
     SET RAMP — MEV -> ~MRV across accumulation weeks, then deload.
     Returns sets/muscle/week for a given accumulation length.
     weekIdx is 1-based; the final week (accumWeeks+1) is the deload.
     ========================================================== */
  function rampSets(muscle, weekIdx, accumWeeks, volMult) {
    const lm = LANDMARKS[muscle];
    if (!lm) return null;
    const [, mev, mav, mrv] = lm;
    const isDeload = weekIdx > accumWeeks;
    if (isDeload) return Math.max(2, Math.round(mev * 0.5 * volMult));
    // linear ramp MEV (week1) -> target ceiling (last accum week)
    const ceiling = Math.min(mrv, mav + 2); // don't slam MRV; stop just past MAV
    const frac = accumWeeks <= 1 ? 1 : (weekIdx - 1) / (accumWeeks - 1);
    const sets = mev + (ceiling - mev) * frac;
    return Math.max(2, Math.round(sets * volMult));
  }

  /* RIR target per accumulation week: start 3, end 0-1, deload 4-5.
     Returns a {lo,hi} reps-in-reserve band shown as logging guidance. */
  function rirTarget(weekIdx, accumWeeks, rirOffset) {
    if (weekIdx > accumWeeks) return { lo: 4, hi: 5 };
    const start = 3, end = 0;
    const frac = accumWeeks <= 1 ? 1 : (weekIdx - 1) / (accumWeeks - 1);
    const base = start - (start - end) * frac;
    // rirOffset (e.g. +0.5 on a cut) keeps a touch more in the tank, but never
    // pushes accumulation weeks into deload territory: cap accumulation RIR at 3.
    const lo = Math.max(0, Math.min(3, Math.round(base + rirOffset)));
    return { lo, hi: lo + 1 };
  }

  /* ==========================================================
     GENERATOR — build a full mesocycle program object.
     opts = { splitId, goal, daysPerWeek, accumWeeks, stats:{bench,squat,dead,bodyweight} }
     Produces the SAME program shape the app already uses, plus a `meso` block,
     and per-item `seed`/`est` metadata. Week-1 set counts and seeded weights
     are baked into day.items targets so logging works immediately.
     ========================================================== */
  function uidLocal() { return Math.random().toString(36).slice(2, 9); }

  function generateProgram(opts) {
    const split = SPLITS.find(s => s.id === opts.splitId);
    if (!split) return null;
    const goal = GOALS[opts.goal] || GOALS.gain;
    const accumWeeks = opts.accumWeeks || 4;
    const stats = opts.stats || {};
    const week = 1;

    // 1) count how many TIMES each muscle is trained across the week (frequency)
    const freq = {};
    split.seq.forEach(dayId => {
      (DAY[dayId].muscles || []).forEach(m => { freq[m] = (freq[m] || 0) + 1; });
    });

    // 2) weekly set target per muscle for week 1 (MEV-ish), scaled by goal
    const weeklySets = {};
    RAMP_MUSCLES.forEach(m => {
      weeklySets[m] = rampSets(m, week, accumWeeks, goal.volMult);
    });

    // 3) build days. Distribute each muscle's weekly sets across the days that
    //    train it, and across the exercises in that day hitting that muscle.
    const days = split.seq.map(dayId => {
      const bp = DAY[dayId];
      const items = bp.ex.map(exRef => {
        const lib = LIB_BY_NAME.get(exRef.name);
        if (!lib) return null;
        const muscle = lib.m;
        // sets for THIS exercise = (weekly sets for muscle / frequency) split across
        // exercises in this day that train the same muscle.
        const exForMuscleToday = bp.ex.filter(e => {
          const l = LIB_BY_NAME.get(e.name); return l && l.m === muscle;
        }).length || 1;
        const wk = weeklySets[muscle];
        let sets;
        if (wk == null) {
          sets = exRef.tier === "pri" ? 4 : exRef.tier === "sec" ? 3 : 3;
        } else {
          const perDay = wk / (freq[muscle] || 1);
          sets = Math.round(perDay / exForMuscleToday);
          // tier-aware floor: heavy compounds carry the load, never below 3
          const floor = exRef.tier === "pri" ? 3 : exRef.tier === "sec" ? 3 : 2;
          sets = Math.max(floor, Math.min(sets, 5)); // cap per-exercise sets
        }
        // rep range from tier (heavy compounds low, iso high)
        const [repLo, repHi] = exRef.tier === "pri" ? [5, 8]
                              : exRef.tier === "sec" ? [8, 12]
                              : (lib.role === "small" ? [12, 20] : [10, 15]);
        const reps = Math.round((repLo + repHi) / 2);
        const { w, est } = (lib.t === "wr")
          ? seedWeight(exRef.name, reps, stats)
          : { w: null, est: false };
        return {
          key: lib.key,
          target: { sets, repLo, repHi, w },
          tier: exRef.tier,
          est: !!est
        };
      }).filter(Boolean);
      return { id: uidLocal(), name: bp.name, blueprint: dayId, items };
    });

    const cardio = cardioBlock(opts.goal);
    const rir = rirTarget(week, accumWeeks, goal.rirOffset);

    return {
      target: opts.daysPerWeek,
      generated: true,
      days,
      meso: {
        splitId: split.id, splitName: split.name,
        goal: goal.id, goalLabel: goal.label,
        daysPerWeek: opts.daysPerWeek,
        accumWeeks, totalWeeks: accumWeeks + 1,
        week: 1,
        startedOn: null,           // set when user starts week 1
        stats: { bench: stats.bench||null, squat: stats.squat||null,
                 dead: stats.dead||null, bodyweight: stats.bodyweight||null },
        cardio, rir,
        nutrition: { cal: goal.cal, protein: goal.protein }
      }
    };
  }

  /* Advance an existing generated program to a target week: recompute set
     counts (ramp) and RIR band; keep user-logged/edited weights intact.
     We DON'T overwrite weights here — load progression is handled per-session
     by app.js (effectiveTargetW). We only move SETS and RIR. */
  function applyWeek(program, newWeek) {
    if (!program || !program.meso) return program;
    const m = program.meso;
    const accumWeeks = m.accumWeeks;
    const goal = GOALS[m.goal] || GOALS.gain;
    const week = Math.max(1, Math.min(newWeek, m.totalWeeks));

    // recompute weekly sets per muscle for this week
    const weeklySets = {};
    RAMP_MUSCLES.forEach(mu => { weeklySets[mu] = rampSets(mu, week, accumWeeks, goal.volMult); });

    // frequency per muscle
    const freq = {};
    program.days.forEach(d => {
      const bp = DAY[d.blueprint];
      if (bp) bp.muscles.forEach(mu => { freq[mu] = (freq[mu]||0)+1; });
    });

    const days = program.days.map(d => {
      const bp = DAY[d.blueprint];
      const items = d.items.map(it => {
        const lib = LIB_BY_NAME.get((it.key||"").replace(/^lib:/, "")) || null;
        const muscle = lib ? lib.m : null;
        if (!muscle || weeklySets[muscle] == null || !bp) return it;
        const exForMuscleToday = bp.ex.filter(e => {
          const l = LIB_BY_NAME.get(e.name); return l && l.m === muscle;
        }).length || 1;
        const perDay = weeklySets[muscle] / (freq[muscle] || 1);
        let sets = Math.round(perDay / exForMuscleToday);
        const tier = it.tier || "sec";
        const floor = tier === "pri" ? 3 : tier === "sec" ? 3 : 2;
        sets = Math.max(floor, Math.min(sets, 5));
        return { ...it, target: { ...it.target, sets } };
      });
      return { ...d, items };
    });

    const rir = rirTarget(week, accumWeeks, goal.rirOffset);
    const isDeload = week > accumWeeks;
    return { ...program, days, meso: { ...m, week, rir, isDeload } };
  }

  function mesoStatus(program) {
    if (!program || !program.meso) return null;
    const m = program.meso;
    const isDeload = m.week > m.accumWeeks;
    return {
      week: m.week, total: m.totalWeeks, accumWeeks: m.accumWeeks,
      isDeload, rir: m.rir,
      label: isDeload ? `Deload week (${m.week}/${m.totalWeeks})`
                      : `Week ${m.week}/${m.totalWeeks} · accumulation`,
      splitName: m.splitName, goalLabel: m.goalLabel,
      cardio: m.cardio, nutrition: m.nutrition
    };
  }

  // built-in 6-day PPL; legs are user-managed physio placeholders
  function defaultProgram() {
    const uid = () => Math.random().toString(36).slice(2, 9);
    return {
      target: 6,
      days: [
        { id: uid(), name: "Push A (heavy)", items: [
          { key: "lib:Barbell Bench Press", target: T(4, 5, 5, 80) },
          { key: "lib:Overhead Press", target: T(3, 6, 6, 45) },
          { key: "lib:Incline Dumbbell Press", target: T(3, 8, 8, 24) },
          { key: "lib:Lateral Raise", target: T(3, 12, 12, 10) },
          { key: "lib:Triceps Pushdown", target: T(3, 12, 12, 25) } ] },
        { id: uid(), name: "Pull A (heavy)", items: [
          { key: "lib:Rack Pull", target: T(4, 5, 5, 100) },
          { key: "lib:Barbell Row", target: T(4, 6, 6, 80) },
          { key: "lib:Lat Pulldown", target: T(3, 8, 8, 70) },
          { key: "lib:Face Pull", target: T(3, 15, 15, 20) },
          { key: "lib:Barbell Curl", target: T(3, 8, 8, 30) } ] },
        { id: uid(), name: "Legs (physio)", items: [
          { key: "lib:Stationary Bike (warm-up)", target: T(1, 0, 0, null) } ] },
        { id: uid(), name: "Push B (volume)", items: [
          { key: "lib:Incline Barbell Bench", target: T(4, 8, 8, 65) },
          { key: "lib:Machine Shoulder Press", target: T(3, 10, 10, 40) },
          { key: "lib:Cable Fly", target: T(3, 12, 12, 15) },
          { key: "lib:Cable Lateral Raise", target: T(3, 15, 15, 7.5) },
          { key: "lib:Overhead Cable Extension", target: T(3, 12, 12, 25) } ] },
        { id: uid(), name: "Pull B (volume)", items: [
          { key: "lib:Chest-Supported Row", target: T(4, 10, 10, 50) },
          { key: "lib:Wide-Grip Pulldown", target: T(3, 10, 10, 60) },
          { key: "lib:Seated Cable Row", target: T(3, 12, 12, 55) },
          { key: "lib:Rear Delt Fly", target: T(3, 15, 15, 10) },
          { key: "lib:Incline DB Curl", target: T(3, 11, 11, 12.5) } ] },
        { id: uid(), name: "Legs (physio)", items: [
          { key: "lib:Stationary Bike (warm-up)", target: T(1, 0, 0, null) } ] }
      ]
    };
  }

  window.GymData = {
    MUSCLES, LIB, T, rpHint, defaultProgram,
    // mesocycle engine
    LANDMARKS, GOALS, SPLITS,
    splitsForDays, generateProgram, applyWeek, mesoStatus,
    rampSets, rirTarget, seedWeight, est1RM
  };
})();
