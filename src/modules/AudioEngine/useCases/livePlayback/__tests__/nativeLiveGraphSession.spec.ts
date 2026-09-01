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

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphCommand, type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import { registeredNativeTimelineSampleIds } from '../../../repositories/nativeGraph/registeredNativeTimelineSampleIds';
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
    setEngineTransportMaps: vi.fn(
        (_maps: unknown): Promise<{ outcome: 'applied' } | { outcome: 'declined'; reason: string }> =>
            Promise.resolve({ outcome: 'applied' })
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
vi.mock('../readLiveGraphProgramme', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../readLiveGraphProgramme')>();
    return {
        readLiveGraphProgramme: (input: Parameters<typeof actual.readLiveGraphProgramme>[0]) =>
            (mocks.programmeOverride as ReturnType<typeof actual.readLiveGraphProgramme> | null) ??
            actual.readLiveGraphProgramme(input),
    };
});
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

/** The batches that actually reached the engine. */
function appliedBatches(): AudioGraphCommandBatch[] {
    return mocks.applyGraphCommands.mock.calls.map(([input]) => input.batch as AudioGraphCommandBatch);
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
    mocks.wireCalls = [];
    // The pool memo is module state and process-wide by design, so a case that
    // inherited the previous one's belief would see no registration at all.
    registeredNativeTimelineSampleIds.clear();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.audibleCarrier = false;
    nativeLiveGraphSession.monitorShadowed = true;
    nativeLiveGraphSession.rolling = false;
    nativeLiveGraphSession.pending = Promise.resolve();
    trackStore.set({ tracks: [createTrack({ id: 'audio-1' })], selectedTrackId: null, ghostClips: [] });
});

afterEach(() => {
    trackStore.set(null);
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
            { kind: 'set-monitor-shadow', shadowed: true },
            { kind: 'set-transport', playing: false, positionSeconds: 2.5 },
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
        mocks.setEngineTransportMaps.mockResolvedValueOnce({ outcome: 'declined', reason: 'malformed maps' });

        const result = await startNativeLiveGraphSession({
            positionSeconds: 2.5,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
        });

        // Nothing between sessions clears the engine's maps or its loop region,
        // so a roll here would run this take under the previous take's tempo
        // map and wrap at a seam this arrangement no longer has — while the Web
        // Audio transport the musician actually hears plays straight through.
        expect(appliedBatches()).toHaveLength(1);
        expect(appliedBatches()[0]?.commands).toContainEqual({
            kind: 'set-transport',
            playing: false,
            positionSeconds: 2.5,
        });
        // The session still stands: the topology is mirrored and the plugins
        // host, which is what a session is for while Web Audio is audible.
        expect(result).toMatchObject({ outcome: 'started' });
        expect(nativeLiveGraphSession.backend).not.toBeNull();
        expect(mocks.startPlayheadFeed).toHaveBeenCalled();
    });

    it('does not install maps or open the playhead feed for a session that never started', async () => {
        mocks.availability = { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
        expect(mocks.startPlayheadFeed).not.toHaveBeenCalled();
    });

    it('shadows the monitor by default, and says so on the wire', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // Silent-by-default is the safe state: the engine renders whatever it
        // is given and contributes true zeros at the device, so scheduling a
        // real programme onto it cannot double the Web Audio path.
        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: true });
        expect(nativeLiveGraphSession.monitorShadowed).toBe(true);
    });

    it('asks for an open monitor only when the caller asks for the cutover', async () => {
        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'audible',
        });

        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: false });
        expect(nativeLiveGraphSession.monitorShadowed).toBe(false);
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

        // The live topology emits strips and routes and no `schedule-clip`, so
        // this engine has nothing to sound whatever its monitor says.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('is not the audible carrier for a shadowed session that schedules a whole programme', async () => {
        mocks.topologyOverride = [SCHEDULED_CLIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS, sampleRate: SAMPLE_RATE });

        // The half that a has-clips reading gets wrong: this engine is full of
        // material and audible nowhere, so a cursor drawn from it would leave
        // the mix a musician is actually hearing.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(false);
    });

    it('becomes the audible carrier once a scheduled programme meets an open monitor', async () => {
        mocks.topologyOverride = [SCHEDULED_CLIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({
            positionSeconds: 0,
            transportMaps: FLAT_MAPS,
            sampleRate: SAMPLE_RATE,
            monitor: 'audible',
        });

        // Both halves, and only both: what was scheduled is read off the batch
        // actually sent, so the day the producer emits clips the cutover moves
        // the cursor with no edit here.
        expect(nativeLiveGraphSession.audibleCarrier).toBe(true);
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
        const settleByRegion = (maps: unknown): Promise<{ outcome: 'applied' }> => {
            const endSeconds = (maps as typeof LOOPED_MAPS).loopRegion.endSeconds;
            return new Promise((resolve) => {
                setTimeout(
                    () => {
                        reached.push(endSeconds);
                        resolve({ outcome: 'applied' });
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
        expect(appliedBatches()[0]?.commands[0]).toEqual({ kind: 'set-monitor-shadow', shadowed: true });
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
