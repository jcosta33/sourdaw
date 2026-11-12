# Standing probes: meter reading ownership

Defects where a destructive meter read lets one consumer drain, borrow or invent another's measurement.
Accumulated worklet peaks are read-and-reset low-level reads: the first read of a slot returns the peak and the
second returns zero. Independent displays must therefore share one measured channel sample for one actual
animation frame, while immediate reads outside a frame stay destructive. Each probe names the input, the check
that must go red and the mutation that must fail it. Report the concrete break or none.

## Standing probes

1. **One display drains another's signal.** Drive the real public query over the actual engine's worklet-init
   SAB, then mounted peak-hold and instantaneous meter callbacks in the same scheduler frame. The first read
   drains the slot, but every display receives that sample. Reverting query sharing or either consumer's exact
   timestamp forwarding must fail `meterPeakFanout.integration.spec.tsx`; static getter returns cannot expose it.
2. **One track borrows another's reading.** Read distinct channel values in one frame, then repeat each ID.
   `getTrackPeakLevel.spec.ts` and `createMeterFrameReader.spec.ts` must fail when channel identity is omitted.
   A master reading and a track reading remain separate queries, even when the track ID is `master`.
3. **A previous frame persists as current truth.** Publish a quieter value, measured zero and unavailable null on
   successive exact timestamps. The instantaneous display refreshes while its separately owned held maximum
   persists until reset. Immediate calls without a frame stay destructive, and frame storage forgets prior
   channels. Freezing the timestamp or retaining historical cache entries must fail `createMeterFrameReader.spec.ts`
   and `getTrackPeakLevel.spec.ts`.
4. **Carrier selection invents a measurement.** Keep native strip preference at measured zero, master web/native
   maximum, unavailable null and overflow unchanged. Cache the selected figure rather than falling back on
   truthiness or substituting silence; falling back on a native zero must fail `getTrackPeakLevel.spec.ts`, and the
   existing display null and overflow controls distinguish the remaining laws.
5. **A browser observer consumes the evidence.** Runs: CI; the reviewer reads the Affected end-to-end job running
   `tests/e2e/sharedMeterReadings.spec.ts` on the head. UI-create an instrument, a four-beat clip and a visible
   in-clip C4, authenticate raw and projected notes and the actual cursor interval, then observe mounted Mixer
   Master, Out and non-consuming analyser PCM: real signal and finite held and live displays across stop, reset
   and replay. From the fixed commit, check that the observer never calls a destructive peak getter, never
   demands a held maximum equal to every instantaneous sample, and never passes by skipping unavailable
   controls. This proves display behaviour, not hardware listening acceptance.
