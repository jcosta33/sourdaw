import { beforeEach, describe, expect, it, vi } from 'vitest';

const initializeWebMidiMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const setMidiInputTrackMock = vi.hoisted(() => vi.fn());
const routeYeastNoteOffsMock = vi.hoisted(() => vi.fn());
const trackStoreSubscribeMock = vi.hoisted(() => vi.fn());
const eventBusOnMock = vi.hoisted(() => vi.fn());
const eventBusEmitMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

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
            tracks: [{ id: 'track-a', kind: 'midi', devices: [] }],
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
            expect.objectContaining({ id: 'track-a' }),
            [{ channel: 0, note: 60 }],
            expect.any(Object)
        );

        const routeInput = routeYeastNoteOffsMock.mock.calls[0]?.[2] as {
            emitGrandBouleEvent: (deviceId: string, midiNote: number) => void;
        };
        routeInput.emitGrandBouleEvent('device-a', 60);
        expect(eventBusEmitMock).toHaveBeenCalledWith('midi.noteOff', { deviceId: 'device-a', midiNote: 60 });
    });
});
