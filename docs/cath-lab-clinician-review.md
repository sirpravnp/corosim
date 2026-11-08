# Cath lab simulator — clinician review checklist

Table 1. Assumed constants pending interventional-cardiology review.

| Source | Constant | Value | Meaning | Reviewer |
|--------|----------|-------|---------|----------|
| `src/config/lab.ts` | `realtimeMinutesPerSecond` | 1/60 | Infarct clock in real-time lab mode | |
| `src/config/lab.ts` | `ischemiaTauSeconds` | 20 | Ischemia rise τ in lab mode | |
| `src/config/lab.ts` | `actPerHeparinUnit` | 0.05 | ACT rise per heparin unit | |
| `src/config/lab.ts` | `actDecayPerSecond` | 1/12 | ACT decay per lab second | |
| `src/config/lab.ts` | `hydrophilicCrossingDiscount` | 0.4 | Wire crossing resistance reduction | |
| `src/config/lab.ts` | `branchMatchRotDeg` | 25 | Rotation match for branch takeoff | |
| `src/config/lab.ts` | `branchBendChoiceDeg` | 45 | Bend threshold for side branch | |
| `src/config/plaque.ts` | `calciumResistance` | 0.8 | Calcium limits balloon expansion | |
| `src/config/plaque.ts` | `recoilBalloon` / `recoilStent` | 0.08 / 0.03 | Elastic recoil | |
| `src/config/plaque.ts` | `dissectionBase` | 0.08 | Baseline dissection risk scale | |
| `src/config/plaque.ts` | `overexpandLimit` | 1.2 | Oversize injury threshold | |
| `src/config/plaque.ts` | `noReflowThrombusWeight` | 0.6 | Thrombus → no-reflow weight | |
| `src/config/plaque.ts` | `cleanDs` | 0.05 | Angiographically insignificant ds | |
| `src/lab/access.ts` | routing tortuosity factors | see code | Push transmission on access vessels | |
| `src/lab/wire.ts` | crossing push scale | 9 + 2×Ca | Lesion crossing versus prolapse | |
| `src/lab/balloonStent.ts` | jailing ostial ds | 0.3 + 0.4×(1−Dbranch/Dstent) | Side-branch jailing formula | |

Interventional review should confirm wire crossing, device sizing, complication rates, and no-reflow recovery before describing the lab as clinically realistic.
