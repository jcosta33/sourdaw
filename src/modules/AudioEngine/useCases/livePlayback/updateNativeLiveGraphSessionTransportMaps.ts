/**
 * Replace the transport maps a live native session is following (#3105,
 * D3.c.4a).
 *
 * The loop region is why this exists, and it is not addressable on its own from
 * here. The graph batch's `set-transport` owns playing and position and nothing
 * else — the transport ownership law in
 * `crates/sourdaw-native/src/commands/graph.rs` — so the region has no command
 * in that batch at all. Its only route is `engine_transport_set_maps`, which
 * emits `SetTransportMaps` and `SetLoopRegion` together in one
 * `send_graph_batch` (`crates/sourdaw-native/src/commands/engine_transport.rs`).
 * A loop edit therefore re-installs the whole pair, and the tempo and meter
 * halves of it are simply re-stated at the values they already held.
 *
 * That is affordable exactly where it has to be. Both maps are built on the
 * control thread, and the audio thread only swaps the box in: the one it
 * displaces leaves over the retirement channel rather than being freed there
 * (`GraphCommand::SetTransportMaps` in `crates/daw-engine/src/scheduler.rs`),
 * and `SetLoopRegion` is a plain copy into a field. Nothing about re-installing
 * allocates or frees on the audio thread.
 *
 * ── It carries no playing state ───────────────────────────────────────────
 *
 * Nothing here asserts whether the engine is rolling, and that is what makes it
 * safe to send to a session `startNativeLiveGraphSession` deliberately parked
 * because its maps declined. That park exists to keep the *previous* take's
 * tempo map and loop seam unreachable, and this write is precisely what
 * replaces that stale pair — so a parked engine gains correct maps and stays
 * parked, while a rolling one keeps rolling under the region the musician just
 * set. Locating the transport is a different gesture with a different command.
 *
 * ── Ordering ──────────────────────────────────────────────────────────────
 *
 * Queued on the session chain, like every other command that shares this
 * engine. The chain is what orders a maps write against a start's own install
 * and against the next loop edit: a burst of edits must leave the engine
 * holding the last one *issued*, not the last one whose round trip happened to
 * resolve.
 */

import { type EngineTransportMaps } from '../../models/EngineTransportPosition';
import { setEngineTransportMaps } from '../../repositories/engineTransport/setEngineTransportMaps';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';

export type UpdateNativeLiveGraphSessionTransportMapsInput = Readonly<{
    /**
     * The arrangement's tempo map, meter map and loop region, already projected
     * into engine coordinates — the same shape a session start carries, and
     * produced by the same projection, so the two cannot disagree about where a
     * beat falls.
     */
    transportMaps: EngineTransportMaps;
}>;

export type UpdateNativeLiveGraphSessionTransportMapsResult =
    Readonly<{ outcome: 'updated' }> | Readonly<{ outcome: 'declined'; reason: string }>;

export function updateNativeLiveGraphSessionTransportMaps(
    input: UpdateNativeLiveGraphSessionTransportMapsInput
): Promise<UpdateNativeLiveGraphSessionTransportMapsResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<UpdateNativeLiveGraphSessionTransportMapsResult> => {
        if (!nativeLiveGraphSession.backend) {
            return { outcome: 'declined', reason: 'no live native graph session' };
        }
        const maps = await setEngineTransportMaps(input.transportMaps);
        if (maps.outcome === 'declined') {
            // The engine keeps the pair it already had, which is the pair
            // this session installed at its start. The session itself is
            // untouched: a refused maps write says nothing about the
            // topology or the handle it was sent through.
            return { outcome: 'declined', reason: maps.reason };
        }
        return { outcome: 'updated' };
    });
}
