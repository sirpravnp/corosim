# Echo simulator: a movable probe, an ideal slice, and an echo image that turns real

Status: design reference, no app code yet. Replaces the "pick one of three views" echo atlas with a probe the student moves. Builds on `src/echo/*` and `docs/ECHO_ATLAS.md`.

## Intent

A student should see how an echo image maps onto the heart. Today the echo page shows the probe on the 3D heart beside a real loop for three fixed views. That shows where the probe goes, but not why the image looks the way it does.

The page becomes three panes, each with one job:

| Pane | Job | Source |
|---|---|---|
| 1. Probe on the 3D heart | Where the probe sits and how the scan plane cuts the heart | `EchoScene` (exists) |
| 2. Ideal cross-section | The perfect-anatomy cut at that plane, with a labels on/off toggle | Computed live from our heart model (new) |
| 3. Echo image | What that plane looks like as ultrasound: stylized from our model, and replaced by a real loop when the probe is at a standard view | Shader plus real loops (new, extends existing) |

The student moves the probe in pane 1 and panes 2 and 3 follow.

## Decisions (the user's, unless marked as a call)

- The probe is movable in 3D. It is not limited to a list of views.
- Pane 2 is a simulated, labeled slice of our own model. Labels toggle on and off.
- Pane 3 is a projected echo in a stylized (shader) look. When the probe is near a standard view, the real image **replaces** the stylized image in place. It does not sit beside it.
- Calls (mine, change freely): the replacement is a short crossfade as the probe closes in, not a hard pop; a small badge names the reference view when the real clip is live; first calibrated views are listed under Views.

## Goals, non-goals, anti-goals

Goals
- The student can drag the probe and watch the slice and the echo change continuously.
- Standard views are easy to reach: a view picker snaps the probe to the calibrated pose, and dragging near one pulls it in.
- Labels in pane 2 let the student name every structure in the echo.
- Honest about what is real: the badge shows when pane 3 is a real image and when it is simulated.

Non-goals
- No claim that the stylized image is a realistic ultrasound. It is a teaching rendering.
- No ribs, lungs or sternum, so no acoustic window loss. A pose shows where the probe has to be, not that a window exists there (already stated in `poses.ts`).
- No pixel registration of real clips to our model. The clips come from other patients, so sizes and orientation will not match exactly.
- No trained image generator in this phase.

Anti-goals (a failure even if it works)
- A student concludes the stylized image is what a patient's echo looks like.
- The swap to a real clip jumps in size, orientation or brightness so much that it reads as a different page.
- A student takes the real clip as proof that our model is patient-accurate.

## What exists, and what that means

- `src/anatomy/heartSurface.ts` defines the heart as an analytic signed distance function: `heartSdf(p)` (negative inside), plus `partAt(p)` returning LV, RV, RA, LA or Aorta, plus morph variants for congenital shapes. **Slicing is therefore cheap:** for each pixel of the scan plane, evaluate the function and get inside/outside and chamber. No mesh clipping is needed, and it can run per pixel in a fragment shader or once on the CPU.
- `src/echo/poses.ts` builds a probe pose (probe point, beam, lateral axis, depth, index marker) from heart landmarks for PLAX, PSAX at the papillary level, and subcostal. Everything is in the patient frame, mm. The sector is a fixed +-45 degree fan (`SECTOR`).
- `src/echo/scene.ts` draws the heart shell, probe and fan, and squares the camera on the plane.
- `src/echo/views.ts` holds view text and the clip manifest; `media/` has three clean `.webm` loops (plax, psax-pm, subcostal); `cleanVideo.ts` masks them to the sector.
- Not yet present: probe dragging, the slice, the shader, valve leaflets, wall thickness labels, apical views.

## Design

### Probe model
A probe state is a position on the chest plus orientation: slide (two parameters on a chest-surface patch), tilt, and rotate about the beam axis. Mapping those to the existing `Pose` fields (probe, beam, lateral) keeps pane 1 and the pose table unchanged. Standard views are stored as presets of this state, and the existing `buildPoses` output becomes the first presets.

