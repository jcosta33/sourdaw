/**
 * Give a live native session the arrangement's current projected transport maps
 * (#3105, #3109).
 *
 * Called from `initNativeLiveGraphTransportMapsSync` whenever a maps-relevant
 * store write lands while a native session is held — loop fields on
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
 * ── Only while a session is held ──────────────────────────────────────────
 *
 * A parked engine renders no frame at all, so its loop seam is unobservable
 * until play rolls it — but a session can stay held while parked, and a CRDT
 * hydrate can clear `isPlaying` without stopping that session. The gate is
 * whether this process holds a native backend, not the transport's `isPlaying`.
 *
 * ── Fired, never awaited ──────────────────────────────────────────────────
 *
 * Web Audio is the audible path, so no store-driven sync waits on a bridge
 * round trip, exactly as pause and seek do not. A decline is the ordinary
 * answer in a browser build — there is no session to update — and it leaves
 * the transport precisely where it already was.
 */

import { logger } from '#/infra/logger/appLogger';
import {
    isNativeLiveGraphSessionHeld,
    updateNativeLiveGraphSessionTransportMaps,
} from '#/modules/AudioEngine/useCases';

import { projectEngineTransportMaps } from '../tempoMap/projectEngineTransportMaps';

export function sendLoopRegionToNativeSession(): void {
    if (!isNativeLiveGraphSessionHeld()) {
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
