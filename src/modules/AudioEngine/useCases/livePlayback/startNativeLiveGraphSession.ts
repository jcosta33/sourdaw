/**
 * Start the native engine and give it the session's topology (#3066, D3.c.4a).
 *
 * The native engine has no start command: `apply_graph_commands` boots it on
 * the first batch (#1984), so *this* is the start. What the engine gains from
 * running is plugin hosting — `load_plugin` takes its engine-owned branch only
 * while an engine exists, and otherwise warns that the instance will not
 * process audio. What it does not gain is the mix: the batch carries no
 * `schedule-clip` (see `projectLiveGraphTopology`), so the engine renders
 * silence and Web Audio remains the live product path.
 *
 * ── Declining is an outcome, not a failure ────────────────────────────────
 *
 * A browser has no bridge, a desktop build whose addon cannot answer has no
 * engine, and a project the native registry refuses to hold has no topology it
 * can mirror. All three decline with the reason, and the caller carries on with
 * Web Audio exactly as before — which is why the caller can fire this without
 * waiting for it. Narrowing the refusals into gates the app checks up front is
 * the parity slice's work, not this one's: today a refusal costs one bridge
 * round trip and leaves the engine unstarted, which is the same place the app
 * was already in.
 */

import { logger } from '#/infra/logger/appLogger';
import {
    deriveEffectiveAudibility,
    deriveVcaMultiplier,
    getVcaGroupsState,
    shouldCreateLiveTrackStrip,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';
import { type EngineTransportMaps } from '../../models/EngineTransportPosition';
import { setEngineTransportMaps } from '../../repositories/engineTransport/setEngineTransportMaps';
import { createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';

import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { projectLiveGraphTopology } from './projectLiveGraphTopology';
import { startNativeEnginePlayheadFeed } from './startNativeEnginePlayheadFeed';

export type StartNativeLiveGraphSessionInput = Readonly<{
    /** Where playback begins, on the engine's clock. */
    positionSeconds: number;
    /**
     * The arrangement's tempo map, meter map and loop region, already projected
     * into engine coordinates.
     *
     * Passed in rather than read here because the arrangement owns them: this
     * module owns the shape the engine reads, not what the timeline says.
     */
    transportMaps: EngineTransportMaps;
}>;

export type NativeLiveGraphSessionResult =
    | Readonly<{ outcome: 'started'; runtimeRevision: number; reports: readonly AudioGraphStripReport[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * The strips the live engine builds, and the solo gate over them.
 *
 * Both read the Arrangement projections the live Web Audio path reads —
 * `shouldCreateLiveTrackStrip` for eligibility and `deriveEffectiveAudibility`
 * for the solo law — so the two engines cannot disagree about which strips a
 * session has or which of them solo is silencing.
 */
function readSessionTopology(): Readonly<{
    stripTracks: readonly Track[];
    soloGatedTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
}> {
    const projectTracks = trackStore.value?.tracks ?? [];
    const stripTracks = projectTracks.filter((track) => !track.disabled && shouldCreateLiveTrackStrip(track));
    // The live solo path's ambiguous-owner guard (#593): a track id appearing
    // more than once in the document has no unambiguous solo owner, so it can
    // neither engage nor answer solo.
    const stripTrackIds = new Set(
        stripTracks
            .filter((track) => projectTracks.filter((candidate) => candidate.id === track.id).length === 1)
            .map((track) => track.id)
    );
    const { soloGatedByTrackId } = deriveEffectiveAudibility({
        tracks: projectTracks,
        soloMode: workspaceStore.value?.soloMode ?? 'sip',
        stripTrackIds,
    });
    const vcaGroups = getVcaGroupsState();
    return {
        stripTracks,
        soloGatedTrackIds: new Set(
            stripTracks.filter((track) => soloGatedByTrackId.get(track.id) ?? false).map((track) => track.id)
        ),
        vcaMultiplierByTrackId: new Map(
            stripTracks.map((track): [string, number] => [
                track.id,
                deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
            ])
        ),
    };
}

/**
 * Set the engine rolling, once its maps and loop region are installed.
 *
 * Its own admission rather than part of the topology batch: that batch is an
 * all-or-nothing fence, so a roll folded into it would have to be applied
 * before the region it is bounded by.
 *
 * A refused roll leaves the session standing and the handle open — the topology
 * is mirrored and plugin hosting is live, which is what a session is for while
 * Web Audio remains the audible path. What the engine does not do is roll, so
 * the playhead feed reports a parked transport and the cursor keeps the
 * scheduler's own clock.
 */
async function rollNativeTransport(
    backend: ReturnType<typeof createNativeLiveGraphBackend>,
    positionSeconds: number
): Promise<void> {
    const rolling = await backend.apply({
        schemaVersion: 1,
        commands: [{ kind: 'set-transport', playing: true, positionSeconds }],
    });
    if (rolling.application !== 'applied') {
        logger.warn(`[AudioEngine] native transport did not start rolling: ${rolling.reason}`);
    }
}

export function startNativeLiveGraphSession(
    input: StartNativeLiveGraphSessionInput
): Promise<NativeLiveGraphSessionResult> {
    return queueOnNativeLiveGraphSession(async (): Promise<NativeLiveGraphSessionResult> => {
        const availability = await probeNativeGraphTransport();
        if (!availability.available) {
            return { outcome: 'declined', reason: availability.reason };
        }
        const topology = readSessionTopology();
        // Read after the probe, so the batch describes the project as it stands
        // when it is actually sent rather than when the gesture happened.
        //
        // Parked, not rolling. The loop region arrives with the maps, one
        // awaited bridge round trip after this batch lands, and an engine
        // already rolling renders that whole round trip: press play a beat
        // before the loop end and it crosses the boundary before it is told
        // where the boundary is. `frames_until_loop_end` then reads a playhead
        // already past the region and never wraps again for the rest of the
        // session. A parked transport advances no playhead at all
        // (`advance_playhead` returns on `!is_playing`), so nothing can be
        // rendered ahead of the region that governs it.
        const commands = projectLiveGraphTopology({
            ...topology,
            transport: { playing: false, positionSeconds: input.positionSeconds },
        });

        const backend = createNativeLiveGraphBackend({ transport: availability.transport });
        // Every play sends the session's whole topology, so every play replaces
        // the one before it. The native registry lives as long as the process
        // and has no remove-strip command, so an additive batch would collide
        // with its own strip ids the second time; replacing also means topology
        // the engineer changed between plays actually reaches the engine, rather
        // than only the transport doing so.
        const result = await backend.apply({ schemaVersion: 1, replaceTopology: true, commands });
        if (result.application !== 'applied') {
            backend.dispose();
            // Both non-applied outcomes carry a reason: a refusal names the
            // command it could not hold, a partial application names what it
            // could not finish. Neither leaves a session worth keeping.
            return { outcome: 'declined', reason: result.reason };
        }
        // The previous session's handle is closed only once its replacement is
        // applied: a decline must leave the engine reachable through the handle
        // that was already working.
        nativeLiveGraphSession.backend?.dispose();
        nativeLiveGraphSession.backend = backend;
        nativeLiveGraphSession.carriesAudio = commands.some((command) => command.kind === 'schedule-clip');

        // After the topology, never with it: the maps have their own owner and
        // their own command (the transport ownership law in `graph.rs`). Before
        // the roll, because the loop region travels with them and the engine
        // must not render a frame the region does not govern. Before the feed
        // too, because a position read against no maps reports the engine's
        // default tempo rather than the arrangement's.
        const maps = await setEngineTransportMaps(input.transportMaps);
        if (maps.outcome === 'declined') {
            // The engine keeps whatever pair the *previous* session installed:
            // nothing between sessions clears its maps or its loop region, and
            // the install that would have replaced them is the one that just
            // failed. Rolling now would run this take under the last take's
            // tempo map and wrap at a loop seam this arrangement no longer has,
            // while the Web Audio transport the musician hears plays straight
            // through it. So the engine stays parked, and a parked transport
            // renders no frame at all (`advance_playhead` returns on
            // `!is_playing`), which is what makes the stale pair unreachable
            // rather than merely unlikely.
            logger.warn(`[AudioEngine] native transport left parked: maps declined: ${maps.reason}`);
        } else {
            await rollNativeTransport(backend, input.positionSeconds);
        }
        startNativeEnginePlayheadFeed();
        return { outcome: 'started', runtimeRevision: result.runtimeRevision, reports: result.reports };
    });
}
