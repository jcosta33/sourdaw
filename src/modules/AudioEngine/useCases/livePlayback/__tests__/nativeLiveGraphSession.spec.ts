/**
 * When the native engine is started, and when it is deliberately not (#3066).
 *
 * The double is `probeNativeGraphTransport`, the repository root that owns both
 * facts a use case is allowed to know about the native engine: whether a
 * transport exists here at all, and the transport itself. A use-case spec may
 * not reach past it to the desktop bridge — that boundary is enforced — and the
 * runtime gate behind the probe is proven where it lives, in the repository's
 * own spec. What is proven here is everything downstream of the answer: the
 * batch the producer builds, the session the applied batch leaves behind, and
 * the ordering between a start and a stop.
 *
 * The stop half is here rather than in its own file because the two share the
 * session: what a start leaves behind is exactly what a stop can address, and
 * the ordering between them is a property of the pair.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Device, type Track } from '#/modules/Arrangement/stores';
import { defaultExternalPluginParameterState, externalPluginParameterStore } from '#/modules/PluginHost/stores';

import { type AudioGraphCommand, type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { type EngineTransportMaps, type EngineTransportPosition } from '../../../models/EngineTransportPosition';
import { type SetEngineTransportMapsResult } from '../../../repositories/engineTransport/setEngineTransportMaps';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import { registeredNativeTimelineSampleIds } from '../../../repositories/nativeGraph/registeredNativeTimelineSampleIds';
import { type NativeGraphWireBatch } from '../../../repositories/nativeGraph/serializeAudioGraphCommand';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { masterGainState } from '../../engineAccess/masterGainState';
import { disarmNativeLiveMidiWriter } from '../disarmNativeLiveMidiWriter';
import { nativeEnginePlayheadFeed } from '../nativeEnginePlayheadFeedState';
import { nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { type LiveGraphTopologyInput } from '../projectLiveGraphTopology';
import { repositionNativeLiveGraphSession } from '../repositionNativeLiveGraphSession';
import { startNativeLiveGraphSession } from '../startNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';
import { updateNativeLiveGraphSessionTransportMaps } from '../updateNativeLiveGraphSessionTransportMaps';

const mocks = vi.hoisted(() => ({
    /** What `probeNativeGraphTransport` answers. The whole of the runtime gate. */
    availability: null as unknown,
    /** Runs when the probe is awaited, which is before the project is read. */
    onProbe: vi.fn(),
    applyGraphCommands: vi.fn<(input: { batch: unknown }) => Promise<unknown>>(),
    /**
     * The engine's own answer about the pair it installed, `loopEnabled`
     * included — not an echo of the request, but derived from it here because
     * this double has no floor a short region could fall under.
     */
    setEngineTransportMaps: vi.fn((maps: unknown): Promise<SetEngineTransportMapsResult> =>
        Promise.resolve({
            outcome: 'applied',
            applied: {
                sampleRate: 48_000,
                tempoSegments: 1,
                timeSignatureSegments: 1,
                loopEnabled: (maps as EngineTransportMaps).loopRegion?.enabled === true,
                admittedBatch: 1,
            },
        })
    ),
    startPlayheadFeed: vi.fn(),
    stopPlayheadFeed: vi.fn(),
    /**
     * A batch to send in place of the one the real producer builds, or `null`
     * to send the real one. The producer's own programme is proven where it
     * lives (`projectLiveGraphProgramme.spec.ts`, and end to end in
     * `projectLiveGraphProgrammeParity.spec.ts`); an override is how this file
     * states a batch shape without also standing up a tempo projector and a
     * buffer cache to make the producer emit one.
     */
    topologyOverride: null as readonly unknown[] | null,
    /**
     * A programme to read in place of the project's, or `null` to read the real
     * one. Standing up a tempo projector and a buffer cache just to make the
     * producer drop a clip would prove the producer here, which is not this
     * file's job; what is, is what the session does with a drop.
     */
    programmeOverride: null as unknown,
    warn: vi.fn<(message: string) => void>(),
    /** Every bridge call this session made, in order. */
    wireCalls: [] as string[],
    /**
     * PluginHost's correction for an instance the engine has just taken over.
     * Doubled because what this file owns is which instances the session
     * forwards, not what PluginHost then writes.
     */
    markExternalPluginEngineAttached: vi.fn<(input: { instanceId: string }) => void>(),
    /**
     * One entry per live backend handle the session opened, flipped when that
     * handle is closed. A declined batch has to close the handle it opened, and
     * a leaked one is invisible from the session state — which records only the
     * handle that is *kept*.
     */
    openedBackends: [] as { disposed: boolean }[],
    /**
     * Web Audio's side of the split, doubled at the use case that owns it.
     * Reaching the real one would stand up the whole Web Audio engine; what this
     * file owns is which strips the session claims and *when*, not how a gate
     * ramps.
     */
    setNativeCarriedTracks: vi.fn<(trackIds: ReadonlySet<string>) => void>(),
    /**
     * One entry per claim, with the number of batches that had already reached
     * the engine when it was made. The count is what makes "before the first
     * await" observable: an optimistic claim is made with none applied, and a
     * claim moved after the apply reads `1` here.
     */
    carriedClaims: [] as { ids: string[]; appliesBefore: number }[],
    notifyUser: vi.fn<(message: string, level: string) => void>(),
}));

vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () => {
        mocks.onProbe();
        return Promise.resolve(mocks.availability as NativeGraphAvailability);
    },
}));
vi.mock('../../../repositories/engineTransport/setEngineTransportMaps', () => ({
    setEngineTransportMaps: (maps: unknown) => mocks.setEngineTransportMaps(maps),
}));
vi.mock('../startNativeEnginePlayheadFeed', () => ({
    startNativeEnginePlayheadFeed: () => mocks.startPlayheadFeed(),
}));
vi.mock('../stopNativeEnginePlayheadFeed', () => ({
    stopNativeEnginePlayheadFeed: () => mocks.stopPlayheadFeed(),
}));
vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return { ...actual, markExternalPluginEngineAttached: mocks.markExternalPluginEngineAttached };
});
vi.mock('../readLiveGraphProgramme', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../readLiveGraphProgramme')>();
    return {
        readLiveGraphProgramme: (input: Parameters<typeof actual.readLiveGraphProgramme>[0]) =>
            (mocks.programmeOverride as ReturnType<typeof actual.readLiveGraphProgramme> | null) ??
            actual.readLiveGraphProgramme(input),
    };
});
vi.mock('../readLiveMidiProgramme', () => ({
    /**
     * The note producer's own laws — placement, overlap, the chance roll — are
     * proven where they live (`projectLiveMidiProgramme.spec.ts`), and standing
     * a tempo projector and a note store up here would prove them twice. What
     * this file owns is which attach state the session hands the writer, so the
     * double answers one note per strip whose chain names an instance in *that*
     * set, exactly as `nativeMidiNoteSink` picks the sink.
     */
    readLiveMidiProgramme: (input: { stripTracks: readonly Track[]; attachedInstanceIds: ReadonlySet<string> }) => ({
        targets: input.stripTracks.flatMap((track) => {
            const sink = track.devices.find(
                (device) =>
                    device.externalInstanceId !== undefined && input.attachedInstanceIds.has(device.externalInstanceId)
            );
            if (track.kind !== 'midi' || !sink) {
                return [];
            }
            return [
                {
                    target: { trackId: track.id, deviceId: sink.id },
                    events: [{ time: 0, note: 60, velocity: 100, channel: 0, isNoteOn: true }],
                },
            ];
        }),
        exclusions: [],
        nativeVoicedStripIds: new Set<string>(),
        probabilitySeed: 0,
    }),
}));
vi.mock('../../../repositories/nativeGraph/createNativeLiveGraphBackend', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../../repositories/nativeGraph/createNativeLiveGraphBackend')>();
    return {
        ...actual,
        createNativeLiveGraphBackend: (deps: Parameters<typeof actual.createNativeLiveGraphBackend>[0]) => {
            const backend = actual.createNativeLiveGraphBackend(deps);
            const handle = { disposed: false };
            mocks.openedBackends.push(handle);
            return {
                ...backend,
                dispose: () => {
                    handle.disposed = true;
                    backend.dispose();
                },
            };
        },
    };
});
vi.mock('../../trackAudioControls/setNativeCarriedTracks', () => ({
    setNativeCarriedTracks: (trackIds: ReadonlySet<string>) => mocks.setNativeCarriedTracks(trackIds),
}));
vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: (message: string, level: string) => mocks.notifyUser(message, level),
}));
vi.mock('../projectLiveGraphTopology', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../projectLiveGraphTopology')>();
    return {
        projectLiveGraphTopology: (input: LiveGraphTopologyInput): readonly AudioGraphCommand[] =>
            (mocks.topologyOverride as readonly AudioGraphCommand[] | null) ?? actual.projectLiveGraphTopology(input),
    };
});

