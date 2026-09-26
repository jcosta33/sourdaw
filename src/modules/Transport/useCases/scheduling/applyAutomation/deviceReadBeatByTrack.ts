/**
 * The compensated device-family read beat `applyAutomation` resolved for each
 * track this tick, indexed `trackId → beat`.
 *
 * `applyAutomation` writes one entry per track that owns a device-family lane
 * (device parameters, MIDI-FX parameters, Fermenter runtime parameters) with
 * the PDC-compensated beat it read for that lane (`compensatedBeatFor`,
 * #4684), before any clip gating, so a lane skipped only because the
 * compensated beat has not yet reached its clip still leaves an entry.
 * `gain`, `pan`, and an existing send read the playhead beat instead and
 * never write here. `startPlayheadScheduler` hands the map to
 * `applyModulationToEngine`, whose `indexAutomatedBases` reads
 * `deviceReadBeats?.get(track.id) ?? currentBeat` for both its clip gate and
 * its curve read, falling back to the playhead beat for a track with no
 * entry. It is transport-owned scheduler state (the same pattern as
 * `schedulerSession` and `appliedAutomationBases`), not project truth.
 *
 * `applyAutomation` clears it in place at the top of every tick — emptying
 * rather than dropping the map, so the steady-state tick allocates nothing
 * beyond `Map.set` on existing keys — so a reader only ever sees the current
 * tick's beats.
 */
export const deviceReadBeatByTrack = new Map<string, number>();

/** Empty the map in place, keeping it allocated. */
export function clearDeviceReadBeatByTrack(): void {
    deviceReadBeatByTrack.clear();
}
