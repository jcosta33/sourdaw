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

const initializeWebMidiMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const setMidiInputTrackMock = vi.hoisted(() => vi.fn());
const getMidiInputTrackOwnerIdMock = vi.hoisted(() => vi.fn<() => string | null>(() => null));
const routeYeastNoteOffsMock = vi.hoisted(() => vi.fn<RouteYeastNoteOffs>());
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
    trackStore: {
        subscribe: trackStoreSubscribeMock,
        value: {
            tracks: [arrangementTrack],
            selectedTrackId: null,
        },
    },
}));

vi.mock('../../../repositories/webMidi/lifecycle/initWebMidi', () => ({
    initWebMidi: initializeWebMidiMock,
}));

vi.mock('../../../repositories/webMidi/routeYeastNoteOff', () => ({
    routeYeastNoteOffsForTargetTrack: routeYeastNoteOffsMock,
}));

vi.mock('../setMidiInputTrack', () => ({
    setMidiInputTrack: setMidiInputTrackMock,
}));

vi.mock('../getMidiInputTrackOwnerId', () => ({
    getMidiInputTrackOwnerId: getMidiInputTrackOwnerIdMock,
}));

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

        yeastNotesOffSubscription?.({
            trackId: 'track-a',
            noteOffs: [{ channel: 0, note: 60 }],
        });
        expect(routeYeastNoteOffsMock).toHaveBeenCalledWith(
            {
                id: 'track-a',
                devices: [{ id: 'fermenter-a', type: 'fermenter' }],
            },
            [{ channel: 0, note: 60 }],
            expect.any(Object)
        );
        const instrumentSnapshot = routeYeastNoteOffsMock.mock.calls[0]?.[0];
        expect(instrumentSnapshot).not.toBe(arrangementTrack);
        expect(instrumentSnapshot?.devices).not.toBe(arrangementTrack.devices);

        const routeInput = routeYeastNoteOffsMock.mock.calls[0]?.[2] as {
            emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
        };
        routeInput.emitGrandBouleEvent('device-a', 60);
        expect(eventBusEmitMock).toHaveBeenCalledWith('midi.noteOff', { deviceId: 'device-a', midiNote: 60 });
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
        expect(routeYeastNoteOffsMock).toHaveBeenCalledTimes(1);
    });
});
