import { startInputMonitoring } from '#/modules/AudioEngine/useCases';

import type { Track } from '../models/Track';

/**
 * Re-arms hardware input monitoring for the tracks whose persisted intent is
 * `'on'`, against the strips a rebuild has just produced.
 *
 * A graph reset releases every monitor capture, so a rebuild of the same
 * project must restart each `'on'` track's own signal. `'auto'` is
 * engine-driven by arm state and engages no monitor here (see
 * `toggleInputMonitoring` and `startNativeLiveGraphSession`), so only `'on'`
 * re-arms. Every start is settled and an individual refusal — a missing or
 * denied device — is ignored: a re-arm must never turn a successful rebuild or
 * restore into a failure.
 */
export async function rearmInputMonitoring(tracks: readonly Track[]): Promise<void> {
    const monitoredTracks = tracks.filter((track) => track.inputMonitoring === 'on');
    await Promise.allSettled(monitoredTracks.map((track) => startInputMonitoring(track.id, track.inputId)));
}
