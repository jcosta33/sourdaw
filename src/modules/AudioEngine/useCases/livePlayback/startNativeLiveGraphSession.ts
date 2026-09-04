/**
 * Start the native engine and give it the session's topology (#3066, D3.c.4a).
 *
 * The native engine has no start command: `apply_graph_commands` boots it on
 * the first batch (#1984), so *this* is the start. What the engine gains from
 * running is plugin hosting — `load_plugin` takes its engine-owned branch only
 * while an engine exists, and otherwise warns that the instance will not
 * process audio. Since #3564 it also gains the mix, for the strips it can
 * actually host: a session starts audible, and every track the carrier law
 * (`stripCarriers.ts`) calls native is sounded here and gated shut at its Web
 * Audio exits. Every other track stays on Web Audio exactly as before, so the
 * two engines never sound the same track and never leave one silent.
 *
 * ── Naming the carried strips, and when ───────────────────────────────────
 *
 * The carried set is read back off the batch that was actually sent — the
 * `create-track-strip` commands carrying `contributesAudio: true` — so the flag
 * the engine acts on and the gates Web Audio closes have one source.
 *
 * It is stated *optimistically*, before the batch is applied, and that
 * direction is deliberate. Web Audio keeps rendering every strip whatever the
 * gates say, so a decline reopens them in place with no gap in its own stream;
 * waiting for the apply would instead leave the strips ungated across the whole
 * bridge round trip while the native engine was already sounding them, which is
 * a doubled mix a listener hears. Every path that ends without an audible
 * session therefore clears the set again, and the attach re-send restates it
 * because binding an instance can move a strip from web to native.
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
 * ── Why the topology can go out twice ─────────────────────────────────────
 *
 * `apply_graph_commands` captures the engine's plugin lookup before it maps the
 * batch and attaches dormant instances behind the fence, so the batch that
 * attaches an instance is mapped while the engine does not yet hold it and its
 * strip is built with no body for that device
 * (`a_plugin_attached_by_a_batch_binds_on_the_next_one`). One further batch is
 * what binds it. So when the topology reports attachments, this sends the
 * topology once more — rebuilt against the attach state those reports created,
 * with the same transport, monitor and programme — and the session is the
 * second batch's.
 *
 * Exactly one re-send, and only while parked. A `replaceTopology` batch tears
 * every strip down inside one fence (`GraphRegistry::take_topology_down`), so
 * it must never be sent to a rolling engine; both batches here go out with
 * `playing: false`, ahead of the maps and the roll, which is what makes the
 * teardown inaudible. Bounding it at one is not an optimisation either: a
 * second re-send would be a loop whose fixed point is whatever the engine
 * happens to attach next, and the batch that carries the rest is the roll,
 * which reports through `reportAttachedPlugins` like every other route. An
 * instance attached late therefore waits for the next play, and splicing or
 * releasing one mid-roll is #3575's work.
 *
 * A re-send the engine *refuses* costs the binding and nothing else. `map_batch`
 * builds its mapping on a clone of the registry and commits it only on success,
 * so a refused batch leaves the first one's topology installed — and a session
 * discarded over it would leave the engine parked with the whole project
 * mirrored while `hasLiveNativeGraphSession` says there is nothing to stop,
 * reposition or re-map. So a refusal is logged and the session stands on the
 * first batch. A *partially applied* re-send is the opposite case: the graph is
 * neither topology, and that one is discarded.
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
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import {
    type AudioGraphApplyResult,
    type AudioGraphCommand,
    type AudioGraphStripReport,
} from '../../models/AudioGraphBackend';
import { type EngineTransportMaps } from '../../models/EngineTransportPosition';
import { setEngineTransportMaps } from '../../repositories/engineTransport/setEngineTransportMaps';
import { createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { registerNativeTimelineSamples } from '../../repositories/nativeGraph/nativeTimelineSamplePool';
import { probeNativeGraphTransport } from '../../repositories/nativeGraph/probeNativeGraphTransport';
import { setNativeCarriedTracks } from '../trackAudioControls/setNativeCarriedTracks';

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { isHostedPluginDevice } from './isHostedPluginDevice';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import { projectLiveGraphTopology, type LiveGraphMonitorMode } from './projectLiveGraphTopology';
import { readAttachedExternalInstanceIds } from './readAttachedExternalInstanceIds';
import { readLiveGraphProgramme } from './readLiveGraphProgramme';
import { readLiveStripTracks } from './readLiveStripTracks';
import { reportAttachedPlugins } from './reportAttachedPlugins';
import { startNativeEnginePlayheadFeed } from './startNativeEnginePlayheadFeed';
import { projectStripCarriers, type StripCarrier } from './stripCarriers';

/**
 * What a session runs at unless a caller asks for the shadow.
 *
 * Audible is the product state: the native engine sounds every strip the
 * carrier law says it can host, and Web Audio's exits for those strips are
 * gated shut. The shadow stays reachable for callers that want a rendering
 * engine that reaches nobody — the sample prime, harnesses, and the specs that
 * observe a whole programme on the wire.
 */
