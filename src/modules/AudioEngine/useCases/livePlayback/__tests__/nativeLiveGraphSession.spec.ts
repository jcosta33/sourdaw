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
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { type LiveGraphTopologyInput } from '../projectLiveGraphTopology';
import { startNativeLiveGraphSession } from '../startNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';

const mocks = vi.hoisted(() => ({
    /** What `probeNativeGraphTransport` answers. The whole of the runtime gate. */
    availability: null as unknown,
    /** Runs when the probe is awaited, which is before the project is read. */
    onProbe: vi.fn(),
    applyGraphCommands: vi.fn<(input: { batch: unknown }) => Promise<unknown>>(),
    setEngineTransportMaps: vi.fn((_maps: unknown) => Promise.resolve({ outcome: 'applied' as const })),
    startPlayheadFeed: vi.fn(),
    stopPlayheadFeed: vi.fn(),
    /**
     * A batch to send in place of the one the real producer builds, or `null`
     * to send the real one. The live producer emits no `schedule-clip` by
     * design, so this is the only way to observe what the session concludes
     * from a batch that does.
     */
    topologyOverride: null as readonly unknown[] | null,
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
vi.mock('../projectLiveGraphTopology', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../projectLiveGraphTopology')>();
    return {
        projectLiveGraphTopology: (input: LiveGraphTopologyInput): readonly AudioGraphCommand[] =>
            (mocks.topologyOverride as readonly AudioGraphCommand[] | null) ?? actual.projectLiveGraphTopology(input),
    };
});

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

const APPLIED = { acceptance: 'accepted', application: 'applied', runtimeRevision: 1, reports: [] };

/**
 * Every method but `applyGraphCommands` rejects: the live session must reach
 * the engine through that one command, so a session that started registering
 * material or probing again would fail here rather than pass on a stub that
 * answers anything.
 */
const transport: NativeGraphTransport = {
    applyGraphCommands: (input) => mocks.applyGraphCommands(input),
    registerTimelineSample: () => Promise.reject(new Error('the live session must not register samples')),
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
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.carriesAudio = false;
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

        const result = await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

        expect(result).toEqual({ outcome: 'declined', reason: 'no desktop bridge (browser runtime)' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('starts the engine on desktop by applying the session topology', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', outputId: 'bus-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const result = await startNativeLiveGraphSession({ positionSeconds: 2.5, transportMaps: FLAT_MAPS });

        expect(result).toMatchObject({ outcome: 'started', runtimeRevision: 1 });
        // The native registry outlives every batch and has no remove-strip
        // command, so a start that did not say it replaces would collide with
        // its own strip ids on the second play and refuse forever after.
        expect(appliedBatches()[0]?.replaceTopology).toBe(true);
        expect(appliedBatches()[0]?.commands).toEqual([
            expect.objectContaining({ kind: 'create-track-strip', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'create-bus-strip', busId: 'bus-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'bus-1' }),
            { kind: 'set-transport', playing: false, positionSeconds: 2.5 },
        ]);
    });

    it('installs the loop region before the engine is ever allowed to roll', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 2.5, transportMaps: FLAT_MAPS });

        // The engine renders for the whole of the maps round trip. Were it
        // rolling for that stretch, a play started near the loop end would
        // cross the boundary before it was told where the boundary is, and
        // `frames_until_loop_end` would never wrap again for the session.
        const [topology, roll] = appliedBatches();
        expect(topology?.commands.at(-1)).toEqual({ kind: 'set-transport', playing: false, positionSeconds: 2.5 });
        expect(roll?.commands).toEqual([{ kind: 'set-transport', playing: true, positionSeconds: 2.5 }]);
        // The roll replaces nothing: a second replacing batch would tear down
        // the topology the first one just built.
        expect(roll?.replaceTopology).toBeUndefined();

        const mapsInstalled = mocks.setEngineTransportMaps.mock.invocationCallOrder[0]!;
        expect(mapsInstalled).toBeGreaterThan(mocks.applyGraphCommands.mock.invocationCallOrder[0]!);
        expect(mapsInstalled).toBeLessThan(mocks.applyGraphCommands.mock.invocationCallOrder[1]!);
    });

    it('installs the transport maps outside the topology batch, and only once it is applied', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

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

    it('does not install maps or open the playhead feed for a session that never started', async () => {
        mocks.availability = { available: false, reason: 'no desktop bridge (browser runtime)', runtime: 'browser' };

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

        expect(mocks.setEngineTransportMaps).not.toHaveBeenCalled();
        expect(mocks.startPlayheadFeed).not.toHaveBeenCalled();
    });

    it('reads carriesAudio off the batch it actually sent: silent while nothing is scheduled', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

        // The live topology emits strips and routes and no `schedule-clip`, so
        // this engine renders silence and Web Audio is what a musician hears.
        expect(nativeLiveGraphSession.carriesAudio).toBe(false);
    });

    it('reads carriesAudio off the batch it actually sent: audible once a clip is scheduled', async () => {
        mocks.topologyOverride = [SCHEDULED_CLIP, { kind: 'set-transport', playing: false, positionSeconds: 0 }];

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

        // Derived from the batch rather than declared, so the day the topology
        // starts carrying clips the cursor follows the engine with no edit here.
        expect(nativeLiveGraphSession.carriesAudio).toBe(true);
    });

    it('declines on desktop when the addon cannot answer the graph surface', async () => {
        mocks.availability = {
            available: false,
            reason: 'native graph commands unavailable: command not exposed',
            runtime: 'desktop',
        };

        const result = await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

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

        const result = await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

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

        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

        expect(appliedBatches()[0]?.commands.filter((command) => command.kind === 'create-track-strip')).toHaveLength(
            2
        );
    });
});

describe('stopNativeLiveGraphSession', () => {
    it('declines when no session ever started, which is the browser-build answer', async () => {
        const result = await stopNativeLiveGraphSession({ positionSeconds: 0 });

        expect(result).toEqual({ outcome: 'declined', reason: 'no live native graph session' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('tells a started engine that playback stopped, and where the playhead came to rest', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });

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
        await startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });
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

        const start = startNativeLiveGraphSession({ positionSeconds: 0, transportMaps: FLAT_MAPS });
        const stop = stopNativeLiveGraphSession({ positionSeconds: 4 });
        releaseStart();
        await start;
        const stopResult = await stop;

        expect(stopResult).toEqual({ outcome: 'stopped' });
        // Topology, then the roll the start owns, and only then the stop. A
        // stop admitted between the two would park an engine the start is
        // about to set rolling, and the session would play with no transport.
        expect(appliedBatches().map((batch) => batch.commands.at(-1)?.kind)).toEqual([
            'set-transport',
            'set-transport',
            'set-transport',
        ]);
        expect(appliedBatches()[1]?.commands).toEqual([{ kind: 'set-transport', playing: true, positionSeconds: 0 }]);
        expect(appliedBatches()[2]?.commands).toEqual([{ kind: 'set-transport', playing: false, positionSeconds: 4 }]);
    });
});
