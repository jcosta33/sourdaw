import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import * as subject from '../initWebMidi';

describe('initWebMidi', () => {
    beforeEach(() => {
        initializeWebMidiMock.mockClear();
        setMidiInputTrackMock.mockClear();
        routeYeastNoteOffsMock.mockClear();
        trackStoreSubscribeMock.mockReset();
        eventBusOnMock.mockReset();
        eventBusEmitMock.mockClear();
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
});
