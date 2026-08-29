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

import { type AudioGraphCommandBatch } from '../../../models/AudioGraphBackend';
import { type NativeGraphTransport } from '../../../repositories/nativeGraph/nativeGraphTransport';
import { type NativeGraphAvailability } from '../../../repositories/nativeGraph/probeNativeGraphTransport';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { startNativeLiveGraphSession } from '../startNativeLiveGraphSession';
import { stopNativeLiveGraphSession } from '../stopNativeLiveGraphSession';

const mocks = vi.hoisted(() => ({
    /** What `probeNativeGraphTransport` answers. The whole of the runtime gate. */
    availability: null as unknown,
    /** Runs when the probe is awaited, which is before the project is read. */
    onProbe: vi.fn(),
    applyGraphCommands: vi.fn<(input: { batch: unknown }) => Promise<unknown>>(),
}));

vi.mock('../../../repositories/nativeGraph/probeNativeGraphTransport', () => ({
    probeNativeGraphTransport: () => {
        mocks.onProbe();
        return Promise.resolve(mocks.availability as NativeGraphAvailability);
    },
}));

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
    nativeLiveGraphSession.backend = null;
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

        const result = await startNativeLiveGraphSession({ positionSeconds: 0 });

        expect(result).toEqual({ outcome: 'declined', reason: 'no desktop bridge (browser runtime)' });
        expect(mocks.applyGraphCommands).not.toHaveBeenCalled();
    });

    it('starts the engine on desktop by applying the session topology', async () => {
        trackStore.set({
            tracks: [createTrack({ id: 'audio-1', outputId: 'bus-1' }), createTrack({ id: 'bus-1', kind: 'bus' })],
            selectedTrackId: null,
            ghostClips: [],
        });

        const result = await startNativeLiveGraphSession({ positionSeconds: 2.5 });

        expect(result).toMatchObject({ outcome: 'started', runtimeRevision: 1 });
        expect(appliedBatches()).toHaveLength(1);
        expect(appliedBatches()[0]?.commands).toEqual([
            expect.objectContaining({ kind: 'create-track-strip', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'create-bus-strip', busId: 'bus-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'audio-1' }),
            expect.objectContaining({ kind: 'set-track-output', trackId: 'bus-1' }),
            { kind: 'set-transport', playing: true, positionSeconds: 2.5 },
        ]);
    });

    it('declines on desktop when the addon cannot answer the graph surface', async () => {
        mocks.availability = {
            available: false,
            reason: 'native graph commands unavailable: command not exposed',
            runtime: 'desktop',
        };

        const result = await startNativeLiveGraphSession({ positionSeconds: 0 });

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

        const result = await startNativeLiveGraphSession({ positionSeconds: 0 });

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

        await startNativeLiveGraphSession({ positionSeconds: 0 });

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
        await startNativeLiveGraphSession({ positionSeconds: 0 });

        const result = await stopNativeLiveGraphSession({ positionSeconds: 8 });

        expect(result).toEqual({ outcome: 'stopped' });
        expect(appliedBatches().at(-1)?.commands).toEqual([
            { kind: 'set-transport', playing: false, positionSeconds: 8 },
        ]);
    });

    it('keeps the session when the engine refuses the stop, so a playing engine stays reachable', async () => {
        await startNativeLiveGraphSession({ positionSeconds: 0 });
        mocks.applyGraphCommands.mockResolvedValue({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'command-queue-full',
        });

        const result = await stopNativeLiveGraphSession({ positionSeconds: 8 });

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

        const start = startNativeLiveGraphSession({ positionSeconds: 0 });
        const stop = stopNativeLiveGraphSession({ positionSeconds: 4 });
        releaseStart();
        await start;
        const stopResult = await stop;

        expect(stopResult).toEqual({ outcome: 'stopped' });
        expect(appliedBatches().map((batch) => batch.commands.at(-1)?.kind)).toEqual([
            'set-transport',
            'set-transport',
        ]);
        expect(appliedBatches()[1]?.commands).toEqual([{ kind: 'set-transport', playing: false, positionSeconds: 4 }]);
    });
});
