/**
 * Start the native engine and give it the session's topology (#3066, D3.c.4a).
 *
 * The native engine has no start command: `apply_graph_commands` boots it on
 * the first batch (#1984), so *this* is the start. What the engine gains from
 * running is plugin hosting — `load_plugin` takes its engine-owned branch only
 * while an engine exists, and otherwise warns that the instance will not
 * process audio. What it does not gain is the mix: a session starts with its
 * monitor shadowed, so whatever the batch schedules the engine contributes
 * true zeros at the device and Web Audio remains the live product path. The
 * batch now carries the arrangement's whole programme (#3068), and the shadow
 * is exactly what makes that safe to send.
 *
 * ── Material before the batch that names it ───────────────────────────────
 *
 * A `schedule-clip` carries a sample identity, not PCM, and the native side
 * refuses one whose sample the pool does not hold — whole-batch, so a single
 * unregistered buffer costs the session every strip. Registration therefore
 * happens here, between the projection and the apply. It is normally free:
 * `primeNativeTimelineSamples` has already put the project's material in the
 * pool while the arrangement was being edited, and the memo turns this into a
 * lookup rather than a transfer. The prime is the optimisation; this call is
 * the contract.
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
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { markExternalPluginEngineAttached } from '#/modules/PluginHost/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type AudioGraphStripReport } from '../../models/AudioGraphBackend';
import { type EngineTransportMaps } from '../../models/EngineTransportPosition';
import { setEngineTransportMaps } from '../../repositories/engineTransport/setEngineTransportMaps';
import { createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { registerNativeTimelineSamples } from '../../repositories/nativeGraph/nativeTimelineSamplePool';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import { projectLiveGraphTopology, type LiveGraphMonitorMode } from './projectLiveGraphTopology';
import { readLiveGraphProgramme } from './readLiveGraphProgramme';
import { readLiveStripTracks } from './readLiveStripTracks';
import { startNativeEnginePlayheadFeed } from './startNativeEnginePlayheadFeed';

/**
 * What a session runs at unless a caller asks for the cutover.
 *
 * Shadowed is the safe state and the one this slice exists to make available:
 * the engine renders whatever it is given, block-accurately, and none of it
 * reaches the speakers, so a real programme can be scheduled onto it while Web
 * Audio remains the path a musician hears. Nothing in the app asks for
 * `audible` yet — that request *is* the cutover, and it belongs to the slice
 * that makes it.
 */
const DEFAULT_MONITOR: LiveGraphMonitorMode = 'shadowed';

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
    /**
     * The frame grid this session's programme is placed on.
     *
     * Passed in for the same reason `transportMaps` is: the clock belongs to
     * whoever owns the transport, and every beat in the batch is rounded onto
     * this grid (`projectPpqEndpoints`). A session projected on one rate and an
     * export bounced on another place the same clip on the same sample only
     * when both are told which grid to use.
     */
    sampleRate: number;
    /**
     * Whether this session's engine may reach the speakers.
     *
     * Absent means {@link DEFAULT_MONITOR}. An explicit `audible` is the
     * cutover, and it is the only thing that lets this engine become the
     * audible one.
     */
    monitor?: LiveGraphMonitorMode;
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
    const stripTracks = readLiveStripTracks();
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
 * Where this session's programme ends, on the engine clock.
 *
 * The bound a non-looping automation pass is written into. The session is the
 * only thing that knows it: automation past the last thing this engine plays
 * reaches nobody, and the programme is the record of what that is.
 */
