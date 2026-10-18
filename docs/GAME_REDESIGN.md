# Find the culprit, season 2: a design proposal

Status: proposal, no code yet. It covers the question flow, the scoring, ordered tests and the clock, no-MI days, and
the share line and streak. Where it relies on physics CoroSim doesn't have yet, it says so.

## What's wrong with the current game

- **Every day is an MI.** Once players know a lesion is always there, the game trains localisation only. It never
  trains the harder call: is this an occlusion, a non-occlusion MI, or nothing?
- **Three clocks that don't agree.** The find phase scores *patient seconds* at 3× (`POINTS.timeTau` = 150 s, so
  about 50 real seconds). Over the same stretch, `app.ts` adds necrosis at 2 clinical min per real second, while the
  ischemia itself develops over about 20 sim-seconds. Troponin can't be added to that mix, because it needs hours
  and is read as a delta.
- **The find score rewards fast clicking, not judgement.** At τ = 150 patient-s, a careful read loses more points
  than a wrong branch does.
- **Exact-spot pressing is great on the 3D heart but narrow as teaching.** At the bedside, the skill is naming the
  wall(s) involved (including RV and posterior) and the vessel.
- **The RV question is a one-off.** It's really one wall of the territory question.

## The recommended design

### One clinical clock, turn-based until the decision

- The case opens at the **door** (clinical t = 0). The card gives **time since symptom onset**, drawn per case
  (30 min to 12 h). It's the one piece of history that troponin and the ESC 0/1h algorithm need.
- **At the door, the physiology has already run.** Ischemia is at steady state. Necrosis has accrued over the onset
  interval in closed form (`stepNecrosis(n, sev, onsetMin)` is already analytic). Troponin is computed from that
  history. Nobody watches the ischemia develop any more; the patient arrives with it.
- **During triage, the clinical clock moves only when the player acts.** The monitor and ECG animate in real time
  (bedside physiology at 1×), but necrosis is frozen between actions. Reading speed, device and connection stop
  mattering; decisions do.
- **Every order jumps the clock by its turnaround.** On each jump, necrosis advances in closed form and troponin is
  re-evaluated. Fast physiology (ischemia, autonomic) is already at steady state, so nothing else needs to be
  stepped.
- **Once the player commits, the treatment phase runs as it does today** (2 clinical min/s, PCI 60 min after the
  order, cap and settle as now). The clock carries on from wherever triage left it.

| Order | Clinical cost | What it returns |
|---|---|---|
| hs-troponin, 0 h | +15 min | hs-cTnT drawn at the door, in ng/L |
| hs-troponin, 1 h | clock → 75 min (at least +15) | 1 h value and the Δ from 0 h |
| hs-troponin, 3 h | clock → 195 min | for the ESC "observe" zone |
| Repeat ECG after rest/nitro | +10 min | 12-lead with exertional demand off; dynamic ST changes resolve |
| Bedside echo (later, once wall motion exists) | +15 min | regional wall motion by segment |
| Activate the cath lab / commit | 0 | ends triage |

**Delay is charged once, through the physiology.** In an occlusion, every order costs muscle, and the muscle score
is measured against PCI ordered *at the door*. On non-occlusion days waiting costs no muscle, and waiting for a 1 h
troponin is the right call. Nothing else decays with time. The lesson falls straight out of the physics: don't wait
for troponin in a STEMI, and do wait for the delta when the ECG is non-diagnostic.

Real seconds to commit are recorded only as a tiebreak and in the share line, never in the score.

### Troponin (new: `src/physics/troponin.ts`)

- hs-cTnT = baseline (drawn 3–9 ng/L) + K · Σ over necrosis increments dN of dN · F(t − t_dN).
  - F is a release curve, 1 − exp(−Δ/τ_rel), with τ_rel around 4 h.
  - K is set so that a 10% LV infarct, fully released, reaches a few thousand ng/L.
  - Both are teaching assumptions, tagged as such in `src/config/`. Clearance can be ignored over a game's ≤ 6 h.
- For jumps, increments are attributed at the midpoint of the jump. That's enough at these timescales.
- **Read with the ESC 0/1h algorithm (hs-cTnT):**
  - Rule out: 0 h < 5 ng/L if onset was more than 3 h ago, or 0 h < 12 and Δ1h < 3.
  - Rule in: 0 h ≥ 52, or Δ1h ≥ 5.
  - Anything else is "observe" (3 h draw).
- These thresholds are what the debrief teaches, and an early STEMI often reads below 52 at 0 h. That's a feature:
  the ECG decides an occlusion, not the troponin.

### The question flow

1. **Triage (turn-based).**
   - Shown: the case card (age band, sex, onset time, a one-line complaint drawn independently of the diagnosis),
     the 12-lead with posterior leads, and the monitor.
   - The player may order tests from the table above.