const DEFAULT_MONITOR: LiveGraphMonitorMode = 'audible';

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
     * Absent means {@link DEFAULT_MONITOR}, which is `audible`: the transport
     * asks for nothing here. An explicit `shadowed` is for a caller that wants
     * the engine to hold this session's material without sounding any of it.
     */
    monitor?: LiveGraphMonitorMode;
}>;

export type NativeLiveGraphSessionResult =
    | Readonly<{ outcome: 'started'; runtimeRevision: number; reports: readonly AudioGraphStripReport[] }>
    | Readonly<{ outcome: 'declined'; reason: string }>;

/**
 * Whether a live input is reaching this track's Web Audio strip.
 *
 * The predicate the app itself applies: `setInputMonitoring` and
 * `toggleInputMonitoring` are the only callers of `startInputMonitoring`, and
 * both start the monitor on `'on'` alone — `'auto'` is documented there as
 * engine-driven by arm state rather than an always-on monitor, and the arm path
 * (`Arrangement/useCases/recording/armTrack.ts`) engages no monitor of its own
 * today. `'auto'` while armed is included anyway, because that is what `auto`
 * means and arming is what will engage it: the cost of naming a track monitored
 * that is not is one strip left on Web Audio, while the cost of the opposite is
 * gating a musician's own signal out of their headphones mid-take.
 */
function receivesLiveInput(track: Track): boolean {
    return track.inputMonitoring === 'on' || (track.inputMonitoring === 'auto' && track.armed);
}

/**
 * The strips the live engine builds, the solo gate over them, the plugin
 * instances the engine already owns, and the strips a live input is feeding.
 *
 * The first two read the Arrangement projections the live Web Audio path reads
 * — `shouldCreateLiveTrackStrip` for eligibility and `deriveEffectiveAudibility`
 * for the solo law — so the two engines cannot disagree about which strips a
 * session has or which of them solo is silencing.
 */
function readSessionTopology(): Readonly<{
    stripTracks: readonly Track[];
    soloGatedTrackIds: ReadonlySet<string>;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
    attachedInstanceIds: ReadonlySet<string>;
    inputMonitoredTrackIds: ReadonlySet<string>;
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
        attachedInstanceIds: readAttachedExternalInstanceIds(),
        inputMonitoredTrackIds: new Set(stripTracks.filter(receivesLiveInput).map((track) => track.id)),
    };
}

/**
 * The tracks this batch tells the engine to sound, read back off the batch
 * itself.
 *
 * One record of the split, rather than a second derivation beside the
 * producer's: whatever the engine was told to contribute is exactly what Web
 * Audio stops letting out.
 */
function carriedStripIds(commands: readonly AudioGraphCommand[]): ReadonlySet<string> {
    return new Set(
        commands.flatMap((command) =>
            command.kind === 'create-track-strip' && command.contributesAudio ? [command.trackId] : []
        )
    );
}

/**
 * Tell the musician the native engine did not start, once per distinct reason.
 *
 * Desktop only, and only past the availability probe: a browser build has no
 * native engine to miss, and saying so on every play would be noise about a
 * thing that is not wrong.
 */
function notifyNativeDecline(reason: string): void {
    const message =
        `Native audio engine did not start: ${reason}. ` +
        'Playing through Web Audio; external plugins are silent until it starts.';
    if (nativeLiveGraphSession.lastDeclineNotice === message) {
        return;
    }
    nativeLiveGraphSession.lastDeclineNotice = message;
    notifyUser(message, 'warning');
}

/**
 * Name every plugin this session will not be able to sound, and why.
 *
 * Only the native engine hosts an external plugin, so a plugin on a strip Web
 * Audio is carrying produces nothing at all — the Web Audio device in its place
 * is a pass-through. That is a silence with a cause, and a cause belongs in
 * front of the musician rather than in a console line nobody has open.
 */
