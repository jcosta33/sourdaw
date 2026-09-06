/**
 * Move a rolling native engine to a new position without interrupting it
 * (#3101, D3.c.4a).
 *
 * A locate, not a restart. The command carries nothing but the transport, and
 * that is enough because everything a relocated playhead has to be governed by
 * is already installed on this session and survives the move:
 *
 * - The loop region is `SetLoopRegion`'s alone (`scheduler.rs`), so it is
 *   untouched here. `frames_until_loop_end` reads the *current*
 *   `playhead_frames` on every span, so the next callback bounds the new
 *   position against the region already standing. Landing inside the region
 *   wraps at its end as usual; landing past it plays straight through, which
 *   the engine states as the meaning of a locate past the loop end and is what
 *   every DAW that allows one does.
 * - The tempo and meter maps are `SetTransportMaps`' alone, and
 *   `refresh_transport_at` re-derives tempo, meter and beat position from them
 *   at the frame each span starts on. So the engine reports the arrangement's
 *   tempo at the new position without being told it again.
 *
 * - The master fader is a smoother the engine advances per sample rather than a
 *   stamped write (`MasterFader`, `timeline.rs`), so a locate cannot reach it:
 *   it holds no frame for the seek to invalidate, and a glide the locate
 *   interrupts simply continues at the new position.
 *
 * The native `set-transport` maps to `SetTransportPlayback` followed by
 * `SeekFrames` (`commands/graph.rs`) — playback state, then the locate — and
 * the locate is what drops the automation writes the move made stale
 * (`TimelineGraph::seek`) and rolls the control-side ledger forward with it.
 * That is a real relocation of the live transport, which is why a full session
 * restart is the wrong instrument: it would re-send the whole topology and
 * re-install the maps to reach the same place, and it parks before it rolls, so
 * every seek would put a stop/start edge through a transport that never stopped.
 *
 * ── Only a rolling engine ─────────────────────────────────────────────────
 *
 * `playing: true` is an assertion, so this must never be sent to a transport
 * the session deliberately parked. `startNativeLiveGraphSession` parks exactly
 * that way when the transport maps decline — rolling then would run the take
 * under the previous take's tempo map and loop seam — and a parked transport
 * renders nothing at all, which is what makes that stale pair unreachable. A
 * locate that rolled it would make it reachable again. So a parked session
 * declines, and the next play is what relocates it, carrying the position and
 * a fresh attempt at the maps.
 */

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { currentStripTracks } from './currentStripTracks';
import { nativeLiveAutomationWriter } from './nativeLiveAutomationWriterState';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { rearmNativeLiveMidiWriterInPlace } from './rearmNativeLiveMidiWriterInPlace';
import { reportAttachedPlugins } from './reportAttachedPlugins';

export type RepositionNativeLiveGraphSessionInput = Readonly<{
    /** Where the playhead is being moved to, on the engine's clock. */
    positionSeconds: number;
}>;

export type RepositionNativeLiveGraphSessionResult =
    Readonly<{ outcome: 'repositioned' }> | Readonly<{ outcome: 'declined'; reason: string }>;

export function repositionNativeLiveGraphSession(
    input: RepositionNativeLiveGraphSessionInput
): Promise<RepositionNativeLiveGraphSessionResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<RepositionNativeLiveGraphSessionResult> => {
        const backend = nativeLiveGraphSession.backend;
        if (!backend) {
            return { outcome: 'declined', reason: 'no live native graph session' };
        }
        if (!nativeLiveGraphSession.rolling) {
            return { outcome: 'declined', reason: 'native transport is parked' };
        }
        const result = await backend.apply({
            schemaVersion: 1,
            commands: [{ kind: 'set-transport', playing: true, positionSeconds: input.positionSeconds }],
        });
        reportAttachedPlugins(result);
        if (result.application !== 'applied') {
            // The session and its topology stand: a refused locate means the
            // engine is still where it was, not that the graph went away.
            return { outcome: 'declined', reason: result.reason };
        }
        const pass = nativeLiveAutomationWriter.pass;
        if (pass) {
            // Only now. The locate is what drops the automation the move made
            // stale (`RampedParam::cancel_from`), so a pass re-armed ahead of
            // it would have its first writes cancelled by the very command
            // that made re-arming necessary.
            armNativeLiveAutomationWriter({
                // The chain as the store holds it now, not as the pass took it:
                // an arm claims to re-project the whole world, and a locate that
                // re-projected the arm-time objects would leave a plugin added
                // since then driven by neither engine.
                stripTracks: currentStripTracks(pass.stripTracks),
                sampleRate: pass.sampleRate,
                programmeEndSeconds: pass.programmeEndSeconds,
                positionSeconds: input.positionSeconds,
                // The locate's own fence. Until the engine has drained it, its
                // published position is still the one the musician left.
                provenAfterBatch: result.admittedBatch ?? null,
                seek: true,
            });
        }
        // The note pass is re-armed on its own terms, and unconditionally: a
        // locate moves the playhead out of the window this pass filled, and the
        // engine drops an entry the playhead has passed rather than delivering
        // it late. Only now, for the same reason as above — the locate releases
        // the sounding notes, so notes sent ahead of it would be cut off by the
        // very command that made re-arming necessary.
        await rearmNativeLiveMidiWriterInPlace({ positionSeconds: input.positionSeconds });
        return { outcome: 'repositioned' };
    });
}
