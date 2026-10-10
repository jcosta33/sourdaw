import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type InstrumentSnapshot = Readonly<{
    id: string;
    devices: readonly Readonly<{ id: string; type: string }>[];
}>;

type RouteYeastNoteOffs = (
    instrumentTrack: InstrumentSnapshot | null,
    noteOffs: readonly { channel: number; note: number }[],
    options: { emitGrandBouleEvent: (deviceId: string, midiNote: number) => void }
) => void;

type ReleaseHeldYeastVoices = (instrumentTrackId: string, channel: number, pitch: number, sampleFrame?: number) => void;

type ReleaseCapturedYeastVoices = (
    instrumentTrackId: string,
    channel: number,
    pitch: number,
    sampleFrame?: number
) => void;

type LifecycleNoteOff = {
    channel: number;
    note: number;
    noteInstanceId?: string;
    sampleFrame?: number;
};

type ReleaseCapturedYeastLifecycleVoices = (
    trackId: string,
    noteOffs: readonly LifecycleNoteOff[]
) => LifecycleNoteOff[];

const initializeWebMidiMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const setMidiInputTrackMock = vi.hoisted(() => vi.fn());
const getMidiInputTrackOwnerIdMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const routeYeastNoteOffsMock = vi.hoisted(() => vi.fn<RouteYeastNoteOffs>());
// Default passthrough: every identityless off reaches the current-node route,
// matching the pre-#4873 consumer for payloads without captured owners.
const releaseCapturedMock = vi.hoisted(() =>
    vi.fn<ReleaseCapturedYeastLifecycleVoices>((_trackId, noteOffs) => [...noteOffs])
);
// The real registry-backed lifecycle release, captured by the mock factory
// below so the handler-level guard case can drive actual registry populations.
const actualLifecycleModule = vi.hoisted(() => ({
    releaseCapturedYeastLifecycleVoices: null as ReleaseCapturedYeastLifecycleVoices | null,
}));
const releaseHeldYeastVoicesMock = vi.hoisted(() => vi.fn<ReleaseHeldYeastVoices>());
const releaseCapturedYeastVoicesMock = vi.hoisted(() => vi.fn<ReleaseCapturedYeastVoices>());
// The real coarse registry sweep, captured by the mock factory below so the
// handler-level guard case can run the production path against the registry.
const actualCoarseModule = vi.hoisted(() => ({
    releaseCapturedYeastVoices: null as ReleaseCapturedYeastVoices | null,
}));
const trackStoreSubscribeMock = vi.hoisted(() => vi.fn());
const eventBusOnMock = vi.hoisted(() => vi.fn());
const eventBusEmitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const arrangementTrack = vi.hoisted(() => ({
    id: 'track-a',
    kind: 'midi',
    devices: [{ id: 'fermenter-a', type: 'fermenter', parameterValues: { gain: 0.5 } }],
}));

vi.mock('#/infra/di/Container', () => ({
    Container: {
        get: vi.fn(() => ({
            on: eventBusOnMock,
            emit: eventBusEmitMock,
        })),
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    getTrackEligibility: vi.fn(),
    readMusicalRangeInputs: vi.fn(() => []),
    clipHasActiveGainEnvelope: vi.fn(),
    getGainEnvelopeSeries: vi.fn(),
    readMusicalRange: vi.fn(),
    gainEnvelopeStore: { value: { envelopes: {} }, subscribe: vi.fn() },
    setWarpState: vi.fn(),
    getStoredWarpState: vi.fn(),
    warpStateStore: { value: { states: {} }, subscribe: vi.fn() },
    trackStore: {
        subscribe: trackStoreSubscribeMock,
        value: {
            tracks: [arrangementTrack],
            selectedTrackId: null,
        },
    },
    // A barrel factory replaces the whole module, so every member anything in
    // this spec's graph imports has to be present here — Automation's range
    // handlers reach both of these, and neither is exercised by these cases.
    markerStore: { value: null, subscribe: vi.fn() },
    resolveEligibleDeviceWriteTarget: vi.fn(() => null),
}));

vi.mock('../../../repositories/webMidi/lifecycle/initWebMidi', () => ({
    initWebMidi: initializeWebMidiMock,
}));

vi.mock('../../../repositories/webMidi/releaseCapturedYeastVoices', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../repositories/webMidi/releaseCapturedYeastVoices')>();
    actualCoarseModule.releaseCapturedYeastVoices = actual.releaseCapturedYeastVoices;
    return {
        releaseCapturedYeastVoices: releaseCapturedYeastVoicesMock,
    };
});