/** The grid the caller places this session's programme on. */
const SAMPLE_RATE = 48_000;

/** jsdom has no `AudioBuffer`; the pool reads the fields `interleave` needs. */
const MATERIAL = {
    duration: 1,
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    length: SAMPLE_RATE,
    getChannelData: () => new Float32Array(SAMPLE_RATE),
} as unknown as AudioBuffer;

/** A `schedule-clip` command, in the shape the contract actually defines. */
const SCHEDULED_CLIP: AudioGraphCommand = {
    kind: 'schedule-clip',
    playback: {
        trackId: 'audio-1',
        source: { sourceId: 'sample-1' },
        startTime: 0,
        sourceOffsetSeconds: 0,
        durationSeconds: 1,
        playbackRate: 1,
        gain: 1,
        fade: { microFadeSeconds: 0.005 },
    },
};

/**
 * A `create-track-strip` command the engine is told to sound, in the shape the
 * contract defines. `contributesAudio` is the whole of what a carried strip is:
 * Web Audio is gated out of it, so the native engine is the only thing left to
 * voice it.
 */
const CARRIED_STRIP: AudioGraphCommand = {
    kind: 'create-track-strip',
    trackId: 'audio-1',
    name: 'Track 1',
    state: { gain: 0.8, pan: 0, muted: false, soloGated: false, vcaMultiplier: 1 },
    devices: [],
    honorMuted: true,
    contributesAudio: true,
};

/**
 * The arrangement's transport maps as this module receives them: already
 * projected into engine seconds by the Transport module, never re-derived here.
 */
const FLAT_MAPS = {
    tempo: [{ startSeconds: 0, beatsPerMinute: 120 }],
    timeSignature: [{ startSeconds: 0, numerator: 4, denominator: 4 }],
    loopRegion: { enabled: false, startSeconds: 0, endSeconds: 0 },
};

/** The same arrangement once a loop gesture has engaged a region in it. */
const LOOPED_MAPS = {
    ...FLAT_MAPS,
    loopRegion: { enabled: true, startSeconds: 2, endSeconds: 4 },
};

/** The feed's snapshot of a rolling engine, as a re-arm reads it. */
function rollingReading(positionSeconds: number): EngineTransportPosition {
    return {
        running: true,
        playing: true,
        positionSeconds,
        playheadFrame: positionSeconds * SAMPLE_RATE,
        loopWraps: 0,
        batchesApplied: 0,
        tempo: 120,
        timeSigNum: 4,
        timeSigDenom: 4,
        masterPeak: 0,
    };
}

const APPLIED = { acceptance: 'accepted', application: 'applied', runtimeRevision: 1, reports: [] };

/**
 * The two commands a live session may issue, and nothing else: material into
 * the sample pool, then the batch that names it. A session that rendered or
 * re-probed would fail here rather than pass on a stub that answers anything.
 *
 * Both are recorded on the one `wireCalls` log, because what this file has to
 * observe about them is their *order* — a batch applied before its material is
 * a batch the native side refuses whole.
 */
const transport: NativeGraphTransport = {
    applyGraphCommands: (input) => {
        mocks.wireCalls.push('apply');
        return mocks.applyGraphCommands(input);
    },
    registerTimelineSample: (input) => {
        mocks.wireCalls.push(`register:${input.sampleId}`);
        return Promise.resolve();
    },
    renderGraphOffline: () => Promise.reject(new Error('the live session must not render offline')),
    mapGraphBatch: () => Promise.reject(new Error('the live session must not map batches')),
};

function createTrack(overrides?: Partial<Track>): Track {
    return {
        id: 'track-1',
        name: 'Track 1',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
        ...overrides,
    };
}

