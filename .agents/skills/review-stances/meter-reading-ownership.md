# Lesson library: meter reading ownership

Accumulated worklet peaks are destructive low-level reads; independent UI displays must share a measured
channel sample for one actual animation frame. `381ac558912f4fd9c8dd16a51bcb1c4829a7a0e7` introduced the
read/reset contract and `21b217f85965026b811b0b7f8444908669c8a551` first wired the live master SAB. Commit-to-PR
lookups returned no associated PRs; historical reviewer stances are unestablished. The live-tap regression
proved first-read0.6/second-read0, but did not mount independent displays. Preserve that primitive contract.

## Standing probes

1. **One display drains another's signal.** Drive the real public query over the actual engine's worklet-init
   SAB, then mounted peak-hold and instantaneous meter callbacks in the same scheduler frame. The first read
   drains the slot, but every display receives that sample. Reverting query sharing or either consumer's exact
   timestamp forwarding must fail `meterPeakFanout.integration.spec.tsx`; static getter returns cannot expose it.
2. **One track borrows another's reading.** Read distinct channel values in one frame, then repeat each ID.
   `getTrackPeakLevel.spec.ts` and `createMeterFrameReader.spec.ts` must fail when channel identity is omitted.
   A master reading and a track reading remain separate queries, even when its ID is `master`.
3. **A previous frame persists as current truth.** Publish a quieter value, measured zero and unavailable null on
   successive exact timestamps. The instantaneous display refreshes while its separately owned held maximum
   persists until reset. Immediate calls without a frame stay destructive, and frame storage forgets prior
   channels. Freezing the timestamp or retaining historical cache entries must fail the owning query/helper tests.
4. **Carrier selection invents a measurement.** Keep native strip preference at measured zero, master web/native
   maximum, unavailable null and overflow unchanged. Cache the selected figure rather than truthiness-falling back
   or substituting silence; the query specs and existing display null/overflow controls distinguish these laws.
5. **A browser observer consumes the evidence.** UI-create an instrument, four-beat clip and visible in-clip C4,
   authenticate raw/projected notes and the actual cursor interval, then observe mounted Mixer Master, Out and
   non-consuming analyser PCM. `sharedMeterReadings.spec.ts` requires real signal and finite held/live displays
   across stop/reset/replay. Never call a destructive peak getter from that observer, demand a held maximum equal
   every instantaneous sample, or pass by skipping unavailable controls. This proves display behavior, not hardware
   listening acceptance.
