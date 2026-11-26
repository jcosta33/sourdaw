import { type Track } from '#/modules/Arrangement/stores';

import { engineHostedStripIds } from './engineHostedStripIds';
import { type StripCarrier } from './stripCarriers';

/**
 * The engine-hosted set for a session that has claimed its strips (#4153):
 * every carried strip, plus the buses {@link engineHostedStripIds} names
 * against them. A claim is read off `create-track-strip` commands and never
 * names a bus, while the engine's own compensation counts a device on a bus
 * like any other. A delay measured against a different set than the session's
 * programme was read under lands off the material it is meant to move.
 */
export function carriedEngineHostedStripIds(
    carriedStripIds: ReadonlySet<string>,
    stripTracks: readonly Track[]
): ReadonlySet<string> {
    const carriers = new Map<string, StripCarrier>(
        Array.from(carriedStripIds, (stripId): [string, StripCarrier] => [stripId, { carrier: 'native' }])
    );
    return new Set([...carriedStripIds, ...engineHostedStripIds(carriers, stripTracks)]);
}