/**
 * Flat tempo on the sample grid, which is the whole of the clock the programme
 * needs to place a beat. The real projector's arithmetic is proven where it
 * lives; what a case here needs is a programme that can be projected at all.
 */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * 0.5 * sampleRate);
    const endSamples = Math.round(endPpq * 0.5 * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

function midiClip(id: string, trackId: string): Track['clips'][number] {
    return {
        id,
        trackId,
        name: id,
        startBeat: 0,
        endBeat: 4,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#00ff00',
        locked: false,
        muted: false,
    };
}

/** The batches that actually reached the engine. */
function appliedBatches(): AudioGraphCommandBatch[] {
    return mocks.applyGraphCommands.mock.calls.map(([input]) => input.batch as AudioGraphCommandBatch);
}

/** The whole-topology batches, which are the only ones that rebuild strips. */
function topologyBatches(): AudioGraphCommandBatch[] {
    return appliedBatches().filter((batch) => batch.replaceTopology === true);
}

/**
 * Every device the live MIDI writer addressed, across every batch it sent.
 *
 * Read in the wire shape rather than the contract's, because that is what the
 * engine is actually handed: `schedule-midi` flattens its device target into
 * the command's own fields.
 */
function scheduledMidiTargets(): { trackId: string; deviceId: string }[] {
    return mocks.applyGraphCommands.mock.calls
        .flatMap(([input]) => (input.batch as NativeGraphWireBatch).commands)
        .flatMap((command) =>
            command.kind === 'schedule-midi' ? [{ trackId: command.trackId, deviceId: command.deviceId }] : []
        );
}

/** How one batch built the strip for `trackId`, or `undefined` if it built none. */
function stripCreation(batch: AudioGraphCommandBatch | undefined, trackId: string) {
    return batch?.commands.find((command) => command.kind === 'create-track-strip' && command.trackId === trackId);
}

/** A device the host has resolved to an external plugin instance. */
function externalPluginDevice(instanceId: string): Device {
    return {
        id: `device-${instanceId}`,
        name: `device-${instanceId}`,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalPluginId: 'clap:com.example.reverb',
        externalInstanceId: instanceId,
    };
}

/**
 * A programme that gives `audio-1` something to play, which is what makes
 * `contributesAudio` a question about that strip's chain at all.
 */
const PLAYING_PROGRAMME = {
    playbacksByStripId: new Map([
        [
            'audio-1',
            [
                {
                    trackId: 'audio-1',
                    source: { sourceId: 'sample-1', buffer: MATERIAL },
                    startTime: 0,
                    sourceOffsetSeconds: 0,
                    durationSeconds: 1,
                    playbackRate: 1,
                    gain: 1,
                    fade: { microFadeSeconds: 0.005 },
                },
            ],
        ],
    ]),
    bakedStripIds: new Set<string>(),
    webVoicedStripIds: new Set<string>(),
    exclusions: [],
};

/**
 * PluginHost's real write, doubled: `markExternalPluginEngineAttached` records
 * the attachment in the parameter snapshot, and that snapshot is what the
 * producer reads. Without it the re-send would rebuild the same topology and
 * this file would be asserting a batch count rather than a binding.
 */
function attachReportedInstancesInStore(): void {
    mocks.markExternalPluginEngineAttached.mockImplementation(({ instanceId }) => {
        externalPluginParameterStore.update((state) => {
            const current = state ?? defaultExternalPluginParameterState;
            return {
                ...current,
                byInstanceId: {
                    ...current.byInstanceId,
                    [instanceId]: { engineAttached: true, parameters: [] },
                },
            };
        });
    });
}

beforeEach(() => {
    mocks.availability = { available: true, transport };
    mocks.onProbe.mockReset();
    mocks.applyGraphCommands.mockReset();
    mocks.applyGraphCommands.mockResolvedValue(APPLIED);
    mocks.setEngineTransportMaps.mockClear();
    mocks.startPlayheadFeed.mockClear();
    mocks.stopPlayheadFeed.mockClear();
    mocks.topologyOverride = null;
    mocks.programmeOverride = null;
    mocks.warn.mockClear();
    mocks.markExternalPluginEngineAttached.mockReset();
    mocks.openedBackends = [];
    mocks.wireCalls = [];
    mocks.carriedClaims = [];
    mocks.notifyUser.mockClear();
    mocks.setNativeCarriedTracks.mockReset();
    mocks.setNativeCarriedTracks.mockImplementation((trackIds) => {
        mocks.carriedClaims.push({
            ids: [...trackIds],
            appliesBefore: mocks.applyGraphCommands.mock.calls.length,
        });
    });
    // Attach state is process-wide store state, so a case inheriting the
    // previous one's would build strips against an engine that never took
    // those instances.
    externalPluginParameterStore.set(defaultExternalPluginParameterState);
    // The pool memo is module state and process-wide by design, so a case that
    // inherited the previous one's belief would see no registration at all.
    registeredNativeTimelineSampleIds.clear();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.audibleCarrier = false;
    nativeLiveGraphSession.monitorShadowed = true;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.loopRegion = null;
    nativeLiveGraphSession.loopEnabled = false;
    // The notices dedupe against these, so a case inheriting the previous one's
    // text would assert silence the product does not actually produce.
    nativeLiveGraphSession.lastDeclineNotice = null;
    nativeLiveGraphSession.lastSilentPluginNotice = null;
    nativeLiveGraphSession.lastDeferredChainNotice = null;
    // The chain record is module state too, and a case inheriting the previous
    // one's would read a strip as built that this session never built.
    nativeLiveGraphSession.nativeChainByStripId = new Map();
    // The claimed set is module state as well, and the tick path reads it to
    // decide who drives a device parameter — a case inheriting the previous
    // one's would silence an IPC write for a strip this session never claimed.
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.pending = Promise.resolve();
    // The fader's position is module state too, and every batch below states
    // it, so a case inheriting the previous one's would open a session at a
    // level no gesture in it ever set.
    masterGainState.gain = 0.8;
    // The start and the maps update arm the real writer, and its pass is what
    // the arm-wiring cases below read — so it is reset with the session's own.
    nativeLiveAutomationWriter.epoch += 1;
    nativeLiveAutomationWriter.inFlightEpoch = null;
    nativeLiveAutomationWriter.pass = null;
    nativeLiveAutomationWriter.reportedExclusions = null;
    nativeEnginePlayheadFeed.reading = null;
    // The roll arms the real note writer, whose pass and note-edit
    // subscriptions are module state like the automation writer's.
    disarmNativeLiveMidiWriter();
    // The clock is module state the composition root owns, and a case that
    // needs a real programme installs its own; left standing, the next case
    // would read a programme no gesture in it asked for.
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
    trackStore.set({ tracks: [createTrack({ id: 'audio-1' })], selectedTrackId: null, ghostClips: [] });
});

afterEach(() => {
    trackStore.set(null);
    disarmNativeLiveMidiWriter();
    offlinePpqEndpointProjectorState.project = null;
    offlinePpqEndpointProjectorState.resolveTempoAtBeat = null;
});

describe('startNativeLiveGraphSession', () => {
    it('declines in a browser build without sending the engine anything', async () => {
        mocks.availability = {
            available: false,
            reason: 'no desktop bridge (browser runtime)',
            runtime: 'browser',
        };

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toEqual({ outcome: 'declined', reason: 'no desktop bridge (browser runtime)' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    // This batch is what starts the native engine, so it is also what takes over
    // every plugin instance loaded before there was one. Those instances were
    // reported to their devices as loaded but processing no audio, and this
    // result is the only correction that report ever gets.
    it('forwards every instance the engine start took over', async () => {
        mocks.applyGraphCommands.mockResolvedValueOnce({
            ...APPLIED,
            attachedPlugins: [{ instanceId: 'inst-1' }, { instanceId: 'inst-2' }],
        });

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([
            [{ instanceId: 'inst-1' }],
            [{ instanceId: 'inst-2' }],
        ]);
    });

    // A batch takes only the instances it reserved command-ring slots for, so
    // one loaded while the topology was in flight is taken by the next batch —
    // within a start sequence, the roll. Read on the topology alone, that
    // instance runs natively and stays reported as degraded for the whole
    // session.
    it('forwards the instances the roll took, not only the topology’s', async () => {
        mocks.applyGraphCommands.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce({
            ...APPLIED,
            attachedPlugins: [{ instanceId: 'inst-rolled' }],
        });

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([[{ instanceId: 'inst-rolled' }]]);
    });

    it('corrects nothing when the start attached no instances', async () => {
        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(mocks.markExternalPluginEngineAttached).not.toHaveBeenCalled();
    });

    // `apply_graph_commands` captures its plugin lookup before mapping and
    // attaches dormant instances behind the fence, so the batch that attaches an
    // instance is mapped while the engine does not yet hold it: read once, the
    // first play after loading a plugin renders the strip without it.
    it('sends the topology again, bound to the instances the first batch attached', async () => {
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        const boundReports = [{ kind: 'track' as const, id: 'audio-1', deviceIds: ['device-i1'] }];
        mocks.applyGraphCommands
            .mockResolvedValueOnce({
                ...APPLIED,
                attachedPlugins: [{ instanceId: 'i1' }],
            })
            .mockResolvedValueOnce({ ...APPLIED, runtimeRevision: 2, reports: boundReports });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        const [first, second] = topologyBatches();
        expect(topologyBatches()).toHaveLength(2);
        // The first batch could not have a body for an instance the engine was
        // not yet holding; the second is built against the attach state that
        // batch's own report created.
        expect(stripCreation(first, 'audio-1')).toMatchObject({ contributesAudio: false });
        expect(stripCreation(second, 'audio-1')).toMatchObject({ contributesAudio: true });
        // Both go out parked, ahead of the roll: `replaceTopology` tears every
        // strip down inside one fence, which a rolling engine would be heard
        // doing.
        expect(appliedBatches()[2]?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 0, locate: false },
        ]);
        // The second batch replaced every strip the first built, so its reports
        // are the only ones describing the graph the engine now holds.
        expect(result).toEqual({ outcome: 'started', runtimeRevision: 2, reports: boundReports });
    });

    // The programme is half of what a rebind decides, not a constant carried
    // through it: an instrument the first batch attached moves its strip out of
    // `webVoicedStripIds`, because the engine voices its notes through
    // `schedule-midi`. Re-projected against the earlier set, the re-send would
    // call that strip web-voiced while the writer sent its instrument notes —
    // a track on no carrier at all.
    it('projects the rebind against the set it binds, so one attach state decides both carriers', async () => {
        attachReportedInstancesInStore();
        offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
        offlinePpqEndpointProjectorState.resolveTempoAtBeat = () => 120;
        trackStore.set({
            tracks: [
                createTrack({
                    id: 'midi-1',
                    kind: 'midi',
                    devices: [externalPluginDevice('i-midi')],
                    clips: [midiClip('clip-1', 'midi-1')],
                }),
            ],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.applyGraphCommands.mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i-midi' }] });

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        const [first, second] = topologyBatches();
        // Absent from the attach set the first batch was built against, present
        // in the one the re-send binds.
        expect(stripCreation(first, 'midi-1')).toMatchObject({ contributesAudio: false });
        expect(stripCreation(second, 'midi-1')).toMatchObject({ contributesAudio: true });
        // And the writer answered to that same set: the strip Web Audio has
        // been gated out of is the one the engine is sent notes for.
        expect(scheduledMidiTargets()).toEqual([{ trackId: 'midi-1', deviceId: 'device-i-midi' }]);
    });

    it('sends the topology once when the first batch attached nothing to bind', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(topologyBatches()).toHaveLength(1);
    });

    it('never sends a third topology, however much the re-send attaches', async () => {
        // The re-send is bounded, not iterated: a loop's fixed point is whatever
        // the engine happens to attach next, and the roll already reports what
        // this batch left dormant.
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1'), externalPluginDevice('i2')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.applyGraphCommands
            .mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i1' }] })
            .mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i2' }] });

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(topologyBatches()).toHaveLength(2);
        // Bounded is not silent: the instance the re-send took is still
        // corrected on its device, it simply waits for the next play to be
        // spliced into the chain.
        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([
            [{ instanceId: 'i1' }],
            [{ instanceId: 'i2' }],
        ]);
    });

    it('keeps the session the first batch installed when the engine refuses the re-send', async () => {
        // `map_batch` builds its mapping on a clone of the registry and commits
        // it only on success, so a refused batch left the first one's topology
        // installed. Discarded here, the engine would be parked with the whole
        // project mirrored while every caller is told there is no live session
        // to stop, reposition or re-map.
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        const firstReports = [{ kind: 'track' as const, id: 'audio-1', deviceIds: [] }];
        mocks.applyGraphCommands
            .mockResolvedValueOnce({
                ...APPLIED,
                reports: firstReports,
                attachedPlugins: [{ instanceId: 'i1' }],
            })
            .mockResolvedValueOnce({
                acceptance: 'rejected',
                application: 'not-applied',
                reason: 'engine-not-running: no default output device',
            });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        // The session is the first batch's: its reports, its revision, and the
        // handle it opened.
        expect(result).toEqual({ outcome: 'started', runtimeRevision: 1, reports: firstReports });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
        expect(mocks.openedBackends.map((backend) => backend.disposed)).toEqual([false]);
        // What the refusal cost is the binding, and a cost nobody states is a
        // plugin silently missing from the chain for the rest of the session.
        expect(mocks.warn.mock.calls.map(([message]) => message)).toContainEqual(
            expect.stringContaining('engine-not-running: no default output device')
        );
        // A standing session goes on to install its maps and roll.
        expect(mocks.setEngineTransportMaps).toHaveBeenCalledWith(FLAT_MAPS);
    });

    it('discards the session when the re-send is left half applied', async () => {
        // A partial topology replacement is neither this batch's graph nor the
        // one before it, so there is nothing left to keep — unlike a refusal,
        // which changed nothing.
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.applyGraphCommands
            .mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i1' }] })
            .mockResolvedValueOnce({
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'not-attempted',
                reason: 'strip audio-1 was rebuilt without its chain',
                runtimeRevision: 2,
                reports: [],
            });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'strip audio-1 was rebuilt without its chain',
        });
        expect(nativeLiveGraphSession.backend).toBeNull();
        expect(mocks.openedBackends.map((backend) => backend.disposed)).toEqual([true]);
        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
    });

    it('keeps no session when the very first topology is left half applied', async () => {
        // The first batch has no predecessor to fall back on, so both non-applied
        // outcomes cost the session — the refusal case is proven below.
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            reason: 'the graph could not be restored',
            runtimeRevision: 1,
            reports: [],
        });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toEqual({ outcome: 'declined', reason: 'the graph could not be restored' });
        expect(nativeLiveGraphSession.backend).toBeNull();
    });

    it('starts the engine on desktop by applying the session topology', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', outputId: 'bus-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toMatchObject({ outcome: 'started', runtimeRevision: 1 });
        // The native registry outlives every batch and has no remove-strip
        // command, so a start that did not say it replaces would collide with
        // its own strip ids on the second play and refuse forever after.
        expect(appliedBatches()[0]?.replaceTopology).toBe(true);
        expect(appliedBatches()[0]?.commands).toEqual([
            { kind: 'set-monitor-shadow', shadowed: false },
            { kind: 'set-transport', playing: false, positionSeconds: 2.5 },
            { kind: 'set-master-gain', gain: 0.8 },
            expect.objectContaining({ kind: 'create-track-strip', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'create-bus-strip', busId: 'bus-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'bus-1' }),
        ]);
    });

    it('says what the programme could not carry, and still plays everything it could', async () => {
        // The producer drops a clip rather than let it refuse the whole batch,
        // which is right — and invisible unless the session says so. A track
        // that plays a bar short with nothing in the log is indistinguishable
        // from an engine defect.
        mocks.programmeOverride = {
            playbacksByStripId: new Map([
                [
                    'audio-1',
                    [
                        {
                            trackId: 'audio-1',
                            source: { sourceId: 'sample-1', buffer: MATERIAL },
                            startTime: 0,
                            sourceOffsetSeconds: 0,
                            durationSeconds: 1,
                            playbackRate: 1,
                            gain: 1,
                            fade: { microFadeSeconds: 0.005 },
                        },
                    ],
                ],
            ]),
            bakedStripIds: new Set<string>(),
            webVoicedStripIds: new Set<string>(['audio-1']),
            exclusions: [
                {
                    stripId: 'audio-1',
                    subjectId: 'runaway',
                    reason: 'its expansion needs 2 of the 0 native clip slots the strip has left',
                },
            ],
        };

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toMatchObject({ outcome: 'started' });
        const warning = mocks.warn.mock.calls
            .map(([message]) => message)
            .find((message) => message.includes('runaway'));
        expect(warning).toContain('audio-1');
        expect(warning).toContain('its expansion needs 2 of the 0 native clip slots the strip has left');
        // The drop cost that clip and nothing else — the rest still reached the
        // engine in the same batch.
        expect(appliedBatches()[0]?.commands).toContainEqual(expect.objectContaining({ kind: 'schedule-clip' }));
    });

    it('installs the loop region before the engine is ever allowed to roll', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 2.5, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The engine renders for the whole of the maps round trip. Were it
        // rolling for that stretch, a play started near the loop end would
        // cross the boundary before it was told where the boundary is, and
        // `frames_until_loop_end` would never wrap again for the session.
        const [topology, roll] = appliedBatches();
        expect(topology?.commands).toContainEqual({ kind: 'set-transport', playing: false, positionSeconds: 2.5 });
        expect(topology?.commands).not.toContainEqual(
            expect.objectContaining({ kind: 'set-transport', playing: true })
        );
        // `locate: false` is not decoration. The topology batch has already
        // parked the engine at this position, and a second locate would seek —
        // cancelling every fader, pan and send level that batch queued at frame
        // 0, which is the #3066 wipe one batch later.
        expect(roll?.commands).toEqual([{ kind: 'set-transport', playing: true, positionSeconds: 2.5, locate: false }]);
        // The roll replaces nothing: a second replacing batch would tear down
        // the topology the first one just built.
        expect(roll?.replaceTopology).toBeUndefined();

        const mapsInstalled = mocks.setEngineTransportMaps.mock.invocationCallOrder[0]!;
        expect(mapsInstalled).toBeGreaterThan(mocks.applyGraphCommands.mock.invocationCallOrder[0]!);
        expect(mapsInstalled).toBeLessThan(mocks.applyGraphCommands.mock.invocationCallOrder[1]!);
    });

    it('opens the automation pass once the engine is rolling, stamped with the roll’s own fence', async () => {
        // Topology, then the roll: the second batch carries the fence the
        // pass's snapshots are dated against, and the maps install's fence
        // (1) says nothing about it.
        mocks.applyGraphCommands.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce({ ...APPLIED, admittedBatch: 6 });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toMatchObject({ outcome: 'started' });
        // The headline path of pressing play on the native engine: a pass
        // opens where the transport rolled, proven against the roll's batch.
        expect(nativeLiveAutomationWriter.pass).toMatchObject({
            entrySeconds: 2.5,
            sampleRate: SAMPLE_RATE,
            provenAfterBatch: 6,
            looping: false,
        });
    });

    it('opens no automation pass when the roll is declined and the engine stays parked', async () => {
        mocks.applyGraphCommands.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        // A parked engine plays no automation because it plays nothing: the
        // session stands, and no pass opens over it.
        expect(result).toMatchObject({ outcome: 'started' });
        expect(nativeLiveGraphSession.rolling).toBe(false);
        expect(nativeLiveAutomationWriter.pass).toBeNull();
    });

    it('installs the transport maps outside the topology batch, and only once it is applied', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // Tempo and meter have a different producer from the live topology, so
        // they travel as their own command. A batch carrying them would make
        // the graph's all-or-nothing fence decide whether the tempo applied.
        expect(appliedBatches().flatMap((batch) => batch.commands)).not.toContainEqual(
            expect.objectContaining({ kind: 'set-transport-maps' })
        );
        expect(mocks.setEngineTransportMaps).toHaveBeenCalledWith(FLAT_MAPS);
        expect(mocks.setEngineTransportMaps.mock.invocationCallOrder[0]).toBeGreaterThan(
            mocks.applyGraphCommands.mock.invocationCallOrder[0]!
        );
    });

    it('leaves the engine parked when the maps are declined, rather than rolling under a stale pair', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;
        mocks.setEngineTransportMaps.mockResolvedValueOnce({ outcome: 'declined', reason: 'malformed maps' });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        // Nothing between sessions clears the engine's maps or its loop region,
        // so a roll here would run this take under the previous take's tempo
        // map and wrap at a seam this arrangement no longer has.
        expect(appliedBatches()).toHaveLength(1);
        expect(appliedBatches()[0]?.commands).toContainEqual({
            kind: 'set-transport',
            playing: false,
            positionSeconds: 2.5,
        });
        // The session still stands — its topology is mirrored and its plugins
        // host, which is what stop, reposition and re-map need. What does not
        // stand is the carrier claim: a parked engine renders no frame, so the
        // strip it was handed goes back to Web Audio rather than sounding on
        // neither engine for the whole take.
        expect(mocks.carriedClaims.at(-1)?.ids).toEqual([]);
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Native audio engine did not start: malformed maps. ' +
                'Playing through Web Audio; external plugins are silent until it starts.',
            'warning'
        );
        expect(result).toMatchObject({ outcome: 'started' });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
        expect(mocks.startPlayheadFeed).toHaveBeenCalled();
    });

    it('hands the carried strips back when the engine takes the topology but refuses to roll', async () => {
        // The roll is the last thing that can fail, and failing it is the worst
        // case of all: every strip is gated out of Web Audio for an engine that
        // then renders nothing.
        mocks.programmeOverride = PLAYING_PROGRAMME;
        mocks.applyGraphCommands.mockResolvedValueOnce(APPLIED).mockResolvedValueOnce({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(nativeLiveGraphSession.rolling).toBe(false);
        expect(mocks.carriedClaims.at(-1)?.ids).toEqual([]);
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Native audio engine did not start: command-queue-full. ' +
                'Playing through Web Audio; external plugins are silent until it starts.',
            'warning'
        );
        expect(result).toMatchObject({ outcome: 'started' });
    });

    it('parks the engine when it cannot read the roll answer, rather than unwinding under a rolling engine', async () => {
        // The roll command is already across the bridge when the answer turns
        // out to be unreadable, so the engine may well be rolling and sounding
        // every carried strip. Letting that throw out would reopen the Web
        // Audio gates underneath it and the musician would hear every carried
        // track twice for the length of the take.
        mocks.programmeOverride = PLAYING_PROGRAMME;
        mocks.applyGraphCommands
            .mockResolvedValueOnce(APPLIED)
            .mockResolvedValueOnce({ ...APPLIED, runtimeRevision: Number.NaN });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        // One batch past the roll, undoing it: without this the engine is left
        // rolling while every caller here believes it parked.
        expect(appliedBatches()[2]?.commands).toEqual([
            { kind: 'set-transport', playing: false, positionSeconds: 2.5, locate: false },
        ]);
        expect(nativeLiveGraphSession.rolling).toBe(false);
        expect(mocks.carriedClaims.at(-1)?.ids).toEqual([]);
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
        expect(mocks.notifyUser).toHaveBeenCalledWith(expect.stringContaining('malformed runtimeRevision'), 'warning');
        // A parked engine, not a failed start: the topology stands and the
        // handle is open, which is what stop and reposition still need.
        expect(result).toMatchObject({ outcome: 'started' });
    });

    it('hands the carried strips back when a step past the claim throws, and lets the error out', async () => {
        // An unwind is an exit like any other. One that left the gates shut
        // would silence every carried track with no session standing to account
        // for it, and no decline for a caller to read either.
        mocks.programmeOverride = PLAYING_PROGRAMME;
        const bridgeFailure = new Error('the bridge closed while installing the maps');
        mocks.setEngineTransportMaps.mockRejectedValueOnce(bridgeFailure);

        await expect(
            startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE })
        ).rejects.toBe(bridgeFailure);

        expect(mocks.carriedClaims).toEqual([
            { ids: ['audio-1'], appliesBefore: 0 },
            { ids: ['audio-1'], appliesBefore: 1 },
            { ids: [], appliesBefore: 1 },
        ]);
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('does not install maps or open the playhead feed for a session that never started', async () => {
        mocks.availability = { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
        expect(mocks.startPlayheadFeed).not.toHaveBeenCalled();
    });

    it('opens the monitor by default, and says so on the wire', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The session is the carrier for every strip it can host (#3564), and a
        // shadowed engine writes true zeros at the device however full its
        // timeline is — so a shadowed default would gate those strips out of
        // Web Audio and sound them nowhere.
        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: false });
        expect(nativeLiveGraphSession.monitorShadowed).toBe(false);
    });

    // A strip this engine carries leaves through the native device and never
    // crosses the Web Audio master node, so a session opened at unity would
    // play those tracks hot against every strip Web Audio is still sounding.
    it('opens at the level the master fader is standing at', async () => {
        masterGainState.gain = 0.35;

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // In the opening group, ahead of every strip it governs, so the first
        // block this session renders is already at the fader's level.
        expect(appliedBatches()[0]?.commands[2]).toEqual({ kind: 'set-master-gain', gain: 0.35 });
    });

    it('shadows the monitor only when the caller asks for a silent mirror', async () => {
        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'shadowed',
        });

        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: true });
        expect(nativeLiveGraphSession.monitorShadowed).toBe(true);
    });

    it('puts a clip’s material in the sample pool before the batch that names it', async () => {
        // The native side refuses a `schedule-clip` whose sample the pool does
        // not hold, and refuses the whole batch with it — so a session that
        // applied first would start with no topology at all.
        mocks.topologyOverride = [
            {
                ...SCHEDULED_CLIP,
                playback: { ...SCHEDULED_CLIP.playback, source: { sourceId: 'sample-1', buffer: MATERIAL } },
            },
            { kind: 'set-transport', playing: false, positionSeconds: 0 },
        ];

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.wireCalls).toEqual(['register:sample-1', 'apply', 'apply']);
    });

    it('does not re-send material the pool already holds, so the gesture pays nothing', async () => {
        mocks.topologyOverride = [
            {
                ...SCHEDULED_CLIP,
                playback: { ...SCHEDULED_CLIP.playback, source: { sourceId: 'sample-1', buffer: MATERIAL } },
            },
            { kind: 'set-transport', playing: false, positionSeconds: 0 },
        ];
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.wireCalls = [];

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.wireCalls.filter((call) => call.startsWith('register:'))).toEqual([]);
    });

    it('is not the audible carrier while nothing is scheduled', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The project holds one bare track with no clip and no plugin, so the
        // live topology carries no strip natively and this engine has nothing
        // to sound whatever its monitor says.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('is not the audible carrier for a shadowed session however many strips it carries', async () => {
        mocks.topologyOverride = [CARRIED_STRIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'shadowed',
        });

        // The half a carried-strips reading alone gets wrong: this engine holds
        // the whole mix and is audible nowhere, so a cursor drawn from it would
        // leave the mix a musician is actually hearing.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('becomes the audible carrier once a carried strip meets an open monitor', async () => {
        mocks.topologyOverride = [CARRIED_STRIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'audible',
        });

        // Both halves, and only both. The strip is carried with no clip on it
        // at all — which is exactly a track whose only voice is a hosted plugin
        // the engine holds, and the case a has-clips reading called silent.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(true);
    });

    it('is not the audible carrier for a clip on a strip the engine was not told to sound', async () => {
        mocks.topologyOverride = [SCHEDULED_CLIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'audible',
        });

        // Web Audio still owns that strip, so what the native engine renders of
        // this clip reaches no output. Reading the session as the carrier would
        // move the cursor onto a transport nobody hears.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('claims the strips it is about to sound before the batch that sounds them', async () => {
        // Web Audio renders every strip whatever the gates say, so an early
        // claim costs a reopened gate at worst. A claim made after the apply
        // leaves the strips open across the whole bridge round trip while the
        // native engine is already sounding them, which is a doubled mix.
        mocks.programmeOverride = PLAYING_PROGRAMME;

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.carriedClaims[0]).toEqual({ ids: ['audio-1'], appliesBefore: 0 });
    });

    it('records the strips it claimed, and gives them all back at the stop', async () => {
        // The automation tick asks this set whether the native engine or Web
        // Audio owns a hosted plugin's parameters (#3568). Never recorded, it
        // answers no and every moving parameter is written down both routes.
        // Left standing past the stop, it answers yes for a session that no
        // longer exists and the parameter stops following its lane.
        mocks.programmeOverride = PLAYING_PROGRAMME;

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect([...nativeLiveGraphSession.carriedStripIds]).toEqual(['audio-1']);

        await stopNativeLiveGraphSession({ positionSeconds: 8 });

        expect([...nativeLiveGraphSession.carriedStripIds]).toEqual([]);
    });

    it('leaves an armed track on auto monitoring open, because auto is monitoring while it is armed', async () => {
        // `auto` is the default a track ships with, so a session reading only
        // `inputMonitoring === 'on'` would gate every armed track shut. The live
        // input reaches the Web Audio strip and nothing else, and an overdub is
        // exactly the take where the musician has to hear themselves.
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', inputMonitoring: 'auto', armed: true })],
            selectedTrackId: null,
            ghostClips: [],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The optimistic claim and the restatement behind it, both empty.
        expect(mocks.carriedClaims.map((claim) => claim.ids)).toEqual([[], []]);
    });

    it('claims nothing for a shadowed session, which has no strip to take over', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'shadowed',
        });

        // Gating a strip out of Web Audio for an engine that writes true zeros
        // at the device is silence with no carrier at all.
        expect(mocks.carriedClaims.map((claim) => claim.ids)).toEqual([[]]);
    });

    it('restates the claim against the topology the engine actually bound', async () => {
        // Binding an instance moves its strip from web to native, and the
        // optimistic claim was made before the engine held it — so a session
        // that never restated would leave that strip sounding twice.
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.applyGraphCommands
            .mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i1' }] })
            .mockResolvedValueOnce({ ...APPLIED, runtimeRevision: 2 });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.carriedClaims).toEqual([
            { ids: [], appliesBefore: 0 },
            { ids: ['audio-1'], appliesBefore: 2 },
        ]);
        // A plugin the engine took is a plugin the musician will hear, so there
        // is nothing to warn about.
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('reopens every gate when the first topology is left half applied, and says why', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            reason: 'the graph could not be restored',
            runtimeRevision: 1,
            reports: [],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // A gate left shut for an engine that never sounded anything is a track
        // that plays on neither carrier, and silence is the one outcome no
        // fallback recovers from.
        expect(mocks.carriedClaims).toEqual([
            { ids: ['audio-1'], appliesBefore: 0 },
            { ids: [], appliesBefore: 1 },
        ]);
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Native audio engine did not start: the graph could not be restored. ' +
                'Playing through Web Audio; external plugins are silent until it starts.',
            'warning'
        );
    });

    it('reopens every gate when the attach re-send is left half applied', async () => {
        attachReportedInstancesInStore();
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });
        mocks.applyGraphCommands
            .mockResolvedValueOnce({ ...APPLIED, attachedPlugins: [{ instanceId: 'i1' }] })
            .mockResolvedValueOnce({
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'not-attempted',
                reason: 'strip audio-1 was rebuilt without its chain',
                runtimeRevision: 2,
                reports: [],
            });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The release is the second claim, made after both batches — the
        // optimistic one alone would leave this path with nothing to reopen.
        expect(mocks.carriedClaims).toHaveLength(2);
        expect(mocks.carriedClaims.at(-1)).toEqual({ ids: [], appliesBefore: 2 });
        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Native audio engine did not start: strip audio-1 was rebuilt without its chain. ' +
                'Playing through Web Audio; external plugins are silent until it starts.',
            'warning'
        );
    });

    it('tells the musician about a decline once, not once per play', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'engine-not-running: no default output device',
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // A desktop engine that cannot start fails the same way on every play,
        // and a musician who pressed play twice does not need telling twice.
        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('says nothing at all in a browser build, where there is no engine to miss', async () => {
        mocks.availability = { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('names every plugin it cannot sound, and why, rather than logging it', async () => {
        // Only the native engine hosts an external plugin; the Web Audio device
        // standing in its place passes audio through untouched. A musician
        // hitting play hears the track without the plugin and has no other way
        // to learn that is what happened.
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.notifyUser).toHaveBeenCalledWith(
            'Plugins silent until the native engine can host their tracks:\n' +
                '"device-i1" on "Track 1": plugin "device-i1" is not attached to the engine',
            'warning'
        );
    });

    it('names them once, not once per play, while nothing about them changes', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', devices: [externalPluginDevice('i1')] })],
            selectedTrackId: null,
            ghostClips: [],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.notifyUser).toHaveBeenCalledTimes(1);
    });

    it('declines on desktop when the addon cannot answer the graph surface', async () => {
        mocks.availability = {
            available: false,
            reason: 'native graph commands unavailable: command not exposed',
            runtime: 'desktop',
        };

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'native graph commands unavailable: command not exposed',
        });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('declines with the native reason when the engine refuses the topology, and keeps no session', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'engine-not-running: no default output device',
        });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        expect(result).toEqual({
            outcome: 'declined',
            reason: 'engine-not-running: no default output device',
        });
        expect(nativeLiveGraphSession.backend).toBeNull();
    });

    it('reads the project as it stands when the batch is sent, not when the gesture happened', async () => {
        mocks.onProbe.mockImplementation(() => {
            trackStore.set({
                tracks: [createTrack({ id: 'audio-1' }), createTrack({ id: 'audio-2' })],
                selectedTrackId: null,
                ghostClips: [],
            });
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(appliedBatches()[0]?.commands.filter((command) => command.kind === 'create-track-strip')).toHaveLength(
            2
        );
    });
});

