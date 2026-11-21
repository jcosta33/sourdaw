---
type: adr
id: 0066
title: The built-in limiter's browser makeup gain is an explicit switch
status: accepted
date: 2026-11-21
owner: The Sourdaw team (extends ADR 0064 to the limiter, issue 7302)
sources:
    - src/modules/Arrangement/models/PluginDescriptors/BuiltinEffectDescriptors.ts
    - src/modules/Arrangement/models/StoredDeviceParameterMigration.ts
    - src/modules/AudioEngine/repositories/devices/dynamics/applyAutoMakeupSwitch.ts
    - src/modules/AudioEngine/repositories/devices/dynamics/applyLimiterParams.ts
    - tests/e2e/limiterAutoMakeupRender.spec.ts
---

# 0066 — The built-in limiter's browser makeup gain is an explicit switch

## Context

`builtin-limiter`'s first stage is Chromium's `DynamicsCompressorNode` at ratio 20 and no knee,
followed by its ceiling gain and ceiling clip. The node adds the same hidden post-gain ADR 0064
describes for the compressor, here 0.6 × |threshold| × (1 − 1/20) dB: +3.42 dB at the default −6 dB
threshold, +13.68 dB at −24 dB and +17.1 dB at the −30 dB minimum (measured in Chromium by
`limiterAutoMakeupRender.spec.ts`). The limiter declares no loudness matching and describes its
threshold as where it begins catching peaks, so lowering it to catch more peaks also raised
everything below it, by up to 17 dB, into the ceiling.

## Decision

1. **The limiter takes ADR 0064's switch unchanged.** `lim-auto-makeup` is a declared `bool`
   (0..1, not automatable). A new device starts off; a stored record without the key reads as on
   through the same `StoredDeviceParameterMigration` fill and is stored back as absence through the
   same encoding, so saved projects, frozen-track signatures and undo histories keep their sound.
2. **One canceller serves both devices.** `applyAutoMakeupSwitch`, moved out of the compressor's
   applier, takes any `DynamicsCompressorNode` and the trim gain after it.
   The limiter's trim sits between the node and the ceiling gain, so the ceiling clip caps the
   output whichever way the switch is set. The twin mirrors every value the node holds, which for
   the limiter means its threshold and release and its fixed ratio 20, knee 0 and 1 ms attack, and
   the automation binding map schedules `lim-threshold` and `lim-release` on the twin too.
3. **Sites that place a limiter state the switch per what they render today.**

    | Site                                                                  | Threshold                      | Hidden gain below threshold today | Switch | Level after |
    | --------------------------------------------------------------------- | ------------------------------ | --------------------------------- | ------ | ----------- |
    | Factory preset Brick Wall (`presetHelpers/limiter.ts`, every user)    | −1 dB                          | +0.57 dB                          | on     | unchanged   |
    | Master recipe `master-tight` (edit step retuning an existing limiter) | −6..−2 dB                      | +3.42..+1.14 dB                   | on     | unchanged   |
    | Master chain EDM and rock templates (`setMasterChain`)                | node default −6 dB (see below) | +3.42 dB                          | on     | unchanged   |
    | Master chain podcast template (`setMasterChain`)                      | −2 dB                          | +1.14 dB                          | on     | unchanged   |
    | Podcast template Voice Limit                                          | −3 dB                          | +1.71 dB                          | on     | unchanged   |
    | Nebula Drift demo master Ceiling                                      | −0.9 dB                        | +0.51 dB                          | on     | unchanged   |
    | Agent preset action Add Limiter, and a plain device add               | descriptor default −6 dB       | +3.42 dB                          | off    | unity       |

    A plain add, the agent's included, is the case the defect is about, so it starts off exactly as
    ADR 0064's Add Compressor does. Every other site was voiced with the hidden gain in the output
    and keeps it. The EDM and rock master chains name `threshold`, `release` and `ceiling`, which the
    limiter does not declare, so they render the node's defaults; stating the switch on keeps that
    render, and the stray keys are a separate defect.

## Alternatives considered

| Alternative                                     | Why rejected                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Remove the hidden gain for every limiter        | Changes the level of every stored project, preset and template, as ADR 0064 found for the compressor.        |
| Copy the compressor's canceller for the limiter | Two copies of one measurement would drift; the node, the gain and the cancellation are the same for both.    |
| Cancel after the ceiling clip                   | The clip would cap the raised signal first, so cancelling afterwards would leave the ceiling below its knob. |
| Turn the switch on for the agent's Add Limiter  | It is a plain add; the user and the agent would get two different limiters from one action name.             |

## Consequences

- A limiter added from now on passes material below its threshold at the ceiling gain alone, up to
  17 dB quieter than the same settings were before. Turning Auto Makeup on restores the old sound.
- The `master-tight` recipe gains one `setDeviceParameter` turning the switch on, like ADR 0064's
  compressor edit steps.
- The native engine hosts no `builtin-limiter` body, so the switch lives entirely in the Web Audio
  graph, live and offline alike.
