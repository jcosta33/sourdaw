import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invokeWithBinaryBody, isDesktopRuntime, desktopInvoke, desktopListen } from '#/utils/desktopBridge';

import { pushHardwareTransport } from '../pushHardwareTransport';

vi.mock('#/utils/desktopBridge', () => ({
    invokeWithBinaryBody: vi.fn(),
    isDesktopRuntime: vi.fn(),
    desktopInvoke: vi.fn(),
    desktopListen: vi.fn(),
}));

const IDENTITY_REPLY = [
    0xf0, 0x7e, 0x01, 0x06, 0x02, 0x00, 0x21, 0x1d, 0x67, 0x32, 0x02, 0x00, 0x01, 0x00, 0x2f, 0x00, 0x73, 0x4d, 0x1f,
    0x08, 0x00, 0x01, 0xf7,
] as const;
const MODE_REPLY = [0xf0, 0x00, 0x21, 0x1d, 0x01, 0x01, 0x0a, 0x00, 0xf7] as const;

describe('pushHardwareTransport', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
        vi.mocked(desktopListen).mockImplementation(() => Promise.resolve(() => undefined));
        vi.mocked(invokeWithBinaryBody).mockResolvedValue();
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        await pushHardwareTransport.disconnect();
        vi.clearAllMocks();
    });

    it('opens Push 2, completes identity and Live-mode handshakes, and writes the initial display frame', async () => {
        let receiveMidi: ((event: unknown) => void) | undefined;
        vi.mocked(desktopListen).mockImplementation((event, handler) => {
            if (event === 'push-midi-message') {
                receiveMidi = handler;
            }
            return Promise.resolve(() => undefined);
        });
        vi.mocked(invokeWithBinaryBody).mockImplementation((input) => {
            if (input.command === 'send_push_midi') {
                const bytes = [...input.bytes];
                if (Array.isArray(bytes) && bytes[1] === 0x7e) {
                    queueMicrotask(() => receiveMidi?.({ payload: { data: [...IDENTITY_REPLY] } }));
                } else {
                    queueMicrotask(() => receiveMidi?.({ payload: { data: [...MODE_REPLY] } }));
                }
            }
            return Promise.resolve();
        });

        await pushHardwareTransport.connect({ model: 'push2', onMidiEvent: vi.fn(), onDisconnect: vi.fn() });

        expect(invokeWithBinaryBody).toHaveBeenCalledWith(
            expect.objectContaining({
                command: 'send_push_midi',
                bytes: new Uint8Array([0xf0, 0x7e, 0x01, 0x06, 0x01, 0xf7]),
                maxBytes: 23,
            })
        );
        expect(invokeWithBinaryBody).toHaveBeenCalledWith(
            expect.objectContaining({ command: 'write_push2_display', maxBytes: 327_680 })
        );
    });

    it('routes Push 3 pad input and releases native/listener state on disconnect', async () => {
        const onMidiEvent = vi.fn();
        let receiveMidi: ((event: unknown) => void) | undefined;
        vi.mocked(desktopListen).mockImplementation((event, handler) => {
            if (event === 'push-midi-message') {
                receiveMidi = handler;
            }
            return Promise.resolve(vi.fn());
        });
        await pushHardwareTransport.connect({ model: 'push3', onMidiEvent, onDisconnect: vi.fn() });
        receiveMidi?.({ payload: { data: [0x90, 36, 100] } });
        vi.mocked(desktopInvoke).mockRejectedValueOnce(new Error('close failed'));
        await expect(pushHardwareTransport.disconnect()).rejects.toThrow('close failed');
        vi.mocked(desktopInvoke).mockResolvedValue(undefined);
        await pushHardwareTransport.connect({ model: 'push3', onMidiEvent, onDisconnect: vi.fn() });

        expect(onMidiEvent).toHaveBeenCalledWith({ kind: 'pad', note: 36, edge: 'pressed', velocity: 100 });
    });

    it('bounds a hung handshake send and still closes native state without a local session', async () => {
        vi.useFakeTimers();
        let receiveMidi: ((event: unknown) => void) | undefined;
        vi.mocked(desktopListen)
            .mockImplementationOnce((_event, handler) => {
                receiveMidi = handler;
                return Promise.resolve(() => undefined);
            })
            .mockResolvedValue(() => undefined);
        vi.mocked(invokeWithBinaryBody).mockImplementation(() => {
            queueMicrotask(() => receiveMidi?.({ payload: { data: IDENTITY_REPLY } }));
            return new Promise(() => undefined);
        });

        const connection = pushHardwareTransport.connect({
            model: 'push2',
            onMidiEvent: vi.fn(),
            onDisconnect: vi.fn(),
        });
        const rejection = expect(connection).rejects.toThrow('reply timed out');
        await vi.advanceTimersByTimeAsync(2_000);
        await rejection;
        await pushHardwareTransport.disconnect();

        vi.useRealTimers();
    });
});