describe('updateNativeLiveGraphSessionTransportMaps', () => {
    it('declines when no session ever started, which is the browser-build answer', async () => {
        const result = await updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });

        expect(result).toEqual({ outcome: 'declined', reason: 'no live native graph session' });
        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
    });

    it('installs the edited region on a rolling session without touching its topology or its transport', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.setEngineTransportMaps.mockClear();
        const batchesBefore = appliedBatches().length;

        const result = await updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });

        expect(result).toEqual({ outcome: 'updated' });
        expect(mocks.setEngineTransportMaps).toHaveBeenCalledExactlyOnceWith(LOOPED_MAPS);
        // No graph batch at all. A batch would have to carry `set-transport`,
        // which is the one thing this must not state: the region changed, where
        // the playhead stands and whether it is moving did not.
        expect(appliedBatches()).toHaveLength(batchesBefore);
    });

    it('re-arms the pass from where the engine stands when the install changes the region', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        const epochAtStart = nativeLiveAutomationWriter.epoch;
        expect(nativeLiveAutomationWriter.pass?.entrySeconds).toBe(0);

        // The pass was written for the region that is about to go away. The
        // feed has read the engine since the start, so its snapshot is where
        // the re-armed pass begins; the install's own fence is what its
        // snapshots are dated against, because the region is not the engine's
        // until that batch has drained.
        nativeEnginePlayheadFeed.reading = rollingReading(3.25);
        mocks.setEngineTransportMaps.mockResolvedValueOnce({
            outcome: 'applied',
            applied: {
                sampleRate: SAMPLE_RATE,
                tempoSegments: 1,
                timeSignatureSegments: 1,
                loopEnabled: true,
                admittedBatch: 7,
            },
        });

        const result = await updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });

        expect(result).toEqual({ outcome: 'updated' });
        expect(nativeLiveAutomationWriter.epoch).toBeGreaterThan(epochAtStart);
        expect(nativeLiveAutomationWriter.pass).toMatchObject({
            entrySeconds: 3.25,
            provenAfterBatch: 7,
            looping: true,
        });
    });

    it('replaces the stale pair on a session parked by declined maps, and still does not roll it', async () => {
        mocks.setEngineTransportMaps.mockResolvedValueOnce({ outcome: 'declined', reason: 'malformed maps' });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        const batchesBefore = appliedBatches().length;

        const result = await updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });

        // The park exists to keep the *previous* take's tempo map and loop seam
        // unreachable, and this write is what replaces them — so it is welcome
        // here. What would not be is a transport command: `playing: true` would
        // set that engine rendering, which is the whole thing the park prevents.
        expect(result).toEqual({ outcome: 'updated' });
        expect(mocks.setEngineTransportMaps).toHaveBeenLastCalledWith(LOOPED_MAPS);
        expect(appliedBatches()).toHaveLength(batchesBefore);
    });

    it('keeps the session when the engine refuses the maps', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.setEngineTransportMaps.mockResolvedValueOnce({
            outcome: 'declined',
            reason: 'no native engine is running',
        });

        const result = await updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });

        // A refused maps write says nothing about the topology or the handle it
        // was sent through; the engine simply keeps the pair it already held.
        expect(result).toEqual({ outcome: 'declined', reason: 'no native engine is running' });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
    });

    it('never overtakes a start that is still in flight', async () => {
        let releaseStart = (): void => undefined;
        const startApplied = new Promise<void>((resolve) => {
            releaseStart = () => {
                resolve();
            };
        });
        mocks.applyGraphCommands.mockImplementationOnce(() => startApplied.then(() => APPLIED));

        const start = startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });
        const update = updateNativeLiveGraphSessionTransportMaps({ transportMaps: LOOPED_MAPS });
        releaseStart();
        await start;

        // Admitted ahead of the start, this would find no session to update and
        // decline — and then the start would install the region the musician had
        // already changed, leaving the engine looping at the old seam.
        expect(await update).toEqual({ outcome: 'updated' });
        expect(mocks.setEngineTransportMaps.mock.calls).toEqual([[FLAT_MAPS], [LOOPED_MAPS]]);
    });

    it('leaves a burst of loop edits settled on the region issued last, not the one that resolved last', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // Dragging a loop brace commits a region per gesture, and the engine
        // keeps whichever pair reached it *last*. Round trips that resolve out
        // of order are the hazard: here the earliest edit is the slowest, so
        // issuing all three at once without the session chain would land the
        // 4-second region last and leave the engine wrapping two seconds before
        // the brace the musician let go of.
        const settleMs = new Map([
            [4, 30],
            [8, 10],
            [12, 0],
        ]);
        const reached: number[] = [];
        const settleByRegion = (maps: unknown): Promise<SetEngineTransportMapsResult> => {
            const endSeconds = (maps as typeof LOOPED_MAPS).loopRegion.endSeconds;
            return new Promise((resolve) => {
                setTimeout(
                    () => {
                        reached.push(endSeconds);
                        resolve({
                            outcome: 'applied',
                            applied: {
                                sampleRate: 48_000,
                                tempoSegments: 1,
                                timeSignatureSegments: 1,
                                loopEnabled: true,
                                admittedBatch: 1,
                            },
                        });
                    },
                    settleMs.get(endSeconds) ?? 0
                );
            });
        };
        mocks.setEngineTransportMaps
            .mockImplementationOnce(settleByRegion)
            .mockImplementationOnce(settleByRegion)
            .mockImplementationOnce(settleByRegion);

        await Promise.all(
            [4, 8, 12].map((endSeconds) =>
                updateNativeLiveGraphSessionTransportMaps({
                    transportMaps: { ...LOOPED_MAPS, loopRegion: { enabled: true, startSeconds: 0, endSeconds } },
                })
            )
        );

        expect(reached).toEqual([4, 8, 12]);
    });
});

