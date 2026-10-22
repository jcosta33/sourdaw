import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    isTransportIdle: vi.fn(),
    resetCrdtProject: vi.fn(),
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({ resetCrdtProject: mocks.resetCrdtProject }));
vi.mock('#/modules/Transport/useCases', () => ({
    isTransportIdle: mocks.isTransportIdle,
    stopPlayback: mocks.stopPlayback,
}));

import { resetCrdtProjectWithTransportStopped } from '../resetCrdtProjectWithTransportStopped';

const replaced = { status: 'replaced', finalize: vi.fn() };

describe('resetCrdtProjectWithTransportStopped', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.stopPlayback.mockResolvedValue(undefined);
        mocks.resetCrdtProject.mockResolvedValue(replaced);
    });

    it('resets once, without stopping anything, when the transport is idle at the switch', async () => {
        const onReplaced = vi.fn();

        await expect(resetCrdtProjectWithTransportStopped('Song', onReplaced, () => true)).resolves.toBe(replaced);

        expect(mocks.resetCrdtProject).toHaveBeenCalledExactlyOnceWith('Song', onReplaced, mocks.isTransportIdle);
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
    });

    it('hands every attempt the transport check, so each one decides at its own switch', async () => {
        const onReplaced = vi.fn();
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await resetCrdtProjectWithTransportStopped('Song', onReplaced, () => true);

        expect(mocks.resetCrdtProject).toHaveBeenNthCalledWith(2, 'Song', onReplaced, mocks.isTransportIdle);
    });

    it('waits for each stop before it asks again and returns the first settled answer', async () => {
        const stop = Promise.withResolvers<void>();
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockReturnValueOnce(stop.promise);

        const reset = resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);
        await vi.waitFor(() => expect(mocks.stopPlayback).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
        stop.resolve();

        await expect(reset).resolves.toBe(replaced);
        expect(mocks.resetCrdtProject).toHaveBeenCalledTimes(2);
    });

    it('passes a refusal through untouched', async () => {
        const refused = { status: 'refused', reason: 'session-active' };
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' }).mockResolvedValueOnce(refused);

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(refused);
    });

    it('refuses as superseded, without asking again, when the caller no longer wants the replacement', async () => {
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => false)).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('rejects, without asking again, when the stop rejects', async () => {
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockRejectedValueOnce(new Error('recorder flush failed'));

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).rejects.toThrow(
            'recorder flush failed'
        );

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });
});
