/**
 * Give a live native session the arrangement's current projected transport maps
 * (#3105, #3109).
 *
 * Called from `initNativeLiveGraphTransportMapsSync` whenever a maps-relevant
 * store write lands while the transport is playing — loop fields on
 * `transportStore`, or a change to `tempoMapStore` / `timeSignatureMapStore`.
 * The region and maps are read back out of those stores rather than passed
 * down, so every writer (gesture, tempo use case, CRDT hydrate) shares one
 * projection of what the transport now says.
 *
 * `projectEngineTransportMaps` is that projection, and reusing it is the point:
 * loop bounds are authored in beats and the engine is addressed in seconds, so
 * the conversion runs through the arrangement's tempo map. A region integrated
 * any other way would sit at a different second than the tempo map the engine
 * is already following puts it at.
 *
 * ── Only while playing ────────────────────────────────────────────────────
 *
 * A parked engine renders no frame at all, so its loop seam is unobservable and
 * a write to it buys nothing; the next play re-sends the region with the maps
 * anyway (`startPlayback`). The gate is the transport's own `isPlaying` rather
 * than anything about the engine, because that is the state the write just
 * happened under.
 *
 * ── Fired, never awaited ──────────────────────────────────────────────────
 *
 * Web Audio is the audible path, so no store-driven sync waits on a bridge
 * round trip, exactly as pause and seek do not. A decline is the ordinary
 * answer in a browser build — there is no session to update — and it leaves
 * the transport precisely where it already was.
 */

import { logger } from '#/infra/logger/appLogger';
import { updateNativeLiveGraphSessionTransportMaps } from '#/modules/AudioEngine/useCases';

import { getTransportState } from '../../repositories/transport/getTransportState';
import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

export function sendLoopRegionToNativeSession(): void {
    if (getTransportState()?.isPlaying !== true) {
        return;
    }

    Promise.resolve(updateNativeLiveGraphSessionTransportMaps({ transportMaps: projectEngineTransportMaps() }))
        .then((result) => {
            if (result.outcome === 'declined') {
                logger.debug(`Native live graph session did not take the loop region: ${result.reason}`);
            }
        })
        .catch((error: unknown) => {
            logger.warn(new Error('Native live graph session failed to follow a loop edit', { cause: error }));
        });
}