describe('stopNativeLiveGraphSession', () => {
    it('declines when no session ever started, which is the browser-build answer', async () => {
        const result = await stopNativeLiveGraphSession({ positionSeconds: 0 });

        expect(result).toEqual({ outcome: 'declined', reason: 'no live native graph session' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('reopens every carrier gate with no session at all, and sends nothing to do it', async () => {
        // A stopped transport plays no timeline, so nothing the native engine
        // was carrying is being sounded — while a strip whose input a musician
        // is monitoring has to be heard *precisely* now. Gated behind a session
        // that does not exist, it would stay shut for good.
        await stopNativeLiveGraphSession({ positionSeconds: 0 });

        expect(mocks.carriedClaims).toEqual([{ ids: [], appliesBefore: 0 }]);
    });

    it('reopens the gates before the park command rather than behind its round trip', async () => {
        mocks.programmeOverride = PLAYING_PROGRAMME;
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        const appliesAtStop = mocks.applyGraphCommands.mock.calls.length;
        mocks.carriedClaims = [];

        await stopNativeLiveGraphSession({ positionSeconds: 8 });

        // Released behind the apply, the monitored strip stays silent for a
        // whole bridge round trip after the musician stopped the transport.
        expect(mocks.carriedClaims).toEqual([{ ids: [], appliesBefore: appliesAtStop }]);
    });

    it('tells a started engine that playback stopped, and where the playhead came to rest', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        const result = await stopNativeLiveGraphSession({ positionSeconds: 8 });

        expect(result).toEqual({ outcome: 'stopped' });
        expect(appliedBatches().at(-1)?.commands).toEqual([
            { kind: 'set-transport', playing: false, positionSeconds: 8 },
        ]);
        // A stop that replaced would tear the graph down and take the plugin
        // runtimes standing on it with it; a stop is not a project close.
        expect(appliedBatches().at(-1)?.replaceTopology).toBeUndefined();
    });

    // A stop is a batch like any other, and an instance loaded while the
    // transport was rolling is taken by whichever batch comes next. When that
    // batch is the stop, nothing else follows it until the next start, so a
    // correction dropped here leaves the device reporting a plugin that
    // processes no audio while the engine has been rendering it all along.
    it('forwards the instances the stop’s batch took over', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.markExternalPluginEngineAttached.mockClear();
        mocks.applyGraphCommands.mockResolvedValueOnce({
            ...APPLIED,
            attachedPlugins: [{ instanceId: 'inst-stopped' }],
        });

        await stopNativeLiveGraphSession({ positionSeconds: 8 });

        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([[{ instanceId: 'inst-stopped' }]]);
    });

    it('keeps the session when the engine refuses the stop, so a playing engine stays reachable', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });

        const result = await stopNativeLiveGraphSession({ positionSeconds: 8 });

        expect(result).toEqual({ outcome: 'declined', reason: 'command-queue-full' });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
        // The feed polls the engine every animation frame. A refused stop must
        // still close it, or a stopped transport keeps a request in flight for
        // the rest of the session.
        expect(mocks.stopPlayheadFeed).toHaveBeenCalled();
    });

    it('never overtakes a start that is still in flight', async () => {
        let releaseStart = (): void => undefined;
        const startApplied = new Promise<void>((resolve) => {
            releaseStart = () => {
                resolve();
            };
        });
        mocks.applyGraphCommands.mockImplementationOnce(() => startApplied.then(() => APPLIED));

        const start = startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });
        const stop = stopNativeLiveGraphSession({ positionSeconds: 4 });
        releaseStart();
        await start;
        const stopResult = await stop;

        expect(stopResult).toEqual({ outcome: 'stopped' });
        // Topology, then the roll the start owns, and only then the stop. A
        // stop admitted between the two would park an engine the start is
        // about to set rolling, and the session would play with no transport.
        expect(appliedBatches()).toHaveLength(3);
        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: false });
        expect(appliedBatches()[1]?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 0, locate: false },
        ]);
        expect(appliedBatches()[2]?.commands).toEqual([{ kind: 'set-transport', playing: false, positionSeconds: 4 }]);
    });
});

