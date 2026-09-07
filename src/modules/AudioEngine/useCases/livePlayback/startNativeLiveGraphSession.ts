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
import { masterGainState } from '../engineAccess/masterGainState';

import { armNativeLiveAutomationWriter } from './armNativeLiveAutomationWriter';
import { armNativeLiveMidiWriter } from './armNativeLiveMidiWriter';
import { claimCarriedStrips } from './claimCarriedStrips';
import { clearNativeChains } from './clearNativeChains';
import { disarmNativeLiveAutomationWriter } from './disarmNativeLiveAutomationWriter';
import { disarmNativeLiveMidiWriter } from './disarmNativeLiveMidiWriter';
import { isHostedPluginDevice } from './isHostedPluginDevice';
import { nativeLiveGraphSession, queueOnNativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import {
    projectLiveGraphTopology,
    type LiveGraphMonitorMode,
    type LiveGraphTopologyInput,
} from './projectLiveGraphTopology';
import { readAttachedExternalInstanceIds } from './readAttachedExternalInstanceIds';
import { readLiveGraphProgramme } from './readLiveGraphProgramme';
import { readLiveStripTracks } from './readLiveStripTracks';
import { replaceNativeChains } from './replaceNativeChains';
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
 * What this session plays, read against the topology it is building.
 *
 * The attach state travels with it because the programme cannot be projected
 * without it: whether a MIDI strip stays Web Audio's turns on whether the
 * engine already holds the instrument its notes address. Taken as an argument
 * rather than off the topology, because a session states its programme more
 * than once — again when the first batch reports newly attached plugins — and
 * a programme projected against the earlier set would leave an instrument the
 * engine has just taken web-voiced in a batch that gates Web Audio out of it.
 */
function sessionProgramme(input: {
    topology: ReturnType<typeof readSessionTopology>;
    attachedInstanceIds: ReadonlySet<string>;
    sampleRate: number;
}): LiveGraphProgramme {
    return readLiveGraphProgramme({
        stripTracks: input.topology.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        sampleRate: input.sampleRate,
    });
}

/**
 * Record which strips this batch carries, and say which plugins that silences.
 *
 * The two travel together because they are one reading of the carrier law: the
 * claim is what gates a carried strip's Web Audio twin out of the mix, and the
 * notice is what tells a musician why the plugin on a strip that stayed behind
 * produces nothing.
 */
function claimCarriersOf(input: {
    commands: readonly AudioGraphCommand[];
    stripTracks: readonly Track[];
    attachedInstanceIds: ReadonlySet<string>;
    programme: LiveGraphProgramme;
    inputMonitoredTrackIds: ReadonlySet<string>;
}): void {
    claimCarriedStrips(carriedStripIds(input.commands));
    notifySilentHostedPlugins({
        stripTracks: input.stripTracks,
        carriers: projectStripCarriers({
            stripTracks: input.stripTracks,
            attachedInstanceIds: input.attachedInstanceIds,
            programme: input.programme,
            inputMonitoredTrackIds: input.inputMonitoredTrackIds,
        }),
    });
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
    // Replaced rather than merged: this batch tore every strip down inside its
    // own fence, so a strip missing from these reports is a strip the engine no
    // longer has, and a mirror addressing one must find nothing.
    replaceNativeChains(result.reports);
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
 * is mirrored and plugin hosting is live, so stop, reposition and re-map all
 * keep working. What it does not leave standing is the carrier claim: a parked
 * engine renders no frame at all, so the strips it was handed have to go back
 * to Web Audio and the musician has to be told, or the take is silent on every
 * one of them. The caller does that (see {@link startNativeLiveGraphSession});
 * this function's part is to report the reason it did not roll. The playhead
 * feed meanwhile reports a parked transport and the cursor keeps the
 * scheduler's own clock.
 *
 * ── An unreadable answer is not a failed roll ─────────────────────────────
 *
 * `apply` reports a transport failure as `rejected` and throws only on an
 * answer it cannot read, which it decides *after* the command has crossed the
 * bridge. So a throw here says the roll may have taken effect, and the one
 * thing that must not happen is unwinding out of the session start: the caller
 * would reopen the Web Audio gates on strips a rolling engine is sounding, and
 * every one of them would be heard twice for the length of the take. The roll
 * is therefore undone here, and reported as a reason like any other parked
 * engine — the state is known again, and the caller's existing parked exit is
 * the correct handling of it.
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
type RolledNativeTransport = Readonly<{
    rolling: boolean;
    provenAfterBatch: number | null;
    /** Why the engine did not roll, or `null` when it did. */
    reason: string | null;
}>;

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

function reasonOf(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Undo an optimistic carrier claim whose session start then threw.
 *
 * Everything that can still throw past the claim left the engine parked by
 * construction — the topology batches go out with `playing: false`, and an
 * unreadable roll answer is undone where it happens rather than unwound — so
 * reopening the gates here cannot double a mix the engine is already sounding.
 */
function abandonSessionStart(backend: ReturnType<typeof createNativeLiveGraphBackend>): void {
    claimCarriedStrips(new Set());
    nativeLiveGraphSession.audibleCarrier = false;
    // A topology batch may already have written its chains before the throw,
    // and they describe a graph this start is walking away from.
    clearNativeChains();
    if (nativeLiveGraphSession.backend !== backend) {
        // Thrown before this handle was adopted, so nothing else will ever
        // close it.
        backend.dispose();
    }
}

/**
 * Put the engine back where the roll found it, after an answer nobody could
 * read.
 *
 * Sent through the same `apply` on purpose: a transport failure comes back as
 * `rejected` there rather than throwing, so the only thing left to catch is a
 * second malformed answer — and a park that cannot be confirmed is still worth
 * attempting, because the alternative is leaving an engine rolling that every
 * caller believes is parked.
 */
async function parkUnreadableRoll(
    backend: ReturnType<typeof createNativeLiveGraphBackend>,
    positionSeconds: number
): Promise<void> {
    try {
        const parked = await backend.apply({
            schemaVersion: 1,
            commands: [{ kind: 'set-transport', playing: false, positionSeconds, locate: false }],
        });
        if (parked.application !== 'applied') {
            logger.warn(`[AudioEngine] native transport refused the park after an unreadable roll: ${parked.reason}`);
        }
    } catch (error) {
        logger.warn(`[AudioEngine] native transport answered the park unreadably too: ${reasonOf(error)}`);
    }
}

async function rollNativeTransport(
    backend: ReturnType<typeof createNativeLiveGraphBackend>,
    positionSeconds: number
): Promise<RolledNativeTransport> {
    let rolling: AudioGraphApplyResult;
    try {
        rolling = await backend.apply({
            schemaVersion: 1,
            commands: [{ kind: 'set-transport', playing: true, positionSeconds, locate: false }],
        });
        reportAttachedPlugins(rolling);
    } catch (error) {
        // The command is already out. `apply` turns a transport failure into
        // `rejected`, so reaching here means the engine answered — unreadably —
        // and it may well be rolling and sounding every carried strip. Letting
        // this out would unwind past the caller's release into a graph that is
        // audible on both carriers at once, so the roll is undone instead and
        // reported as the parked engine it now is.
        const reason = reasonOf(error);
        logger.warn(`[AudioEngine] native transport answered the roll unreadably: ${reason}`);
        await parkUnreadableRoll(backend, positionSeconds);
        return { rolling: false, provenAfterBatch: null, reason };
    }
    if (rolling.application !== 'applied') {
        logger.warn(`[AudioEngine] native transport did not start rolling: ${rolling.reason}`);
        return { rolling: false, provenAfterBatch: null, reason: rolling.reason };
    }
    return { rolling: true, provenAfterBatch: rolling.admittedBatch ?? null, reason: null };
}

/**
 * Install this session's maps and loop region, then set the engine rolling.
 *
 * Answers with the reason the engine ended up parked, or `null` when it is
 * rolling. A reason rather than a boolean, because a parked engine has to hand
 * its carried strips back and the musician has to be told which of the two
 * steps is the one that failed.
 */
async function rollSessionTransport(input: {
    backend: ReturnType<typeof createNativeLiveGraphBackend>;
    stripTracks: readonly Track[];
    /** The attach state the topology this session installed was built from. */
    attachedInstanceIds: ReadonlySet<string>;
    /** The strips the batch that installed this topology built contributing. */
    carriedStripIds: ReadonlySet<string>;
    transportMaps: EngineTransportMaps;
    positionSeconds: number;
    sampleRate: number;
    programmeEndSeconds: number;
}): Promise<string | null> {
    // After the topology, never with it: the maps have their own owner and
    // their own command (the transport ownership law in `graph.rs`). Before
    // the roll, because the loop region travels with them and the engine
    // must not render a frame the region does not govern. Before the feed
    // too, because a position read against no maps reports the engine's
    // default tempo rather than the arrangement's.
    const maps = await setEngineTransportMaps(input.transportMaps);
    if (maps.outcome === 'declined') {
        // The engine keeps whatever pair the *previous* session installed:
        // nothing between sessions clears its maps or its loop region, and the
        // install that would have replaced them is the one that just failed.
        // Rolling now would run this take under the last take's tempo map and
        // wrap at a loop seam this arrangement no longer has. So the engine
        // stays parked, and a parked transport renders no frame at all
        // (`advance_playhead` returns on `!is_playing`), which is what makes
        // the stale pair unreachable rather than merely unlikely.
        logger.warn(`[AudioEngine] native transport left parked: maps declined: ${maps.reason}`);
        nativeLiveGraphSession.loopRegion = null;
        nativeLiveGraphSession.loopEnabled = false;
        return maps.reason;
    }
    // The requested region beside the engine's own answer about it: a region
    // too short for the engine's floor is held and not wrapped, and only the
    // engine can say which this one is.
    nativeLiveGraphSession.loopRegion = input.transportMaps.loopRegion;
    nativeLiveGraphSession.loopEnabled = maps.applied.loopEnabled;
    // Before the roll, and awaited — the opposite order to the automation
    // writer's, for a reason that belongs to the note store rather than to
    // preference. `apply_due_midi_notes` delivers nothing while the transport
    // is stopped, and an entry whose frame the playhead has already passed is
    // counted late and never delivered: notes that arrive after the engine
    // starts advancing are simply lost from the head of the take. The region
    // this pass is written into is known here all the same, because the maps
    // above already installed it and the engine has already answered whether it
    // will wrap.
    await armNativeLiveMidiWriter({
        stripTracks: input.stripTracks,
        // The set the standing topology was built from, never a fresh read:
        // an instrument this session left web-voiced must not also be sent
        // notes, and one it gated Web Audio out of must be.
        attachedInstanceIds: input.attachedInstanceIds,
        // Same reasoning, same batch: the strips this topology actually built
        // contributing, not the session's own claimed set.
        carriedStripIds: input.carriedStripIds,
        sampleRate: input.sampleRate,
        positionSeconds: input.positionSeconds,
    });
    const rolled = await rollNativeTransport(input.backend, input.positionSeconds);
    nativeLiveGraphSession.rolling = rolled.rolling;
    if (!rolled.rolling) {
        // The notes went out ahead of a roll that never happened. A parked
        // engine delivers none of them, and the next play arms afresh; leaving
        // the pass standing would let the playhead feed pump a window for a
        // transport that is not moving.
        disarmNativeLiveMidiWriter();
        return rolled.reason;
    }
    // After the roll, never before it: the region the pass is written into is
    // the one the engine just confirmed it will wrap, and a parked engine plays
    // no automation because it plays nothing.
    armNativeLiveAutomationWriter({
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        programmeEndSeconds: input.programmeEndSeconds,
        positionSeconds: input.positionSeconds,
        provenAfterBatch: rolled.provenAfterBatch,
    });
    return null;
}

/**
 * The session's topology batch, at the level the master fader is standing at.
 *
 * The level is read here rather than taken as an argument because a session
 * states its topology more than once — again when the first batch reports newly
 * attached plugins — and the fader may have moved between the two. Reading it
 * per projection is what keeps the second batch from restoring the first one's
 * level.
 */
function projectSessionTopology(input: Omit<LiveGraphTopologyInput, 'masterGain'>): readonly AudioGraphCommand[] {
    return projectLiveGraphTopology({ ...input, masterGain: masterGainState.gain });
}

/**
 * Reopening the gates, and the only route that does: every decline past the
 * optimistic claim runs through it, so no path can leave Web Audio silenced for
 * an engine that never sounded anything.
 */
function releaseCarriedStrips(): void {
    claimCarriedStrips(new Set());
}

/**
 * The attach state the topology the engine actually holds was built from, and
 * the programme read against that same set.
 *
 * One pair, always read together: whether a strip is web-voiced and whether its
 * instrument has a native body are the same question asked twice, and a caller
 * answering them from different sets gates Web Audio out of a strip the engine
 * has no body for.
 */
type InstalledProjection = Readonly<{
    attachedInstanceIds: ReadonlySet<string>;
    programme: LiveGraphProgramme;
}>;

/**
 * Send the topology once more, bound to the instances the first batch attached.
 *
 * The batch that attached them was mapped before the engine held them, so their
 * strips went out with no body for the plugin; one more parked batch, built
 * against the attach state those reports have just written, is what binds them
 * — see the header for why there is never a third. Nothing is re-sent when the
 * first batch attached nothing, because there is nothing new to bind.
 *
 * The re-send answers with what now stands rather than only what was applied: a
 * refused re-send leaves the *first* batch's graph installed, and that graph is
 * the one every carrier decision past here has to be read against.
 */
async function bindAttachedPlugins(input: {
    transport: NativeGraphTransport;
    backend: ReturnType<typeof createNativeLiveGraphBackend>;
    topology: ReturnType<typeof readSessionTopology>;
    sampleRate: number;
    started: Extract<TopologyBatchOutcome, { outcome: 'applied' }>;
    programme: LiveGraphProgramme;
    projectTopology: (
        attachedInstanceIds: ReadonlySet<string>,
        against: LiveGraphProgramme
    ) => readonly AudioGraphCommand[];
}): Promise<Readonly<{ resent: TopologyBatchOutcome; installed: InstalledProjection }>> {
    const { transport, backend, topology, started, programme, projectTopology } = input;
    const first: InstalledProjection = { attachedInstanceIds: topology.attachedInstanceIds, programme };
    if ((started.result.attachedPlugins ?? []).length === 0) {
        return { resent: started, installed: first };
    }
    const attachedInstanceIds = readAttachedExternalInstanceIds();
    // Re-projected, not reused: binding an instrument moves a MIDI strip out of
    // `webVoicedStripIds`, and the first programme was read before the engine
    // held that instrument.
    const bound: InstalledProjection = {
        attachedInstanceIds,
        programme: sessionProgramme({ topology, attachedInstanceIds, sampleRate: input.sampleRate }),
    };
    const resent = await applyTopologyBatch({
        transport,
        backend,
        commands: projectTopology(bound.attachedInstanceIds, bound.programme),
    });
    return { resent, installed: resent.outcome === 'applied' ? bound : first };
}

/**
 * Hand the applied topology to the session and start it moving.
 *
 * The previous session's handle is closed only once its replacement is applied:
 * a decline must leave the engine reachable through the handle that was already
 * working. A new session is new news too, so whatever the previous one deferred
 * — about a topology this batch has just replaced — goes with it.
 *
 * Whether this engine sounds anything is read off the batch actually sent, as
 * the strips it was told to contribute: a contributing strip is one Web Audio
 * has been gated out of, so the engine is the only carrier left for it whether a
 * clip plays on it or a hosted plugin generates into it. Whether any of that can
 * be heard is the monitor mode, and a shadowed engine writes true zeros at the
 * device however full its timeline is.
 *
 * The topology went out parked, so this session has not rolled yet whatever the
 * one it replaced was doing — and whatever that one left armed addresses a
 * topology this batch has just replaced, over a region this session may not
 * share.
 */
async function installRolledSession(input: {
    session: StartNativeLiveGraphSessionInput;
    backend: ReturnType<typeof createNativeLiveGraphBackend>;
    topology: ReturnType<typeof readSessionTopology>;
    installed: InstalledProjection;
    rebound: Extract<TopologyBatchOutcome, { outcome: 'applied' }>;
    monitor: LiveGraphMonitorMode;
}): Promise<void> {
    const { session, backend, topology, installed, rebound, monitor } = input;
    nativeLiveGraphSession.backend?.dispose();
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.lastDeferredChainNotice = null;
    const shadowed = monitor === 'shadowed';
    nativeLiveGraphSession.monitorShadowed = shadowed;
    // The batch the engine actually holds, not the session's own claimed set:
    // a shadowed monitor claims nothing while the engine still builds every
    // contributing strip, and the note writer has to agree with the engine
    // rather than with what Web Audio was told to give up.
    const reboundStripIds = carriedStripIds(rebound.commands);
    nativeLiveGraphSession.audibleCarrier = reboundStripIds.size > 0 && !shadowed;
    nativeLiveGraphSession.rolling = false;
    disarmNativeLiveAutomationWriter();
    disarmNativeLiveMidiWriter();
    const parkedReason = await rollSessionTransport({
        backend,
        stripTracks: topology.stripTracks,
        attachedInstanceIds: installed.attachedInstanceIds,
        carriedStripIds: reboundStripIds,
        transportMaps: session.transportMaps,
        positionSeconds: session.positionSeconds,
        sampleRate: session.sampleRate,
        programmeEndSeconds: programmeEndSeconds(installed.programme),
    });
    if (monitor === 'audible' && parkedReason !== null) {
        // A parked engine renders no frame at all, so a strip gated out of Web
        // Audio for it is a strip on no carrier whatsoever — silent for the
        // whole take. The session itself stands: its handle, its topology and
        // its plugin hosting are what stop, reposition and re-map still need.
        // Only the audio goes back.
        releaseCarriedStrips();
        nativeLiveGraphSession.audibleCarrier = false;
        notifyNativeDecline(parkedReason);
    }
    startNativeEnginePlayheadFeed();
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
        const programme = sessionProgramme({
            topology,
            attachedInstanceIds: topology.attachedInstanceIds,
            sampleRate: input.sampleRate,
        });
        // Here, because this is where the programme is applied.
        logProgrammeExclusions(programme);
        // Material before the batch that names it, always: the native side
        // refuses a `schedule-clip` whose sample the pool does not hold, and it
        // refuses the whole batch with it. That ordering lives in
        // `applyTopologyBatch`, so both of this session's topology batches keep
        // it.
        const parked = { playing: false, positionSeconds: input.positionSeconds } as const;
        const audible = monitor === 'audible';
        // The programme travels beside the set it was projected against, never
        // implied from it: the two are one reading of the attach state, and a
        // batch built from one of each is a strip both carriers refuse.
        const projectTopology = (
            attachedInstanceIds: ReadonlySet<string>,
            against: LiveGraphProgramme
        ): readonly AudioGraphCommand[] =>
            projectSessionTopology({
                ...topology,
                attachedInstanceIds,
                transport: parked,
                monitor,
                programme: against,
            });
        const backend = createNativeLiveGraphBackend({ transport: availability.transport });
        const firstCommands = projectTopology(topology.attachedInstanceIds, programme);
        // Everything past the claim, so that every way out of it reopens the
        // gates — a rejected sample registration, a bridge that drops mid-apply,
        // a reporter that throws. An unwind that left them shut would silence
        // every carried track with no session standing to account for it.
        try {
            // Before the first await, and only for an audible session — see the
            // header for why the claim is made ahead of the answer rather than after
            // it. A shadowed session sounds nothing, so it releases instead.
            claimCarriedStrips(audible ? carriedStripIds(firstCommands) : new Set());
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
            const { resent, installed } = await bindAttachedPlugins({
                transport: availability.transport,
                backend,
                topology,
                sampleRate: input.sampleRate,
                started,
                programme,
                projectTopology,
            });
            if (resent.outcome === 'unreconciled') {
                // Half of a topology replacement is neither this batch's graph nor
                // the one the first batch installed, so there is nothing left to
                // keep.
                releaseCarriedStrips();
                backend.dispose();
                // The first batch's chains were recorded and are now describing
                // a graph that is half of two topologies and reachable through
                // no handle.
                clearNativeChains();
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
            // Restated against the batch that actually stands: binding an instance
            // can move a strip from web to native, and the optimistic claim above
            // was made before the engine held it.
            if (audible) {
                claimCarriersOf({
                    commands: rebound.commands,
                    stripTracks: topology.stripTracks,
                    attachedInstanceIds: installed.attachedInstanceIds,
                    programme: installed.programme,
                    inputMonitoredTrackIds: topology.inputMonitoredTrackIds,
                });
            }
            await installRolledSession({
                session: input,
                backend,
                topology,
                installed,
                rebound,
                monitor,
            });
            // The last topology batch the engine *applied*: a re-send that landed
            // replaced every strip the first one built, so its reports are the only
            // ones describing the graph now held — and a re-send the engine refused
            // built no strips at all, which is why that case reports the first
            // batch's.
            return {
                outcome: 'started',
                runtimeRevision: rebound.result.runtimeRevision,
                reports: rebound.result.reports,
            };
        } catch (error) {
            abandonSessionStart(backend);
            // Rethrown untouched: the gates are the only thing this repairs, and
            // a caller told the session started when it threw would be worse off
            // than one that sees the failure.
            throw error;
        }
    });
}
