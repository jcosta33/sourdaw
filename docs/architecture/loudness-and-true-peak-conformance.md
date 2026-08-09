# Loudness and true-peak conformance

Standards-derived reference for anyone touching `crates/daw-dsp/src/proof/{true_peak,metering}.rs`,
`crates/daw-dsp/src/crust/`, or
`src/modules/AudioRendering/repositories/audioEncoders/{measureIntegratedLoudness,createKWeightingFilters}.ts`.

Promoted from a workspace research artifact. Everything below is quoted from or derived against
primary sources, so it does not need re-deriving. Where a claim was not verified, it says so.

## Which revision

**ITU-R BS.1770-5 (11/2023). Annex 1 is byte-for-byte unchanged from BS.1770-4** — same K-weighting
coefficient tables, same −0.691 offset, same 400 ms / 75 % gating, same −70 LKFS and −10 LU
thresholds, same `G_i` channel weights. **Annex 2 (true peak) is likewise unchanged.** -4 added
Annex 3 (advanced/immersive loudspeaker configurations); -5 adds Annex 4 (object-based audio).
Neither is touched by anything we measure.

A conforming -4 implementation is still conforming under -5 for channel-based audio. Pin -5 anyway,
because the true-peak argument below is quoted from the -5 PDF and a document that pins -4 while
quoting -5 makes every reader check whether the quotation still applies.

## True peak — what 4× proves and what it does not

**Choose the oversampling factor against the error budget, not against a target sample rate.**

BS.1770 Annex 2 Attachment 1 gives the worst-case under-read for an `n`× over-sampled peak reading
of a sinusoid at normalised frequency `f_norm` (fraction of Nyquist):

```
under-read (dB) = 20 · log10( cos( π · f_norm / n ) )
```

| n | under-read at `f_norm` 0.45 | at `f_norm` 0.5 |
| --- | --- | --- |
| **4** | **0.554 dB** | **0.688 dB** |
| 8 | 0.136 dB | 0.169 dB |
| 16 | 0.034 dB | 0.042 dB |

**EBU Tech 3341 §2.6** sets the true-peak conformance tolerance at **+0.2 / −0.4 dBTP**, and states
it is all-in — *"including any pass-band ripple in the upsampling filter and the 'under-read'
described in ITU-R BS.1770."*

A literal 4× implementation can exceed the −0.4 dB tolerance for an arbitrary sinusoid phase before
filter ripple is counted. That worst-case bound does **not** predict the result of a specific Tech
3341 vector. Cases 15 and 16 use fs/4 sines at 0° and 45°; a 4× sample grid includes their waveform
peaks, so the 0.688 dB arbitrary-phase bound is not their measured under-read. Cases 15–23 must be
run against the implementation before claiming either conformance or failure.

`f_norm` is normalised, so the worst-case bound is a function of `n` alone and is **identical at
44.1 kHz and 48 kHz**. An older "smallest power of two whose product with the source rate is ≥
192 kHz" rule therefore changes the bound by source rate even though the equation does not. 192 kHz
is a rate the recommendation's *illustration* reaches; it is not a requirement.

Using 8× bounds phase-grid under-read below 0.2 dB at Nyquist and leaves budget for filter ripple, but
that is a conservative design choice, not an EBU-mandated minimum. Choose the factor only after the
actual filter and all official vectors are measured. If the combined result exceeds the tolerance,
increase the factor or change the filter and rerun the same vectors.

Score true-peak cases in **dBTP against +0.2 / −0.4**. The ±0.1 LU figure governs Tech 3341's
*loudness* minimum-requirement cases and does not apply to true peak.

### The current implementation is unverified

`true_peak.rs` declares `PHASES: usize = 4`, consumed by `TruePeakDetector` in `metering.rs`.
`measureTruePeak.ts` independently uses four phases. Neither implementation runs Tech 3341 cases
15–23, so neither has evidence for an EBU-conformance claim or a failure claim. Add the official
vectors to both paths and score them in dBTP against the published tolerance.

The same 4× filter is **shared with the limiter's gain computer by deliberate design** (*"the dBTP
the meter shows and the dBTP the limiter enforces come from one filter"*), so raising the factor is a
Crust-and-Proof change, not a meter-local one.

## Loudness — what the repository pins

| Quantity | Value | Pinned in |
| --- | --- | --- |
| Shelf `f0` | 1681.974450955533 Hz | `createKWeightingFilters.ts` |
| Shelf gain | 3.999843853973347 dB | `createKWeightingFilters.ts` |
| Shelf Q | 0.7071752369554196 | `createKWeightingFilters.ts` |
| RLB high-pass `f0` | 38.13547087602444 Hz | `createKWeightingFilters.ts` |
| RLB high-pass Q | 0.5003270373238773 | `createKWeightingFilters.ts` |
| Block length / step | 400 ms / 100 ms (75 % overlap) | `measureIntegratedLoudness.ts` |
| Loudness offset | −0.691 | `measureIntegratedLoudness.ts` |
| Absolute gate Γa | −70 LUFS | `measureIntegratedLoudness.ts` |
| Relative gate Γr | −10 LU below the absolute-gated mean | `measureIntegratedLoudness.ts` |
| Channel weights `G_i` | 1.0 L/R/C, 1.41 surround; **LFE excluded** | `measureIntegratedLoudness.ts` |

Gated loudness is evaluated over blocks satisfying **both** gates.

Two points of history, so they are not re-litigated:

- The **−8 → −10 LU** relative-gate change was an **EBU** change, in Tech 3341's revision history —
  not an ITU one. **BS.1770-2 already specified −10 LU.** −8 LU in older EBU material is superseded
  EBU text, not a different ITU revision.
- *Unverified:* which ITU revision introduced the two-gate conjunction. It is present in -4/-5 and
  absent from -2, both read directly; -3 was not read. Nothing depends on the answer, but do not
  assert the attribution or an equation number for it.

The 12.04 dB (2-bit shift) attenuation in Annex 2's true-peak stages "is not necessary if the
calculations are performed in floating point" — an f32/f64 path may skip it.

## Three implementations of one measurement

`measureIntegratedLoudness` + `createKWeightingFilters` derive the biquads from the recommendation's
parameters **at the actual sample rate**, and their spec guards the 48 kHz-reuse mistake. This is the
correct path — export runs at 44.1 kHz by default.

`crates/daw-dsp/src/proof/metering.rs` also implements BS.1770 but adapts to non-48 kHz rates by
scaling coefficients by `48000.0 / sr` rather than redesigning the biquads.

Two others are fabrications to delete rather than fix: `computeMomentaryLUFS`, whose one-pole
`state - 0.85 * prevSample` is not K-weighting yet still wears the standard's −0.691 offset; and the
fader-derived `const lufs = rmsDb - 3` in `analyzeMix.ts`, which reads no audio at all.

Three implementations of one measurement is how a wrong number reaches a user while a right one sits
unused ten files away.