describe('repositionNativeLiveGraphSession', () => {
    it('declines when no session ever started, which is the browser-build answer', async () => {
        const result = await repositionNativeLiveGraphSession({ positionSeconds: 4 });

        expect(result).toEqual({ outcome: 'declined', reason: 'no live native graph session' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('locates a rolling engine with the transport alone, re-sending neither topology nor maps', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.setEngineTransportMaps.mockClear();

        const result = await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        expect(result).toEqual({ outcome: 'repositioned' });
        // The loop region and the tempo and meter maps are owned by their own
        // engine commands and survive a locate untouched, so a reposition that
        // re-sent them would be re-stating what the engine already holds.
        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
        expect(appliedBatches().at(-1)?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 12.5 },
        ]);
        // A locate that replaced would tear down the topology the plugin
        // runtimes are standing on to move the playhead a few beats.
        expect(appliedBatches().at(-1)?.replaceTopology).toBeUndefined();
    });

    // The fader is a smoother the engine advances per sample, holding no frame
    // for the seek to invalidate, so a locate leaves the master level exactly
    // where it stands and a restate here would carry no work.
    it('leaves the master level alone, because a locate cannot reach the fader', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        masterGainState.gain = 0.6;

        await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        expect(appliedBatches().at(-1)?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 12.5 },
        ]);
    });

    // Every route that applies a batch carries the correction, because any
    // batch may be the one that finds an instance parked: a plugin loaded while
    // the session was already rolling is taken by whatever batch comes next,
    // and a locate is a batch.
    it('forwards the instances a locate’s batch took over', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.markExternalPluginEngineAttached.mockClear();
        mocks.applyGraphCommands.mockResolvedValueOnce({
            ...APPLIED,
            attachedPlugins: [{ instanceId: 'inst-located' }],
        });

        await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        expect(mocks.markExternalPluginEngineAttached.mock.calls).toEqual([[{ instanceId: 'inst-located' }]]);
    });

    it('refuses to roll an engine the session parked because its maps were declined', async () => {
        mocks.setEngineTransportMaps.mockResolvedValueOnce({ outcome: 'declined', reason: 'malformed maps' });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        const batchesBefore = appliedBatches().length;

        const result = await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        // `playing: true` would set that engine rolling under the *previous*
        // take's tempo map and loop seam — the exact state the park exists to
        // keep unreachable — while Web Audio plays straight through it.
        expect(result).toEqual({ outcome: 'declined', reason: 'native transport is parked' });
        expect(appliedBatches()).toHaveLength(batchesBefore);
    });

    it('sends nothing to an engine a stop already parked', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        await stopNativeLiveGraphSession({ positionSeconds: 8 });
        const batchesBefore = appliedBatches().length;

        const result = await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        expect(result).toEqual({ outcome: 'declined', reason: 'native transport is parked' });
        expect(appliedBatches()).toHaveLength(batchesBefore);
    });

    it('keeps the session when the engine refuses the locate', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });

        const result = await repositionNativeLiveGraphSession({ positionSeconds: 12.5 });

        expect(result).toEqual({ outcome: 'declined', reason: 'command-queue-full' });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
    });

    it('never overtakes a start that is still in flight', async () => {
        let releaseStart = (): void => undefined;
        const startApplied = new Promise<void>((resolve) => {
            releaseStart = () => {
                resolve();
            };
        });
        mocks.applyGraphCommands.mockImplementationOnce(() => startApplied.then(() => APPLIED));

        const start = startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });
        const reposition = repositionNativeLiveGraphSession({ positionSeconds: 12.5 });
        releaseStart();
        await start;

        // Admitted ahead of the start, this would locate the session it is
        // replacing and then be overwritten by the start's own roll at the old
        // position — the seek silently lost.
        expect(await reposition).toEqual({ outcome: 'repositioned' });
        expect(appliedBatches()[1]?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 0, locate: false },
        ]);
        expect(appliedBatches()[2]?.commands).toEqual([
            { kind: 'set-transport', playing: true, positionSeconds: 12.5 },
        ]);
    });

    it('leaves a burst of locates settled where the gesture ended, not where the round trips resolved', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // A drag-scrub emits one seek per pointer frame, and the engine keeps
        // whichever locate reached it *last*. Round trips that resolve out of
        // order are the hazard: here the earliest locate is the slowest, so
        // issuing all three at once without the session chain would land 12
        // first and 4 last, leaving the engine four seconds behind a gesture
        // that ended at twelve.
        const settleMs = new Map([
            [4, 30],
            [8, 10],
            [12, 0],
        ]);
        const reached: number[] = [];
        mocks.applyGraphCommands.mockImplementation(({ batch }) => {
            const command = (batch as AudioGraphCommandBatch).commands[0];
            const position = command?.kind === 'set-transport' ? command.positionSeconds : -1;
            return new Promise((resolve) => {
                setTimeout(
                    () => {
                        reached.push(position);
                        resolve(APPLIED);
                    },
                    settleMs.get(position) ?? 0
                );
            });
        });

        await Promise.all([4, 8, 12].map((positionSeconds) => repositionNativeLiveGraphSession({ positionSeconds })));

        expect(reached).toEqual([4, 8, 12]);
    });
});