function notifySilentHostedPlugins(input: {
    stripTracks: readonly Track[];
    carriers: ReadonlyMap<string, StripCarrier>;
}): void {
    const lines = input.stripTracks.flatMap((track) => {
        const carrier = input.carriers.get(track.id);
        if (carrier === undefined || carrier.carrier === 'native') {
            return [];
        }
        return track.devices
            .filter(isHostedPluginDevice)
            .map((device) => `"${device.name}" on "${track.name}": ${carrier.reason}`);
    });
    if (lines.length === 0) {
        return;
    }
    const message = ['Plugins silent until the native engine can host their tracks:', ...lines].join('\n');
    if (nativeLiveGraphSession.lastSilentPluginNotice === message) {
        return;
    }
    nativeLiveGraphSession.lastSilentPluginNotice = message;
    notifyUser(message, 'warning');
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
 * What one whole-topology batch left behind.
 *
 * Three outcomes rather than two, because a caller with a topology already
 * installed has to know whether this batch touched it. `refused` is a batch the
 * engine never began: `map_batch` builds the mapping on a clone of the registry
 * and commits it only on success, so a `rejected` result leaves whatever was
 * installed exactly as it was — and so does material registration that never
 * reached an apply at all. `unreconciled` is the half-applied case, where the
 * graph is neither the batch's nor the one before it.
 */
type TopologyBatchOutcome =
    | Readonly<{
          outcome: 'applied';
          result: Extract<AudioGraphApplyResult, { application: 'applied' }>;
          commands: readonly AudioGraphCommand[];
      }>
    | Readonly<{ outcome: 'refused'; reason: string }>
    | Readonly<{ outcome: 'unreconciled'; reason: string }>;

/**
 * Send one whole-topology batch: its material, then the batch that names it,
 * then whatever it says it attached.
 *
 * Every topology a session sends goes through here, so the ordering contract
 * holds for a re-send exactly as it does for the first batch, and no route
 * drops an attach report. The registration is a memo lookup once the prime has
 * run (`primeNativeTimelineSamples`), which is what makes asking a second time
 * cost nothing.
 *
 * It replaces rather than adds. The native registry lives as long as the
 * process and has no remove-strip command, so an additive batch would collide
 * with its own strip ids the second time; replacing also means topology the
 * engineer changed between plays actually reaches the engine, rather than only
 * the transport doing so.
 */
async function applyTopologyBatch(input: {
    transport: NativeGraphTransport;
    backend: ReturnType<typeof createNativeLiveGraphBackend>;
    commands: readonly AudioGraphCommand[];
}): Promise<TopologyBatchOutcome> {
    const { transport, backend, commands } = input;
    const material = await registerNativeTimelineSamples({ transport, commands });
    if (material.outcome === 'declined') {
        // No batch was sent, so nothing in the graph moved.
        return { outcome: 'refused', reason: material.reason };
    }
    const result = await backend.apply({ schemaVersion: 1, replaceTopology: true, commands });
    if (result.acceptance === 'rejected') {
        return { outcome: 'refused', reason: result.reason };
    }
    if (result.application !== 'applied') {
        return { outcome: 'unreconciled', reason: result.reason };
    }
    // A batch that starts the engine takes over the plugin instances loaded
    // before there was one — reported to their devices as loaded but processing
    // no audio, and corrected nowhere else. Reported before the session
    // bookkeeping, because a device told late has already been read as degraded.
    reportAttachedPlugins(result);
    return { outcome: 'applied', result, commands };
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

/**
 * Say out loud what the programme could not carry.
 *
 * The producer drops such material so that one clip cannot refuse the whole
 * batch, but a drop nobody states is a track that plays a bar short with no
 * account of why.
 */
function logProgrammeExclusions(programme: LiveGraphProgramme): void {
    for (const exclusion of programme.exclusions) {
        logger.warn(
            `[AudioEngine] live programme excluded ${exclusion.subjectId} on strip ` +
                `${exclusion.stripId}: ${exclusion.reason}`
        );
    }
}

async function rollNativeTransport(
    backend: ReturnType<typeof createNativeLiveGraphBackend>,
    positionSeconds: number
): Promise<RolledNativeTransport> {
    const rolling = await backend.apply({
        schemaVersion: 1,
        commands: [{ kind: 'set-transport', playing: true, positionSeconds, locate: false }],
    });
    reportAttachedPlugins(rolling);
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
        // Here, because this is where the programme is applied.
        logProgrammeExclusions(programme);
        // Material before the batch that names it, always: the native side
        // refuses a `schedule-clip` whose sample the pool does not hold, and it
        // refuses the whole batch with it. That ordering lives in
        // `applyTopologyBatch`, so both of this session's topology batches keep
        // it.
        const parked = { playing: false, positionSeconds: input.positionSeconds } as const;
        const audible = monitor === 'audible';
        const projectTopology = (attachedInstanceIds: ReadonlySet<string>): readonly AudioGraphCommand[] =>
            projectLiveGraphTopology({ ...topology, attachedInstanceIds, transport: parked, monitor, programme });
        // Reopening the gates, and the only route that does: every decline past
        // the optimistic claim below runs through it, so no path can leave Web
        // Audio silenced for an engine that never sounded anything.
        const releaseCarriedStrips = (): void => setNativeCarriedTracks(new Set());

        const backend = createNativeLiveGraphBackend({ transport: availability.transport });
        const firstCommands = projectTopology(topology.attachedInstanceIds);
        // Before the first await, and only for an audible session — see the
        // header for why the claim is made ahead of the answer rather than after
        // it. A shadowed session sounds nothing, so it releases instead.
        setNativeCarriedTracks(audible ? carriedStripIds(firstCommands) : new Set());
        const started = await applyTopologyBatch({
            transport: availability.transport,
            backend,
            commands: firstCommands,
        });
        if (started.outcome !== 'applied') {
            releaseCarriedStrips();
            backend.dispose();
            notifyNativeDecline(started.reason);
            return { outcome: 'declined', reason: started.reason };
        }
        // The batch that attached those instances was mapped before the engine
        // held them, so their strips went out with no body for the plugin. One
        // more parked batch, built against the attach state the reports above
        // have just written, is what binds them — see the header for why there
        // is never a third.
        const boundInstanceIds =
            (started.result.attachedPlugins ?? []).length > 0 ? readAttachedExternalInstanceIds() : null;
        const resent = boundInstanceIds
            ? await applyTopologyBatch({
                  transport: availability.transport,
                  backend,
                  commands: projectTopology(boundInstanceIds),
              })
            : started;
        if (resent.outcome === 'unreconciled') {
            // Half of a topology replacement is neither this batch's graph nor
            // the one the first batch installed, so there is nothing left to
            // keep.
            releaseCarriedStrips();
            backend.dispose();
            notifyNativeDecline(resent.reason);
            return { outcome: 'declined', reason: resent.reason };
        }
        if (resent.outcome === 'refused') {
            // Nothing moved: the first batch's topology is still installed and
            // still a session. Discarding it here would leave the engine parked
            // with the whole project mirrored while every caller was told there
            // is no live session to stop, reposition or re-map. What is lost is
            // the binding, which the next play sends again.
            logger.warn(`[AudioEngine] native engine refused the plugin-attach re-send: ${resent.reason}`);
        }
        const rebound = resent.outcome === 'applied' ? resent : started;
        const reboundInstanceIds =
            resent.outcome === 'applied' && boundInstanceIds ? boundInstanceIds : topology.attachedInstanceIds;
        // Restated against the batch that actually stands: binding an instance
        // can move a strip from web to native, and the optimistic claim above
        // was made before the engine held it.
        if (audible) {
            setNativeCarriedTracks(carriedStripIds(rebound.commands));
            notifySilentHostedPlugins({
                stripTracks: topology.stripTracks,
                carriers: projectStripCarriers({
                    stripTracks: topology.stripTracks,
                    attachedInstanceIds: reboundInstanceIds,
                    programme,
                    inputMonitoredTrackIds: topology.inputMonitoredTrackIds,
                }),
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
        const schedulesClips = rebound.commands.some((command) => command.kind === 'schedule-clip');
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
        // The last topology batch the engine *applied*: a re-send that landed
        // replaced every strip the first one built, so its reports are the only
        // ones describing the graph now held — and a re-send the engine refused
        // built no strips at all, which is why that case reports the first
        // batch's.
        return { outcome: 'started', runtimeRevision: rebound.result.runtimeRevision, reports: rebound.result.reports };
    });
}