2. **Diagnosis: one choice from four.** These are the four classes of the draw:
   - **Occlusion MI (OMI).** An acutely occluded artery that needs the cath lab now. This includes posterior-only,
     nodal-artery and other "STEMI-negative" occlusions: the OMI paradigm, which the physics knows ground truth for.
   - **Non-occlusion MI (NOMI).** Troponin rule-in without an occlusion: subendocardial or demand infarction.
   - **Ischemia without infarction.** Exertional/dynamic ST depression, troponin ruled out (angina).
   - **No ischemia.** Normal coronaries or a non-flow-limiting stenosis. Later this class also takes STEMI mimics.
3. **Where or what next.** This branches on the player's own answer, not the truth.
   - **If they said OMI: localise.**
     - Pick the walls (anterior, septal, lateral, inferior, posterior, RV; multi-select). This replaces the RV
       question.
     - Press the spot on the 3D tree. The existing Gaussian is kept, scaled to the new points.
   - **Otherwise: choose the disposition.** Emergent cath lab, early invasive (< 24 h), admit for non-invasive
     testing, or discharge with follow-up.
4. **Treatment / course.** Running clock.
   - **True OMI:** the existing management phase (muscle saved, pressure held, harm), with baselines from the door.
   - **Not an OMI:** a short observed course. Harm is scored: a fibrinolytic given to a non-occlusion, and the
     existing warnings (nitrate in an RV infarct, etc.).
   - **Missed OMI:** if the player sent an occlusion home or to non-urgent care, **the patient re-presents**. The clock
     jumps 90 min, the lesion is revealed, and the management phase runs from there. Muscle is still scored against
     the door baseline, so the miss shows up as the muscle lost. It's the most memorable lesson in the game.
   - **False activation:** if the player activated the cath lab on a non-occlusion, the angiogram shows no culprit.
     Localisation scores 0 and disposition loses its points. No harm unless a lytic was given.
5. **Debrief.** The existing ECG paragraph, plus:
   - the troponin course with the ESC zone it fell in;
   - the onset-to-door and door-to-decision times;
   - for misses, what would have caught it (the posterior leads, the 1 h delta, the repeat ECG).

### Points: every day out of 100

| Stage | OMI day | NOMI day | Ischemia-only day | No-ischemia day |
|---|---|---|---|---|
| Diagnosis | 30 | 30 | 30 | 30 |
| Walls | 15 | — | — | — |
| Spot on the tree | 15 | — | — | — |
| Disposition | — | 30 | 30 | 30 |
| Muscle saved (vs PCI at the door / none) | 25 | — | — | — |
| Pressure held out of shock, less harm | 15 | — | — | — |
| Harm-free course | — | 20 | 20 | 20 |
| Workup efficiency | — | 20 | 20 | 20 |
| **Total** | **100** | **100** | **100** | **100** |

How each line is scored:

- **Diagnosis.** 30 for the right class. 10 for an adjacent one: OMI↔NOMI ("an MI, wrong urgency"), NOMI↔ischemia,
  ischemia↔none. 0 otherwise, including OMI↔none.
- **Walls.** 15 × (correct walls − wrong walls) / walls involved, floored at 0. Truth comes from the
  severity-weighted ischemic fraction of each wall at the door, at the same 0.3 cut the RV line uses now.
- **Spot.** `locationScore(d)` scaled to 15: full on the lesion, Gaussian σ 20 mm along the tree, and a floor of 4
  in the right system. There's **no time factor** any more.
- **Disposition.** 30 for the guideline step and 10 for the adjacent one, from a small table per class. For example,
  NOMI → early invasive gets 30 and emergent cath gets 10.
- **Workup efficiency.**
  - 20 if the player reached the decision with the **minimum sufficient** set of tests for that day. The minimum is
    computed at draw time: e.g. a 0 h < 5 rule-out when onset > 3 h needs only the 0 h draw.
  - Each extra test costs 5. A decision made *without* a test the call needed (discharging on a 0 h of 8 with onset
    1 h ago) gets 0, even if the class guess happened to be right.
  - This puts a mild cost on time on non-occlusion days (ED bed time) without punishing the delta the patient
    needs.
- **On OMI days, extra tests cost muscle instead of efficiency points.** That's deliberate: it's the real asymmetry.

The class never shows mid-case. The player sees only the stages their own answers led to.

### Drawing the day: class first, then physics, then a check

1. Draw the class from the day's seed: OMI 45%, NOMI 20%, ischemia-only 15%, none 20%. Optionally, cap no-ischemia
   days at two per seven, so a run of normals doesn't feel broken.
2. Draw the parameters for that class:
   - **OMI:** today's draw (any vessel, occluded), onset 30 min to 6 h.
   - **NOMI:** a 75–95% stenosis with exertional/demand load sustained over the onset interval, onset 1–12 h.
   - **Ischemia-only:** a 70–90% stenosis, demand on at the door ("ECG taken during pain"), and a short demand
     interval so little necrosis accrues.
   - **None:** no lesion, or < 60%.
   - Background AF and BBB stay in all four classes. An LBBB with no ischemia is a good no-MI day.
