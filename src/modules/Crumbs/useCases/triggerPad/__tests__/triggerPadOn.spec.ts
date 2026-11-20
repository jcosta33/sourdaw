import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    pads: { value: { inst1: { pads: [{ midiNote: 60 }] } } },
    on: vi.fn(),
    off: vi.fn(),
    start: vi.fn(),
    controls: true,
    warn: vi.fn(),
}));
vi.mock('../../../stores/padStore', () => ({ padStore: mocks.pads }));
vi.mock('../../../repositories/crumbsBridge/crumbsNoteOn', () => ({ crumbsNoteOn: mocks.on }));
vi.mock('../../../repositories/crumbsBridge/crumbsNoteOff', () => ({ crumbsNoteOff: mocks.off }));
vi.mock('../resolveCrumbsPadControls', () => ({
    resolveCrumbsPadControls: () => (mocks.controls ? { startPadAudition: mocks.start } : null),
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: mocks.warn } }));
import { triggerPadOn } from '../triggerPadOn';

describe('triggerPadOn', () => {
    it('releases the acquired carriers once even when native receipt arrives later', async () => {
        let resolveReceipt!: (id: number) => void;
        mocks.on.mockReturnValueOnce(
            new Promise<number>((resolve) => {
                resolveReceipt = resolve;
            })
        );
        mocks.off.mockResolvedValueOnce(undefined);
        const stop = vi.fn();
        mocks.start.mockReturnValueOnce(stop);
        const release = triggerPadOn('inst1', 0, 500)!;
        expect(mocks.start).toHaveBeenCalledWith(60, 127);
        expect(mocks.on).toHaveBeenCalledWith('inst1', 60, 127);
        release();
        release();
        expect(stop).toHaveBeenCalledOnce();
        expect(mocks.off).not.toHaveBeenCalled();
        resolveReceipt(42);
        await vi.waitFor(() => expect(mocks.off).toHaveBeenCalledExactlyOnceWith('inst1', 42));
    });
    it.each([
        [200, 127],
        [-5, 0],
        [63.7, 64],
        [Number.NaN, 0],
    ])('clamps velocity %s to %s', (input, expected) => {
        mocks.on.mockResolvedValueOnce(undefined);
        triggerPadOn('inst1', 0, input);
        expect(mocks.on).toHaveBeenLastCalledWith('inst1', 60, expected);
        expect(mocks.start).toHaveBeenLastCalledWith(60, expected);
    });
    it('ignores missing instance or pad and starts native without a ready worklet', () => {
        mocks.on.mockClear();
        expect(triggerPadOn('missing', 0)).toBeUndefined();
        expect(triggerPadOn('inst1', 99)).toBeUndefined();
        expect(mocks.on).not.toHaveBeenCalled();
        mocks.controls = false;
        mocks.on.mockResolvedValueOnce(undefined);
        expect(triggerPadOn('inst1', 0)).toBeTypeOf('function');
        expect(mocks.on).toHaveBeenCalledWith('inst1', 60, 100);
        mocks.controls = true;
    });
    it('logs native acquisition refusal and never releases a guessed receipt', async () => {
        mocks.off.mockClear();
        const error = new Error('native unavailable');
        mocks.on.mockRejectedValueOnce(error);
        const stop = vi.fn();
        mocks.start.mockReturnValueOnce(stop);
        const release = triggerPadOn('inst1', 0)!;
        release();
        await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalledWith('Note trigger failed:', error));
        expect(stop).toHaveBeenCalledOnce();
        expect(mocks.off).not.toHaveBeenCalled();
    });

    it('does not send a native release when acquisition has no receipt', async () => {
        mocks.off.mockClear();
        mocks.on.mockResolvedValueOnce(undefined).mockResolvedValueOnce(55);
        const releaseWithoutReceipt = triggerPadOn('inst1', 0)!;
        const releaseWithReceipt = triggerPadOn('inst1', 0)!;

        releaseWithoutReceipt();
        releaseWithReceipt();

        await vi.waitFor(() => expect(mocks.off).toHaveBeenCalledExactlyOnceWith('inst1', 55));
    });

    it('logs a native release rejection', async () => {
        const error = new Error('release unavailable');
        mocks.on.mockResolvedValueOnce(55);
        mocks.off.mockRejectedValueOnce(error);
        triggerPadOn('inst1', 0)!();
        await vi.waitFor(() => expect(mocks.warn).toHaveBeenCalledWith('Note release failed:', error));
        expect(mocks.off).toHaveBeenCalledWith('inst1', 55);
    });
});