vi.mock('../../../repositories/webMidi/releaseHeldYeastVoices', () => ({
    releaseHeldYeastVoices: releaseHeldYeastVoicesMock,
}));

vi.mock('../../../repositories/webMidi/routeYeastNoteOff', () => ({
    routeYeastNoteOffsForTargetTrack: routeYeastNoteOffsMock,
}));

vi.mock('../../../repositories/webMidi/routeYeastLifecycleNoteOff', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../../repositories/webMidi/routeYeastLifecycleNoteOff')>();
    actualLifecycleModule.releaseCapturedYeastLifecycleVoices = actual.releaseCapturedYeastLifecycleVoices;
    return {
        releaseCapturedYeastLifecycleVoices: releaseCapturedMock,
    };
});

vi.mock('../setMidiInputTrack', () => ({
    setMidiInputTrack: setMidiInputTrackMock,
}));

vi.mock('../getMidiInputTrackOwnerId', () => ({
    getMidiInputTrackOwnerId: getMidiInputTrackOwnerIdMock,
}));

import { pendingYeastRelease } from '../../../repositories/webMidi/pendingYeastRelease';
import { disposeWebMidiSubscriptions } from '../disposeWebMidiSubscriptions';
import * as subject from '../initWebMidi';

describe('initWebMidi', () => {
    beforeEach(() => {
        disposeWebMidiSubscriptions();
        initializeWebMidiMock.mockClear();
        setMidiInputTrackMock.mockClear();
        getMidiInputTrackOwnerIdMock.mockReset();
        getMidiInputTrackOwnerIdMock.mockReturnValue(null);
        routeYeastNoteOffsMock.mockClear();
        releaseCapturedMock.mockClear();
        releaseCapturedMock.mockImplementation((_trackId, noteOffs) => [...noteOffs]);
        releaseHeldYeastVoicesMock.mockClear();
        releaseCapturedYeastVoicesMock.mockReset();
        trackStoreSubscribeMock.mockReset();
        eventBusOnMock.mockReset();
        eventBusEmitMock.mockClear();
    });

    afterEach(() => {
        disposeWebMidiSubscriptions();
    });

    it('owns idempotent track and Yeast subscriptions around repository initialization', async () => {
        let trackSubscription: ((state: unknown) => void) | undefined;
        let yeastNotesOffSubscription: ((payload: unknown) => void) | undefined;
        trackStoreSubscribeMock.mockImplementation((callback: (state: unknown) => void) => {
            trackSubscription = callback;
            return () => {};
        });
        eventBusOnMock.mockImplementation((_event: string, handler: (payload: unknown) => void) => {
            yeastNotesOffSubscription = handler;
            return () => {};
        });

        await subject.initWebMidi();
        await subject.initWebMidi();

        expect(initializeWebMidiMock).toHaveBeenCalledTimes(2);
        expect(trackStoreSubscribeMock).toHaveBeenCalledTimes(1);
        expect(eventBusOnMock).toHaveBeenCalledTimes(1);

        trackSubscription?.({
            selectedTrackId: 'track-a',
            tracks: [{ id: 'track-a', kind: 'midi', devices: [] }],
        });
        expect(setMidiInputTrackMock).toHaveBeenCalledWith('track-a');

        trackSubscription?.({ selectedTrackId: null, tracks: [] });
        expect(setMidiInputTrackMock).toHaveBeenCalledWith(null);

        // Each forced off ends, at once, the held keys' captured voices of the
        // rack's track at that channel and pitch; the registry voices the offs
        // name resolve through the lifecycle path above it.
        yeastNotesOffSubscription?.({
            trackId: 'track-a',
            noteOffs: [
                { channel: 0, note: 60 },
                { channel: 2, note: 64 },
            ],
        });
        expect(releaseHeldYeastVoicesMock.mock.calls).toEqual([
            ['track-a', 0, 60],
            ['track-a', 2, 64],
        ]);
    });

    it('routes a fully captured lifecycle batch without touching the current-node route (#4873)', async () => {
        eventBusOnMock.mockImplementation(() => () => {});
        await subject.initWebMidi();

        const handler = eventBusOnMock.mock.calls.find(([event]) => event === 'yeast.notesOff')?.[1] as (payload: {
            trackId: string;
            noteOffs: LifecycleNoteOff[];
        }) => void;
        releaseCapturedMock.mockReturnValue([]);

        handler({ trackId: 'track-a', noteOffs: [{ channel: 0, note: 60, noteInstanceId: 'voice-a' }] });

        expect(releaseCapturedMock).toHaveBeenCalledWith('track-a', [
            { channel: 0, note: 60, noteInstanceId: 'voice-a' },
        ]);
        expect(routeYeastNoteOffsMock).not.toHaveBeenCalled();
    });

    it('routes only the leftover identityless offs to the current-node compat route (#4873)', async () => {
        eventBusOnMock.mockImplementation(() => () => {});
        await subject.initWebMidi();

        const handler = eventBusOnMock.mock.calls.find(([event]) => event === 'yeast.notesOff')?.[1] as (payload: {
            trackId: string;
            noteOffs: LifecycleNoteOff[];
        }) => void;
        const leftover: LifecycleNoteOff = { channel: 0, note: 64 };
        releaseCapturedMock.mockReturnValue([leftover]);

        handler({
            trackId: 'track-a',
            noteOffs: [{ channel: 0, note: 60, noteInstanceId: 'voice-a' }, leftover],
        });

        expect(routeYeastNoteOffsMock).toHaveBeenCalledTimes(1);
        expect(routeYeastNoteOffsMock.mock.calls[0]?.[1]).toEqual([leftover]);
    });

    it('releases only the retired voice through the real handler path, never a same-pitch successor on the replacement (#4873)', async () => {
        eventBusOnMock.mockImplementation(() => () => {});
        await subject.initWebMidi();

        const realLifecycleRelease = actualLifecycleModule.releaseCapturedYeastLifecycleVoices;
        if (!realLifecycleRelease) {
            throw new Error('the routeYeastLifecycleNoteOff mock factory did not capture the actual implementation');
        }
        // The handler's lifecycle release resolves against the real registry
        // here. A coarse pitch-keyed sweep beside it — releasing every captured
        // voice at each off's track, channel, and pitch — would strike the
        // successor below; only the instance-keyed path may touch the registry.
        releaseCapturedMock.mockImplementation((trackId, noteOffs) => realLifecycleRelease(trackId, noteOffs));

        const realCoarseRelease = actualCoarseModule.releaseCapturedYeastVoices;
        if (!realCoarseRelease) {
            throw new Error('the releaseCapturedYeastVoices mock factory did not capture the actual implementation');
        }
        // The coarse module release runs against the real registry here too:
        // main's pre-#4873 handler carried it beside the held sweep, and its
        // pitch-keyed registry release is what a re-add would fire.
        releaseCapturedYeastVoicesMock.mockImplementation((trackId, channel, pitch, sampleFrame) =>
            realCoarseRelease(trackId, channel, pitch, sampleFrame)
        );

        // The registry is module state; start from an empty one.
        pendingYeastRelease.releaseAllPending();

        const originalRelease = vi.fn();
        const successorRelease = vi.fn();
        pendingYeastRelease.registerVoice('track-a:yeast-original', 'track-a', 'voice-old', 60, 0, originalRelease);
        // The replacement instrument started its own same-pitch voice on the
        // same track after the swap (#4873).
        pendingYeastRelease.registerVoice('track-a:yeast-replacement', 'track-a', 'voice-new', 60, 0, successorRelease);

        const handler = eventBusOnMock.mock.calls.find(([event]) => event === 'yeast.notesOff')?.[1] as (payload: {
            trackId: string;
            noteOffs: LifecycleNoteOff[];
        }) => void;
        handler({
            trackId: 'track-a',
            noteOffs: [{ channel: 0, note: 60, noteInstanceId: 'voice-old', sampleFrame: 512 }],
        });

        // The off retires the voice it names through its captured owner.
        expect(originalRelease).toHaveBeenCalledExactlyOnceWith(512, 0);
        // The successor at the same track, channel, and pitch stays sounding.
        expect(successorRelease).not.toHaveBeenCalled();
        // The handler's per-pitch sweep is the narrower held-key release only:
        // the coarse module release must never be part of the notesOff path.
        expect(releaseCapturedYeastVoicesMock).not.toHaveBeenCalled();
        // A fully captured batch never reaches the current-node route.
        expect(routeYeastNoteOffsMock).not.toHaveBeenCalled();
    });

    it('drops the live input target when the selection moves to a non-MIDI track', async () => {
        let trackSubscription: ((state: unknown) => void) | undefined;
        trackStoreSubscribeMock.mockImplementation((callback: (state: unknown) => void) => {
            trackSubscription = callback;
            return () => {};
        });
        eventBusOnMock.mockImplementation(() => () => {});

        await subject.initWebMidi();

        const tracks = [
            { id: 'track-midi', kind: 'midi', devices: [] },
            { id: 'track-audio', kind: 'audio', devices: [] },
        ];
        trackSubscription?.({ selectedTrackId: 'track-midi', tracks });
        expect(setMidiInputTrackMock).toHaveBeenLastCalledWith('track-midi');

        // Selecting an audio track used to fall off the end of the handler,
        // leaving the controller playing — and recording into — a MIDI track
        // the user can no longer see selected.
        trackSubscription?.({ selectedTrackId: 'track-audio', tracks });
        expect(setMidiInputTrackMock).toHaveBeenLastCalledWith(null);
    });

    it('leaves an armed track receiving when the selection moves to a non-MIDI track', async () => {
        // `armTrack` claims the route with an owner id. Record-arm outranks
        // selection in every DAW that ships this, and clearing the route here
        // would kill the controller the moment the user clicked an audio
        // track's fader mid-take.
        let trackSubscription: ((state: unknown) => void) | undefined;
        trackStoreSubscribeMock.mockImplementation((callback: (state: unknown) => void) => {
            trackSubscription = callback;
            return () => {};
        });
        eventBusOnMock.mockImplementation(() => () => {});

        await subject.initWebMidi();

        const tracks = [
            { id: 'track-midi', kind: 'midi', devices: [] },
            { id: 'track-audio', kind: 'audio', devices: [] },
        ];
        trackSubscription?.({ selectedTrackId: 'track-midi', tracks });
        setMidiInputTrackMock.mockClear();
        getMidiInputTrackOwnerIdMock.mockReturnValue('arm-track-midi');

        trackSubscription?.({ selectedTrackId: 'track-audio', tracks });
        expect(setMidiInputTrackMock).not.toHaveBeenCalled();
    });

    it('drops the live input target when the selected id is not in the store', async () => {
        let trackSubscription: ((state: unknown) => void) | undefined;
        trackStoreSubscribeMock.mockImplementation((callback: (state: unknown) => void) => {
            trackSubscription = callback;
            return () => {};
        });
        eventBusOnMock.mockImplementation(() => () => {});

        await subject.initWebMidi();

        trackSubscription?.({
            selectedTrackId: 'track-midi',
            tracks: [{ id: 'track-midi', kind: 'midi', devices: [] }],
        });
        expect(setMidiInputTrackMock).toHaveBeenLastCalledWith('track-midi');

        trackSubscription?.({ selectedTrackId: 'track-gone', tracks: [] });
        expect(setMidiInputTrackMock).toHaveBeenLastCalledWith(null);
    });

    it('disposes stale handlers before reinitializing subscriptions', async () => {
        const activeTrackSubscriptions = new Set<(state: unknown) => void>();
        const activeYeastSubscriptions = new Set<(payload: unknown) => void>();
        const trackDisposers: Array<ReturnType<typeof vi.fn>> = [];
        const yeastDisposers: Array<ReturnType<typeof vi.fn>> = [];

        trackStoreSubscribeMock.mockImplementation((callback: (state: unknown) => void) => {
            activeTrackSubscriptions.add(callback);
            const dispose = vi.fn(() => activeTrackSubscriptions.delete(callback));
            trackDisposers.push(dispose);
            return dispose;
        });
        eventBusOnMock.mockImplementation((_event: string, handler: (payload: unknown) => void) => {
            activeYeastSubscriptions.add(handler);
            const dispose = vi.fn(() => activeYeastSubscriptions.delete(handler));
            yeastDisposers.push(dispose);
            return dispose;
        });

        await subject.initWebMidi();
        disposeWebMidiSubscriptions();
        disposeWebMidiSubscriptions();
        await subject.initWebMidi();

        expect(trackDisposers[0]).toHaveBeenCalledTimes(1);
        expect(yeastDisposers[0]).toHaveBeenCalledTimes(1);
        expect(trackStoreSubscribeMock).toHaveBeenCalledTimes(2);
        expect(eventBusOnMock).toHaveBeenCalledTimes(2);
        expect(activeTrackSubscriptions.size).toBe(1);
        expect(activeYeastSubscriptions.size).toBe(1);

        for (const subscription of activeTrackSubscriptions) {
            subscription({
                selectedTrackId: 'track-a',
                tracks: [{ id: 'track-a', kind: 'midi', devices: [] }],
            });
        }
        for (const subscription of activeYeastSubscriptions) {
            subscription({
                trackId: 'track-a',
                noteOffs: [{ channel: 0, note: 60 }],
            });
        }

        expect(setMidiInputTrackMock).toHaveBeenCalledTimes(1);
        expect(releaseHeldYeastVoicesMock).toHaveBeenCalledTimes(1);
    });
});
