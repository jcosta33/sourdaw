import { logger } from '#/infra/logger/appLogger';
import {
    deriveEffectiveAudibility,
    deriveVcaMultiplier,
    getVcaGroupsState,
    trackStore,
    type Track,
} from '#/modules/Arrangement/stores';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { getAudioDeviceRuntimeSink } from '../../engine/audioDeviceRuntimeSink';
import { type AudioGraphBackend, type AudioGraphCommand } from '../../models/AudioGraphBackend';
import { createNativeLiveGraphBackend } from '../../repositories/nativeGraph/createNativeLiveGraphBackend';
import { type NativeGraphTransport } from '../../repositories/nativeGraph/nativeGraphTransport';
import { effectiveMasterGain } from '../engineAccess/masterGainState';

import { type LiveGraphProgramme } from './projectLiveGraphProgramme';
import {
    projectLiveGraphTopology,
    type LiveGraphMonitorMode,
    type LiveGraphTopologyInput,
} from './projectLiveGraphTopology';
import { readAttachedEngineInstanceIds } from './readAttachedEngineInstanceIds';
import { readLiveStripTracks } from './readLiveStripTracks';
import { readSessionProgramme } from './readSessionProgramme';

/**
 * Whether a live input is reaching this track's Web Audio strip.
 *
 * `'on'` always receives it. `'auto'` while armed is included even though the
 * Auto owner (`syncAutoInputMonitoring`) closes the edge during playback of
 * recorded material: the cost of naming a track monitored that is not is one
 * strip left on Web Audio, while the cost of the opposite is gating a
 * musician's own signal out of their headphones mid-take.
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
    projectTracks: readonly Track[];
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
        projectTracks,
        soloGatedTrackIds: new Set(
            stripTracks.filter((track) => soloGatedByTrackId.get(track.id) ?? false).map((track) => track.id)
        ),
        vcaMultiplierByTrackId: new Map(
            stripTracks.map((track): [string, number] => [
                track.id,
                deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
            ])
        ),
        attachedInstanceIds: readAttachedEngineInstanceIds(),
        inputMonitoredTrackIds: new Set(stripTracks.filter(receivesLiveInput).map((track) => track.id)),
    };
}

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
    return projectLiveGraphTopology({ ...input, masterGain: effectiveMasterGain() });
}

/**
 * The backend this session applies its batches through.
 *
 * The same sink that decodes a device's opaque state names and leases its
 * bank, so one registration answers for every device module that builds its
 * native body from staged material rather than from its record.
 */
function createSessionBackend(transport: NativeGraphTransport): AudioGraphBackend {
    return createNativeLiveGraphBackend({
        transport,
        acquireNativeSampleBank: getAudioDeviceRuntimeSink().acquireNativeSampleBank,
    });
}

type Prepared = Readonly<{
    outcome: 'prepared';
    topology: ReturnType<typeof readSessionTopology>;
    monitor: LiveGraphMonitorMode;
    programme: LiveGraphProgramme;
    backend: AudioGraphBackend;
    firstCommands: readonly AudioGraphCommand[];
    waitsForModels: boolean;
    projectTopology: (
        attachedInstanceIds: ReadonlySet<string>,
        against: LiveGraphProgramme
    ) => readonly AudioGraphCommand[];
}>;

/** Fresh synchronous preparation after the availability probe, before any carrier claim. */
export function prepareNativeSessionStart(
    input: Readonly<{
        session: Readonly<{ positionSeconds: number; sampleRate: number; monitor?: LiveGraphMonitorMode }>;
        transport: NativeGraphTransport;
        defaultMonitor: LiveGraphMonitorMode;
    }>
): Prepared | Readonly<{ outcome: 'projection-failed'; error: unknown }> {
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
    const monitor = input.session.monitor ?? input.defaultMonitor;
    const programme = readSessionProgramme({ ...topology, sampleRate: input.session.sampleRate });
    // Here, because this is where the programme is applied.
    logProgrammeExclusions(programme);
    // Material before the batch that names it, always: the native side
    // refuses a `schedule-clip` whose sample the pool does not hold, and it
    // refuses the whole batch with it. That ordering lives in
    // `applyTopologyBatch`, so both of this session's topology batches keep
    // it.
    const parked = { playing: false, positionSeconds: input.session.positionSeconds } as const;
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
    const backend = createSessionBackend(input.transport);
    let firstCommands: readonly AudioGraphCommand[];
    try {
        firstCommands = projectTopology(topology.attachedInstanceIds, programme);
    } catch (error) {
        backend.dispose();
        return { outcome: 'projection-failed', error };
    }
    const waitsForModels = firstCommands.some(
        (command) =>
            (command.kind === 'create-track-strip' || command.kind === 'create-bus-strip') &&
            command.devices.some((device) => device.grinderModel !== undefined)
    );
    return {
        outcome: 'prepared',
        topology,
        monitor,
        programme,
        backend,
        firstCommands,
        waitsForModels,
        projectTopology,
    };
}
