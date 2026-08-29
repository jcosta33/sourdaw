/**
 * Give the rolling native engine the loop region a gesture just committed
 * (#3105, D3.c.4a).
 *
 * Until this existed the region reached the engine only at
 * `startNativeLiveGraphSession`, so an engine that was already rolling kept
 * wrapping at the seam play was pressed with: engage the loop mid-take and it
 * played straight through, drag the brace and it wrapped where the brace used
 * to be, while the Web Audio transport the musician hears honoured the new
 * region immediately. Every loop gesture calls this after its own commit,
 * because the region it sends is read back out of the transport store rather
 * than passed down — one projection of what the transport now says, not a
 * second derivation of what each gesture meant.
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
 * than anything about the engine, because that is the state the gesture just
 * happened under.
 *
 * ── Fired, never awaited ──────────────────────────────────────────────────
 *
 * Web Audio is the audible path, so no loop gesture waits on a bridge round
 * trip, exactly as pause and seek do not. A decline is the ordinary answer in a
 * browser build — there is no session to update — and it leaves the transport
 * precisely where it already was.
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