3. Run the physics and **classify from the result, not the intent**:
   - **OMI** = occluded, with at-risk mass ≥ the tiny-stake floor.
   - **MI** = troponin rule-in reachable by 3 h.
   - **Ischemia** = subendocardial ST shift ≥ 0.5 mm in the presenting ECG, with rule-out.
   - **None** = neither.
   If the computed class isn't the one drawn, redraw. The class mix is controlled, and the label always matches what
   the model actually did.
4. **Each class has its own solvability check.** Every day must be decidable with the tools on offer.
   - **OMI:** the existing check (ST ≥ 0.6 mm standard or 0.5 posterior, AV block, or a ±12 bpm rate change), on
     the **current** physics.
   - **NOMI:** rule-in by 1 h or 3 h, *and* no lead meets the OMI ST bar (otherwise it's ambiguous, so redraw).
   - **Ischemia-only:** ST depression ≥ 0.5 mm at the door that resolves on the repeat ECG, *and* the troponin rules
     out.
   - **None:** the troponin rules out by 0 h or 1 h, and no lead meets the OMI bar beyond what the BBB explains.
   - Store the minimum-sufficient test set alongside the case, for the efficiency score.

### Share line and streak

The share line stays spoiler-free: one square per stage, never the class.

```
CoroSim · Find the culprit S2 #12
🟩🟨🟩 78/100
decided at 25 clinical min · 41 s
4-day streak
corosim.com/game/
```

- The squares are diagnosis, then stage 3, then stage 4. 🟩 means ≥ 80% of that stage's points, 🟨 ≥ 30%, ⬛
  below that.
- Never print "door-to-balloon", "no MI" or a distance in mm. Each of those gives the class away.
- **The streak** stays "days played on their own day", unchanged.
- **The card adds a per-class accuracy line**, e.g. "OMI 9/11 · no-MI days 3/4", and the last-seven bars are coloured
  by whether the diagnosis was right. That gives players a reason to come back on the days that feel like nothing.

### Season cutover

Changing the draw changes every past day's case. To handle that:

- Start **season 2** on a new epoch, with case numbers counted from #1.
- Keep the season 1 draw and scoring for `?day=` dates before the cutover.
- `Played` gains `season` and `max`, so the history and bars normalise across the two seasons (170 vs 100).
- The streak runs across the cutover.

## Trade-offs

- **Turn-based triage loses the race.** Today's thrill is watching the ST rise and calling it fast. The new game is
  calmer and more realistic, and it's fair across devices. To keep a bit of the race, real seconds stay as a
  tiebreak and in the share line, unscored.
- **No-MI and NOMI days are thinner in the 3D interaction.** There's no spot to press, and their course is a
  multiple-choice disposition plus harm, not a physics fight for muscle. The heart still matters: reading the ECG is
  the game. When the cath lab (FFR) or the echo lands, those days gain a richer stage 3.
- **Late presenters look like early ones on the ECG** until ECG evolution exists (Q waves, T inversion). The onset
  time and the troponin carry the difference until then, and onset variety pays off more once that work lands.
  **Recommend sequencing: troponin and the season 2 flow first, ECG evolution right after.**
- **The OMI framing is more modern than "STEMI".** It's also more honest to the model, which knows the occlusion.
  But it departs from the STEMI-criteria language in ACC/AHA. The debrief should say both: "an occlusion MI; it met
  / did not meet STEMI criteria."
- **The troponin calibration (K, τ_rel) is assumed.** It's tuned to land in the right ESC zones, not fitted to
  kinetics data. Tag it, and add tests that pin the zones for reference cases (early STEMI, late NOMI, angina).
- **Nodal-artery and conus occlusions are still OMIs with almost no muscle.** Keep them rare. Their muscle stage is
  given in full by the existing tiny-stake rule, so they're won or lost on diagnosis and localisation.
- **Workup efficiency needs the minimum test set computed per case.** It's cheap to compute, but the rules are a
  table that has to be right. A simpler fallback is −5 per test beyond two, with no efficiency score at all.

## What it needs, in order

1. A troponin model and its config, with tests pinning the ESC zones (`src/physics/troponin.ts`, `src/config/`).
2. **Door state.**
   - Closed-form necrosis over the onset interval, and a clock jump that advances necrosis and troponin together.
   - **The sim gains an onset offset, and orders become events.** The MCP server's `corosim_treat`/`adjust` can
     share them: an AI could order a troponin too.
3. **`game.ts`.**
   - Class draw, per-class parameter draw, classification from physics, per-class solvability, minimum test set.
   - Scoring tables. Season-aware `dailyCase`.
4. **`app.ts`.**
   - Triage stage with order buttons, the four-way diagnosis, branching stage 3, re-presentation and false-activation
     paths, the new share line and card stats.
   - Remove `POINTS.speed`/`timeTau` for season 2.
5. **`advice.ts`.** A harm tag for a fibrinolytic given to a non-occlusion (bleeding risk without benefit).
6. **Later:** echo (needs regional wall motion), ECG evolution, STEMI mimics into the "no ischemia" class.