describe('the chain record a rolling mirror addresses', () => {
    /**
     * The record is built from the engine's reports, never from the commands
     * the batch carried. A device the mapper degraded was asked for and is not
     * in the chain, so a record built from requests would place every later
     * insert one slot wrong.
     */
    it('is the reports of the topology batch, not the devices it asked for', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            ...APPLIED,
            reports: [
                { kind: 'track', id: 'audio-1', deviceIds: ['device-built'] },
                { kind: 'bus', id: 'bus-1', deviceIds: [] },
            ],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([
            ['audio-1', ['device-built']],
            ['bus-1', []],
        ]);
    });

    /**
     * A topology batch tears every strip down inside its own fence, so a strip
     * the newest one does not report is a strip the engine no longer has.
     * Merging would leave a mirror addressing a chain that was replaced.
     */
    it('is replaced by the newest topology batch rather than merged into', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'gone-next-time', deviceIds: ['device-a'] }],
        });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.applyGraphCommands.mockResolvedValue({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: [] }],
        });

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(nativeLiveGraphSession.nativeChainByStripId.has('gone-next-time')).toBe(false);
        expect(nativeLiveGraphSession.nativeChainByStripId.has('audio-1')).toBe(true);
    });

    /**
     * A start that threw past its topology batch leaves a record describing a
     * graph reachable through no handle. A mirror reading it would send a chain
     * edit into a session that was abandoned.
     */
    it('is cleared when a start is abandoned after its topology landed', async () => {
        mocks.applyGraphCommands.mockResolvedValueOnce({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
        });
        mocks.setEngineTransportMaps.mockImplementationOnce(() => Promise.reject(new Error('bridge dropped')));

        await expect(
            startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE })
        ).rejects.toThrow('bridge dropped');

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([]);
    });

    /** Forgotten with the roll it described: the next play records its own. */
    it('is cleared once the stop the engine took has parked the transport', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
        });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        await stopNativeLiveGraphSession({ positionSeconds: 3 });

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([]);
    });

    /**
     * A refused stop leaves a still-rolling engine, and forgetting its chains
     * would strand every later edit on "strip not built" for a session that is
     * still sounding.
     */
    it('survives a stop the engine refused', async () => {
        mocks.applyGraphCommands.mockResolvedValue({
            ...APPLIED,
            reports: [{ kind: 'track', id: 'audio-1', deviceIds: ['device-a'] }],
        });
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'transport busy',
        });

        await stopNativeLiveGraphSession({ positionSeconds: 3 });

        expect([...nativeLiveGraphSession.nativeChainByStripId]).toEqual([['audio-1', ['device-a']]]);
    });
});
