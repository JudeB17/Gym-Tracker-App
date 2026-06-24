/* ============================================================
   data.js — exercise library, RP rep-range model, default program
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

  // rp range as display string, e.g. "RP 8–12"
  function rpHint(ex) {
    if (!ex || !ex.rp) return null;
    if (ex.t === "time" || ex.t === "cardio") return null;
    return `RP ${ex.rp[0]}–${ex.rp[1]}`;
  }

  const T = (sets, repLo, repHi, w = null) => ({ sets, repLo, repHi, w });

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

  window.GymData = { MUSCLES, LIB, T, rpHint, defaultProgram };
})();