Chest surface (my call): a schematic ellipsoid or offset shell around the heart, not an anatomical torso. The probe is constrained to it. It exists to keep the probe plausible and to make "slide" meaningful, not to model ribs.

### Pane 2: ideal slice
Sample the sector in the plane (probe, beam, lateral) at a fixed resolution. For each sample, `partAt` and `heartSdf` give the chamber and the wall. Draw chambers as flat labeled regions on a dark field, with a thin outline at walls. Labels are drawn at region centroids and update as the plane moves. The toggle shows and hides them.
Open modeling gap: valves, papillary muscles and the septum's thickness are not in the SDF. PLAX and short-axis labels for "aortic valve" and "mitral leaflets" need either marker points from `LANDMARKS_HEART_FRAME` or simple added geometry. Decide during build: valve labels can be point markers at the valve plane crossing, which needs no new geometry.

### Pane 3: echo image
Stage A, stylized: the pane 2 sample field is turned into an echo-like image: speckle texture, brighter borders at tissue interfaces (the SDF gradient gives the normal, so interfaces facing the beam are brighter), depth gain falloff, and a faint near-field artifact. Grayscale, low contrast, masked to the same sector.
Stage B, real: when the probe pose is within tolerance of a standard view (distance in position plus angle, tunable), the real loop for that view fades in over the stylized image, masked to the same sector shape by `cleanVideo.ts`, with the badge "Reference echo: <view>". Leaving the zone fades back out.
Matching: scale and place the real clip's sector to the model's sector so the apex of the fan and its depth align, and match gray level. This is aligned but not registered (see non-goals).

### Standard views
Calibrated first (need a pose and a real clip each):

1. Parasternal long axis (have pose and clip)
2. Parasternal short axis, papillary level (have both)
3. Subcostal four-chamber (have both)
4. Apical four-chamber (need pose, clip)
5. Apical two-chamber (need pose, clip)
6. Apical three-chamber (need pose, clip)
7. Parasternal short axis, mitral and aortic levels (need poses, clips)
8. Subcostal IVC (need pose, clip)

Until a view has a real clip, the picker still snaps to its pose and pane 3 stays stylized. That keeps pose work independent from clip sourcing. Clip licensing follows `docs/ECHO_ATLAS.md`: only CC BY or CC0 clips ship; datasets with data-use agreements are for dev-time checks only.

### Beyond the first release (ideas, not committed)
- Slice playback with the simulator: wall motion from the beating heart, so panes 2 and 3 animate and show ischemic segments.
- "Find the view" challenge: name a target view, the student tries to place the probe, with a score for distance and angle.
- A toggle for the beam-plane orientation marker and left/right screen convention.
- Pathology cases (the structural tab's morph hearts) sliced by the same code, since the morph SDFs exist.
- Later and separate: an image generator for pane 3 beyond the shader look.

## Constraints
- American English in copy and comments. Follow `DESIGN.md` and the UI rules in `CLAUDE.md`: square hairline frames, no glass or tinted callouts, ECG-style pink paper not involved here, figures captioned "Figure N.".
- Every shipped clip carries license, author and source in the manifest, as today.
- The schematic heart means labels and views are teaching defaults; the page should say so once, plainly.

## Left to the builder
- Slice resolution, the speckle and gain look, and the crossfade width and tolerance values.
- Whether the slice runs on the GPU or CPU (per-pixel SDF cost decides).
- How valves and leaflets are marked (points or small geometry).
- Control scheme for the probe (drag on the chest, sliders, or both) and touch behavior.

## Order of work (proposal)
1. Slicer and pane 2 for the three existing poses, with labels toggle.
2. Movable probe on a chest shell, with presets and snapping.
3. Stylized pane 3 and the crossfade to the real clip.
4. New poses and clips for the apical, short-axis and IVC views.
5. Sim coupling and the challenge mode.
