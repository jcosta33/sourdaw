---
type: adr
id: 0064
title: The built-in compressor's browser makeup gain is an explicit switch
status: accepted
date: 2026-11-20
owner: The Sourdaw team (owner decided to keep old projects' sound behind an explicit Auto Makeup switch, 2026-11-20)
sources:
    - src/modules/Arrangement/models/PluginDescriptors/BuiltinEffectDescriptors.ts
    - src/modules/Arrangement/models/StoredDeviceParameterMigration.ts
    - src/modules/AudioEngine/repositories/devices/dynamics/applyCompressorAutoMakeup.ts
    - src/utils/dynamicsCompressorMakeupLaw.ts
    - tests/e2e/compressorAutoMakeupRender.spec.ts
---

# 0064 — The built-in compressor's browser makeup gain is an explicit switch

## Context

`builtin-compressor` runs on Chromium's `DynamicsCompressorNode`. Blink multiplies the node's
output by a post-gain it derives from threshold, knee and ratio alone,
`powf(1 / Saturate(1, k), 0.6f)`; the Web Audio specification names no such gain and no control on
the node removes it. At the descriptor defaults (threshold −20 dB, knee 6 dB, ratio 4) it adds
7.85 dB, and at threshold −60 dB, ratio 20, no knee it adds 34.2 dB (both measured in Chromium by
`compressorAutoMakeupRender.spec.ts`). The Makeup control (0..30 dB, default 0) and the transfer
curve showed none of it, so the device was louder than every figure it reported.

Every compressor stored so far, and every preset, recipe and template voiced on it, sounds with that
gain. Removing it outright would change the level of every existing project.

## Decision

1. **Auto Makeup is a declared switch parameter, `comp-auto-makeup`** (`bool`, 0..1, not
   automatable), carried in `parameterValues` like every other device setting. On renders the node's
   own makeup exactly as before the switch existed; off cancels it, so Makeup is the only gain.
2. **A new device starts off.** The declared default is 0, and `addDevice` writes every declared
   parameter's value, so a placed compressor tells the truth from its first sample.
3. **A stored device without the value reads as on.** `migrateStoredDeviceParameterValues` gained
   a second migration kind beside the unit rescale: a parameter added after devices were stored is
   filled with the value the old device sounded like, only where the record lacks the key. Every
   read of a stored device goes through it (the CRDT projection, track templates, user presets),
   and it is idempotent because a filled key is present. The fill never reaches the document: the
   track store writes through `encodeStoredDeviceParameterValues`, its inverse, so the document
   stores the switch on as absence and off as 0, while every store reader sees an explicit 0 or 1.
   Without that, the projected fill would land in every legacy compressor on the first unrelated
   write to its track. The engine applies the same reading: a
   node whose parameters never name the switch (an adjustment layer, any caller that predates it)
   stays on.
4. **Factory presets, mix recipe steps, project templates and the demo state the switch on**,
   because their makeup values were voiced with the browser gain in the output. No level they
   produce changes.
5. **Off is cancelled by measurement, not by formula.** A twin `DynamicsCompressorNode` fed a probe
   below Blink's detector floor (any peak at or below 0.0001 reads as no attenuation) outputs the
   probe times the hidden gain; a reciprocal `WaveShaperNode` drives a trim gain with its inverse.
   The twin takes every write and every offline automation schedule of threshold, knee, ratio,
   attack and release, so the cancellation runs on the node's own render quanta through any
   automation, several parameters together included. A ported copy of Blink's law
   (`dynamicsCompressorMakeupLaw.ts`) draws the panel's curve and predicts the measurements.

## Alternatives considered

| Alternative                                                     | Why rejected                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Remove the hidden gain for every device                         | Changes the level of every stored project, preset and template.                                                                                                                      |
| Keep the gain and only report it                                | The Makeup control would still not be the device's gain, and a new device would still add up to 34 dB the user never asked for.                                                      |
| A versioned device state instead of a parameter                 | The parameter machinery already persists, undoes, migrates and publishes a switch; a second state carrier would need its own copies of all four.                                     |
| Compute the cancellation from the ported law in the main thread | Live writes would follow, but offline automation schedules one AudioParam per lane, so a cancellation computed per lane cannot follow two automated static-curve parameters at once. |
| Replace the node with a compressor of our own                   | Changes the sound of the switch-on path, which must stay the sound old projects were mixed with.                                                                                     |

## Consequences

- A compressor a user adds from now on is up to 34 dB quieter than the same settings were before;
  its Makeup control now states its level. Turning Auto Makeup on restores the old sound.
- A `setDeviceParameter` on an `edit` recipe step that retunes an existing compressor also turns
  the switch on, because that step's makeup window was voiced with the browser gain.
- An expansion that adds a compressor writes the switch on as one more command. The Master Bus
  Polish chain preset now needs 17 commands, one past the expansion ceiling, so recipe discovery
  withholds it as it withholds the other oversized chain presets; loading the preset is unchanged.
- The native engine hosts no `builtin-compressor` body, so the switch lives entirely in the Web
  Audio graph, live and offline alike.
