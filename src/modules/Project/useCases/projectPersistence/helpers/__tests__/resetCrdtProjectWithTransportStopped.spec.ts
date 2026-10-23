import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    events: [] as string[],
    isTransportIdle: vi.fn(),
    notifyUser: vi.fn(),
    resetAudioGraph: vi.fn(),
    resetCrdtProject: vi.fn(),
    saveProject: vi.fn(),
    stopPlayback: vi.fn(),
    unloadPlugin: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: mocks.resetAudioGraph }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ resetCrdtProject: mocks.resetCrdtProject }));
vi.mock('#/modules/PluginHost/useCases', () => ({ unloadPlugin: mocks.unloadPlugin }));
vi.mock('#/modules/Transport/useCases', () => ({
    isTransportIdle: mocks.isTransportIdle,
    stopPlayback: mocks.stopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../saveProject/saveProject', () => ({ saveProject: mocks.saveProject }));

import { resetCrdtProjectWithTransportStopped } from '../resetCrdtProjectWithTransportStopped';

const replaced = { status: 'replaced', finalize: vi.fn() };

function fakeClosedTakes(initiallyClosed = false) {
    let closed = initiallyClosed;
    return {
        acknowledge: vi.fn<() => void>(() => {
            closed = false;
        }),
        close: () => {
            closed = true;
        },
        hasClosedTake: () => closed,
    };
}

describe('resetCrdtProjectWithTransportStopped', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.events.length = 0;
        mocks.isTransportIdle.mockReturnValue(true);
        mocks.stopPlayback.mockImplementation(() => {
            mocks.events.push('stop');
            return Promise.resolve();
        });
        mocks.resetAudioGraph.mockImplementation(() => {
            mocks.events.push('reset-graph');
        });
        mocks.unloadPlugin.mockImplementation(() => {
            mocks.events.push('unload-plugins');
            return Promise.resolve();
        });
        mocks.saveProject.mockImplementation(() => {
            mocks.events.push('save');
            return Promise.resolve(true);
        });
        mocks.resetCrdtProject.mockResolvedValue(replaced);
    });

    it('resets once, without stopping or saving anything, when the transport is idle and no take closed', async () => {
        const onReplaced = vi.fn();

        await expect(
            resetCrdtProjectWithTransportStopped('Song', onReplaced, () => true, fakeClosedTakes())
        ).resolves.toBe(replaced);

        expect(mocks.resetCrdtProject).toHaveBeenCalledExactlyOnceWith('Song', onReplaced, expect.any(Function));
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('hands every attempt a check that is quiet only when the transport is idle and no take closed unsaved', async () => {
        const closedTakes = fakeClosedTakes();
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, closedTakes);

        const [, , firstCheck] = mocks.resetCrdtProject.mock.calls[0] as [string, () => void, () => boolean];
        const [, , secondCheck] = mocks.resetCrdtProject.mock.calls[1] as [string, () => void, () => boolean];
        expect(secondCheck).toBe(firstCheck);
        expect(firstCheck()).toBe(true);
        mocks.isTransportIdle.mockReturnValue(false);
        expect(firstCheck()).toBe(false);
        mocks.isTransportIdle.mockReturnValue(true);
        closedTakes.close();
        expect(firstCheck()).toBe(false);
    });

    it('waits for each stop before it asks again and returns the first settled answer', async () => {
        const stop = Promise.withResolvers<void>();
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockReturnValueOnce(stop.promise);

        const reset = resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes());
        await vi.waitFor(() => expect(mocks.stopPlayback).toHaveBeenCalledOnce());
        await Promise.resolve();
        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
        stop.resolve();

        await expect(reset).resolves.toBe(replaced);
        expect(mocks.resetCrdtProject).toHaveBeenCalledTimes(2);
    });

    it('stops once per refusal and keeps asking until the reset settles', async () => {
        mocks.resetCrdtProject
            .mockResolvedValueOnce({ status: 'transport-active' })
            .mockResolvedValueOnce({ status: 'transport-active' })
            .mockResolvedValueOnce({ status: 'transport-active' });

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes())
        ).resolves.toBe(replaced);

        expect(mocks.resetCrdtProject).toHaveBeenCalledTimes(4);
        expect(mocks.stopPlayback).toHaveBeenCalledTimes(3);
    });

    it('passes a refusal through untouched', async () => {
        const refused = { status: 'refused', reason: 'session-active' };
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' }).mockResolvedValueOnce(refused);

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes())
        ).resolves.toBe(refused);
    });

    it('refuses as superseded, without asking again, when the caller no longer wants the replacement', async () => {
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => false, fakeClosedTakes())
        ).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('refuses as superseded after a stop, without tearing anything down, when the caller gave up meanwhile', async () => {
        let wanted = true;
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockImplementationOnce(() => {
            wanted = false;
            return Promise.resolve();
        });

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted, fakeClosedTakes(true))
        ).resolves.toEqual({ status: 'refused', reason: 'superseded' });

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
    });

    it('refuses as superseded, without asking again, when the caller gave up during the teardown', async () => {
        let wanted = true;
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.unloadPlugin.mockImplementationOnce(() => {
            wanted = false;
            return Promise.resolve();
        });

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted, fakeClosedTakes())
        ).resolves.toEqual({ status: 'refused', reason: 'superseded' });

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('rejects, without asking again, when the stop rejects', async () => {
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockRejectedValueOnce(new Error('recorder flush failed'));

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes())
        ).rejects.toThrow('recorder flush failed');

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('saves a take that closed before the first attempt, then asks', async () => {
        const closedTakes = fakeClosedTakes(true);

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, closedTakes);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(closedTakes.acknowledge).toHaveBeenCalledOnce();
        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
    });

    it('stops, saves what closed, tears the graph and plugins down again, and only then asks again', async () => {
        const closedTakes = fakeClosedTakes();
        mocks.resetCrdtProject.mockImplementation(() => {
            if (mocks.events.length === 0) {
                mocks.events.push('refused');
                return Promise.resolve({ status: 'transport-active' });
            }
            mocks.events.push('switch');
            return Promise.resolve(replaced);
        });
        mocks.stopPlayback.mockImplementation(() => {
            mocks.events.push('stop');
            closedTakes.close();
            return Promise.resolve();
        });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, closedTakes);

        expect(mocks.events).toEqual(['refused', 'stop', 'save', 'reset-graph', 'unload-plugins', 'switch']);
    });

    it('saves again for a take that closes during the save itself', async () => {
        const closedTakes = fakeClosedTakes(true);
        mocks.saveProject.mockImplementationOnce(() => {
            closedTakes.close();
            return Promise.resolve(true);
        });
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, closedTakes);

        expect(mocks.saveProject).toHaveBeenCalledTimes(2);
    });

    it('tells the user the take is discarded, and still asks, when the outgoing project cannot be saved', async () => {
        mocks.saveProject.mockResolvedValue(false);

        await expect(
            resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes(true))
        ).resolves.toBe(replaced);

        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Recording discarded — the take could not be saved to the project you are leaving.',
            'warning'
        );
    });

    it('does not tell the user anything when the save succeeds', async () => {
        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, fakeClosedTakes(true));

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
