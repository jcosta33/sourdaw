/**
 * The compensated device-family read beat `applyAutomation` resolved for each
 * track this tick, indexed `trackId → beat`.
 *
 * `applyAutomation` and `indexAutomatedBases` (inside
 * `applyModulationToEngine`) both gate and read the *same* clip-owned device
 * lanes, but they used to do it on two different clocks: `applyAutomation`
 * reads device-family parameters one PDC delay behind the playhead
 * (`compensatedBeatFor`, #4684), while `indexAutomatedBases` kept gating and
 * reading at the raw playhead beat. A clip-owned lane whose compensated beat
 * had not yet crossed into the clip therefore still contributed its
 * playhead-beat value as modulation's base — the wrong source, and one
 * `applyAutomation` had not itself written this tick.
 *
 * This map is the hand-off that fixes that: `applyAutomation` records the
 * compensated read beat here for every track that owns a device-family lane
 * (device parameters, MIDI-FX parameters, Fermenter runtime parameters — never
 * `gain`, `pan`, or an existing send, which stay on the playhead), before any
 * clip gating, so a lane skipped only because the compensated beat has not yet
 * reached its clip is still recorded. `startPlayheadScheduler` then hands the
 * map to `applyModulationToEngine`, whose `indexAutomatedBases` reads
 * `deviceReadBeats?.get(track.id) ?? currentBeat` for both its clip gate and
 * its curve read, so the two passes agree on one beat per track. It is
 * transport-owned scheduler state (the same pattern as `schedulerSession` and
 * `appliedAutomationBases`), not project truth.
 *
 * Lifecycle: `applyAutomation` clears it at the top of every tick, so a reader
 * only ever sees the current tick's beats. It is cleared by emptying the map
 * in place rather than dropping it, so the steady-state tick allocates
 * nothing beyond `Map.set` on existing keys.
 *
 * A track with no device-family lane has no entry — `gain`/`pan`-only tracks
 * never write here, and `indexAutomatedBases` falls back to `currentBeat` for
 * them (unchanged, since they were never on the compensated clock to begin
 * with).
 */
export const deviceReadBeatByTrack = new Map<string, number>();

/** Empty the map in place, keeping it allocated. */
export function clearDeviceReadBeatByTrack(): void {
    deviceReadBeatByTrack.clear();
}
