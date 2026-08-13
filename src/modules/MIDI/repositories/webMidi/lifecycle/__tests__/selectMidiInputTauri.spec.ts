import { beforeEach, describe, expect, it, vi } from 'vitest';

const getTauriEventUnlistenMock = vi.hoisted(() => vi.fn<() => (() => void) | null>());
const setTauriEventUnlistenMock = vi.hoisted(() => vi.fn<(unlisten: (() => void) | null) => void>());
const tauriInvokeMock = vi.hoisted(() =>
    vi.fn<(command: string, args?: Record<string, unknown>) => Promise<unknown>>()
);
const tauriListenMock = vi.hoisted(() =>
    vi.fn<(event: string, handler: (event: unknown) => void) => Promise<() => void>>()
);

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: () => true,
    tauriInvoke: tauriInvokeMock,
    tauriListen: tauriListenMock,
}));

vi.mock('../../getTauriEventUnlisten', () => ({
    getTauriEventUnlisten: () => getTauriEventUnlistenMock(),
}));

vi.mock('../../setTauriEventUnlisten', () => ({
    setTauriEventUnlisten: (unlisten: (() => void) | null) => setTauriEventUnlistenMock(unlisten),
}));

import { selectMidiInputTauri } from '../selectMidiInputTauri';

describe('selectMidiInputTauri', () => {
    const newUnlisten = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        getTauriEventUnlistenMock.mockReturnValue(null);
        tauriInvokeMock.mockResolvedValue(undefined);
        tauriListenMock.mockResolvedValue(newUnlisten);
    });

    it('should close any previous Tauri listener before opening the selected MIDI input', async () => {
        const previousUnlisten = vi.fn();
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();
        getTauriEventUnlistenMock.mockReturnValue(previousUnlisten);

        await selectMidiInputTauri({ portIndex: 2, onMidiMessage: onMidiMessageMock });

        expect(previousUnlisten).toHaveBeenCalledTimes(1);
        expect(setTauriEventUnlistenMock).toHaveBeenNthCalledWith(1, null);
        expect(tauriInvokeMock).toHaveBeenCalledWith('open_midi_input', { portIndex: 2 });
        expect(tauriListenMock).toHaveBeenCalledWith('midi-message', expect.any(Function));
        expect(setTauriEventUnlistenMock).toHaveBeenNthCalledWith(2, newUnlisten);
    });

    it('should forward valid Tauri MIDI message bytes to the MIDI handler', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });

        const listener = tauriListenMock.mock.calls[0]![1];
        listener({ payload: { data: [144, 64, 127] } });

        expect(onMidiMessageMock).toHaveBeenCalledTimes(1);
        expect(onMidiMessageMock.mock.calls[0]![0].data).toEqual(new Uint8Array([144, 64, 127]));
    });

    it('should not forward malformed Tauri MIDI message payloads', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });

        const listener = tauriListenMock.mock.calls[0]![1];
        listener({});
        listener({ payload: {} });
        listener({ payload: { data: '144,64,127' } });
        listener({ payload: { data: [144] } });
        listener({ payload: { data: [144, 64, 127, 1] } });
        listener({ payload: { data: [144, -1] } });
        listener({ payload: { data: [144, 256] } });
        listener({ payload: { data: [144, 64.5] } });

        expect(onMidiMessageMock).not.toHaveBeenCalled();
    });

    it('should register a new native listener callback after unlistening the previous one', async () => {
        const previousUnlisten = vi.fn();
        const firstCallback = vi.fn<(event: MIDIMessageEvent) => void>();
        const secondCallback = vi.fn<(event: MIDIMessageEvent) => void>();
        getTauriEventUnlistenMock.mockReturnValueOnce(null).mockReturnValueOnce(previousUnlisten);

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: firstCallback });
        await selectMidiInputTauri({ portIndex: 2, onMidiMessage: secondCallback });

        expect(previousUnlisten).toHaveBeenCalledTimes(1);
        const firstListener = tauriListenMock.mock.calls[0]![1];
        const secondListener = tauriListenMock.mock.calls[1]![1];

        firstListener({ payload: { data: [144, 60, 127] } });
        secondListener({ payload: { data: [144, 61, 127] } });

        expect(firstCallback).toHaveBeenCalledTimes(1);
        expect(secondCallback).toHaveBeenCalledTimes(1);
        expect(firstCallback.mock.calls[0]![0].data).toEqual(new Uint8Array([144, 60, 127]));
        expect(secondCallback.mock.calls[0]![0].data).toEqual(new Uint8Array([144, 61, 127]));
    });

    // midir stamps every message in microseconds since a platform-defined
    // origin that has nothing to do with `performance.now()`. Forwarding it raw
    // would imply a wait of hours and `resolveInputEventTime` would refuse it,
    // fall back to "now", and hand back exactly the jitter it exists to remove.
    // So the bytes are not the only thing that has to survive the trip.
    it('maps the native timestamp onto our clock so a delayed message keeps its arrival instant', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();
        const nowSpy = vi.spyOn(performance, 'now');

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });
        const listener = tauriListenMock.mock.calls[0]![1];

        // First message establishes the offset between the two clocks.
        nowSpy.mockReturnValue(5000);
        listener({ payload: { data: [144, 60, 127], timestamp: 1_000_000 } });

        // Second message was played 20ms after the first on the device clock,
        // but the handler only got a turn 100ms later — 80ms of event-loop delay.
        nowSpy.mockReturnValue(5100);
        listener({ payload: { data: [144, 62, 127], timestamp: 1_020_000 } });

        // It must resolve to when it was played, not when we got round to it.
        expect(onMidiMessageMock.mock.calls[1]![0].timeStamp).toBe(5020);
    });

    it('keeps the mapped stamp inside the window resolveInputEventTime will accept', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();
        const nowSpy = vi.spyOn(performance, 'now');

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });
        const listener = tauriListenMock.mock.calls[0]![1];

        // A CoreMIDI stamp is host-uptime microseconds: hours ahead of our
        // origin. Unmapped, `performance.now() - timeStamp` is hugely negative
        // and the guard drops it.
        nowSpy.mockReturnValue(5000);
        listener({ payload: { data: [144, 60, 127], timestamp: 9_000_000_000 } });
        nowSpy.mockReturnValue(5050);
        listener({ payload: { data: [144, 62, 127], timestamp: 9_000_030_000 } });

        const mapped = onMidiMessageMock.mock.calls[1]![0].timeStamp;
        const waitedSeconds = (5050 - mapped) / 1000;
        expect(waitedSeconds).toBeGreaterThan(0);
        expect(waitedSeconds).toBeLessThanOrEqual(1);
    });

    it('re-anchors on a port reopen, because the native epoch can restart with the port', async () => {
        const firstCallback = vi.fn<(event: MIDIMessageEvent) => void>();
        const secondCallback = vi.fn<(event: MIDIMessageEvent) => void>();
        const nowSpy = vi.spyOn(performance, 'now');

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: firstCallback });
        nowSpy.mockReturnValue(5000);
        tauriListenMock.mock.calls[0]![1]({ payload: { data: [144, 60, 127], timestamp: 8_000_000 } });

        // Reopening resets the offset. A port whose clock restarts at zero must
        // not be read through the previous port's anchor.
        await selectMidiInputTauri({ portIndex: 2, onMidiMessage: secondCallback });
        nowSpy.mockReturnValue(9000);
        tauriListenMock.mock.calls[1]![1]({ payload: { data: [144, 62, 127], timestamp: 0 } });

        expect(secondCallback.mock.calls[0]![0].timeStamp).toBe(9000);
    });

    it('leaves timeStamp undefined when the payload carries no native stamp', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });
        tauriListenMock.mock.calls[0]![1]({ payload: { data: [144, 60, 127] } });

        expect(onMidiMessageMock.mock.calls[0]![0].timeStamp).toBeUndefined();
    });

    it('forwards valid bytes without an untrusted native timestamp', async () => {
        const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

        await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });
        const listener = tauriListenMock.mock.calls[0]![1];
        listener({ payload: { data: [144, 60, 127], timestamp: Number.POSITIVE_INFINITY } });

        expect(onMidiMessageMock).toHaveBeenCalledTimes(1);
        expect(onMidiMessageMock.mock.calls[0]![0].timeStamp).toBeUndefined();
    });

    describe('overlapping selections', () => {
        /**
         * The unlisten registry is read at call start and written three awaits
         * later. Two selections in flight at once must not have the earlier one
         * finish last and overwrite the newer registration — that leaves both
         * listeners subscribed to the single `midi-message` channel while the
         * registry can only ever cancel one of them.
         */
        it('does not let a superseded selection register a listener at all', async () => {
            const winningUnlisten = vi.fn();
            const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

            // Hold the first select inside `open_midi_input` while the second
            // one runs to completion, then release it.
            let releaseFirstOpen: (() => void) | undefined;
            tauriInvokeMock.mockImplementationOnce(
                async () =>
                    new Promise<void>((resolve) => {
                        releaseFirstOpen = resolve;
                    })
            );
            tauriListenMock.mockResolvedValue(winningUnlisten);

            const first = selectMidiInputTauri({ portIndex: 0, onMidiMessage: onMidiMessageMock });
            await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });

            expect(tauriListenMock).toHaveBeenCalledTimes(1);
            expect(setTauriEventUnlistenMock).toHaveBeenLastCalledWith(winningUnlisten);

            releaseFirstOpen?.();
            await first;

            // The superseded call must not subscribe a second listener to the
            // single `midi-message` channel, nor touch the registry again.
            expect(tauriListenMock).toHaveBeenCalledTimes(1);
            expect(setTauriEventUnlistenMock).toHaveBeenLastCalledWith(winningUnlisten);
        });

        it('cancels its own listener when a newer selection wins during subscribe', async () => {
            const lateUnlisten = vi.fn();
            const onMidiMessageMock = vi.fn<(event: MIDIMessageEvent) => void>();

            // A second selection lands and completes while the first is still
            // inside `tauriListen` — the late-subscribe window.
            tauriListenMock.mockImplementationOnce(async () => {
                await selectMidiInputTauri({ portIndex: 1, onMidiMessage: onMidiMessageMock });
                return lateUnlisten;
            });

            await selectMidiInputTauri({ portIndex: 0, onMidiMessage: onMidiMessageMock });

            // Its own registration is torn down rather than left dangling on
            // the shared channel, where it would double every note.
            expect(lateUnlisten).toHaveBeenCalledTimes(1);
        });
    });
});