function programmeEndSeconds(programme: LiveGraphProgramme): number {
    let end = 0;
    for (const playbacks of programme.playbacksByStripId.values()) {
        for (const playback of playbacks) {
            end = Math.max(end, playback.startTime + playback.durationSeconds);
        }
    }
    return end;
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
 *
 * ── It starts playback; it must not locate ────────────────────────────────
 *
 * The topology batch already parked the engine at this very position, so the
 * playhead is where this roll wants it and a second locate would move nothing.
 * What it would do is destroy the mix: a locate seeks, a seek cancels every
 * queued mixer write stamped at or past its frame, and every strip in the batch
 * this roll follows stated its fader, pan and send levels as writes at frame 0.
 * The three batches — topology, maps, roll — normally drain into one
 * `update_graph` before the first block is rendered, so those writes are still
 * pending when the roll's seek would land on them, and pressing play from the
 * session head is exactly the case where the frames coincide. `locate: false`
 * is what keeps a roll a roll ({@link AudioGraphSetTransportCommand}).
 */
/**
 * Whether the engine is rolling, and the fence number of the roll that started
 * it — what a transport reading has to have reached before it describes this
 * session rather than the one it replaced.
 */
type RolledNativeTransport = Readonly<{ rolling: boolean; provenAfterBatch: number | null }>;

async function rollNativeTransport(
    backend: ReturnType<typeof createNativeLiveGraphBackend>,
    positionSeconds: number
): Promise<RolledNativeTransport> {
    const rolling = await backend.apply({
        schemaVersion: 1,
        commands: [{ kind: 'set-transport', playing: true, positionSeconds, locate: false }],
    });
    if (rolling.application !== 'applied') {
        logger.warn(`[AudioEngine] native transport did not start rolling: ${rolling.reason}`);
        return { rolling: false, provenAfterBatch: null };
    }
    return { rolling: true, provenAfterBatch: rolling.admittedBatch ?? null };
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
        const monitor = input.monitor ?? DEFAULT_MONITOR;
        const programme = readLiveGraphProgramme({ stripTracks: topology.stripTracks, sampleRate: input.sampleRate });
        // The producer drops what it cannot carry so one clip cannot refuse the
        // whole batch, but a drop nobody says out loud is a track that plays a
        // bar short with no account of why. This is where the programme is
        // applied, so this is where its cost is stated.
        for (const exclusion of programme.exclusions) {
            logger.warn(
                `[AudioEngine] live programme excluded ${exclusion.subjectId} on strip ` +
                    `${exclusion.stripId}: ${exclusion.reason}`
            );
        }
        const commands = projectLiveGraphTopology({
            ...topology,
            transport: { playing: false, positionSeconds: input.positionSeconds },
            monitor,
            programme,
        });

        // Material before the batch that names it, always: the native side
        // refuses a `schedule-clip` whose sample the pool does not hold, and it
        // refuses the whole batch with it. The prime pass has normally left
        // nothing to send (`primeNativeTimelineSamples`), so this is a memo
        // lookup at the gesture rather than a transfer — but the guarantee is
        // this call's, not the prime's, because a prime is an optimisation and
        // an ordering is a contract.
        const material = await registerNativeTimelineSamples({ transport: availability.transport, commands });
        if (material.outcome === 'declined') {
            return { outcome: 'declined', reason: material.reason };
        }

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
        // This batch is what starts the native engine, so it is also what takes
        // over every plugin instance loaded before there was one — those
        // instances were reported to their devices as loaded but processing no
        // audio, and this result is the only correction that report ever gets.
        // Before the session bookkeeping below, because a device that is told
        // late has already been read as degraded.
        for (const attached of result.attachedPlugins ?? []) {
            markExternalPluginEngineAttached({
                instanceId: attached.instanceId,
                bridgeRoundTripFrames: attached.bridgeRoundTripFrames,
            });
        }
        // The previous session's handle is closed only once its replacement is
        // applied: a decline must leave the engine reachable through the handle
        // that was already working.
        nativeLiveGraphSession.backend?.dispose();
        nativeLiveGraphSession.backend = backend;
        // Both halves, and both are needed. What was scheduled is read off the
        // batch actually sent, so the day the producer emits clips nothing has
        // to be remembered here; whether any of it can be heard is the monitor
        // mode, and a shadowed engine writes true zeros at the device however
        // full its timeline is.
        const shadowed = monitor === 'shadowed';
        const schedulesClips = commands.some((command) => command.kind === 'schedule-clip');
        nativeLiveGraphSession.monitorShadowed = shadowed;
        nativeLiveGraphSession.audibleCarrier = schedulesClips && !shadowed;
        // The topology went out parked (see the batch above), so this session
        // has not rolled yet whatever the one it replaced was doing.
        nativeLiveGraphSession.rolling = false;
        // Whatever the previous session left armed addresses a topology this
        // batch has just replaced, and a region this session may not share.
        disarmNativeLiveAutomationWriter();

        // After the topology, never with it: the maps have their own owner and
        // their own command (the transport ownership law in `graph.rs`). Before
        // the roll, because the loop region travels with them and the engine
        // must not render a frame the region does not govern. Before the feed
        // too, because a position read against no maps reports the engine's
        // default tempo rather than the arrangement's.
        let rolled: RolledNativeTransport = { rolling: false, provenAfterBatch: null };
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
            nativeLiveGraphSession.loopRegion = null;
            nativeLiveGraphSession.loopEnabled = false;
        } else {
            // The requested region beside the engine's own answer about it: a
            // region too short for the engine's floor is held and not wrapped,
            // and only the engine can say which this one is.
            nativeLiveGraphSession.loopRegion = input.transportMaps.loopRegion;
            nativeLiveGraphSession.loopEnabled = maps.applied.loopEnabled;
            rolled = await rollNativeTransport(backend, input.positionSeconds);
            nativeLiveGraphSession.rolling = rolled.rolling;
        }
        if (nativeLiveGraphSession.rolling) {
            // After the roll, never before it: the region the pass is written
            // into is the one the engine just confirmed it will wrap, and a
            // parked engine plays no automation because it plays nothing.
            armNativeLiveAutomationWriter({
                stripTracks: topology.stripTracks,
                sampleRate: input.sampleRate,
                programmeEndSeconds: programmeEndSeconds(programme),
                positionSeconds: input.positionSeconds,
                provenAfterBatch: rolled.provenAfterBatch,
            });
        }
        startNativeEnginePlayheadFeed();
        return { outcome: 'started', runtimeRevision: result.runtimeRevision, reports: result.reports };
    });
}
