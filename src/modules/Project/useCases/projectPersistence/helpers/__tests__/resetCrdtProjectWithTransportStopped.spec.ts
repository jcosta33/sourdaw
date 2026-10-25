import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    events: [] as string[],
    isTransportIdle: vi.fn(),
    notifyUser: vi.fn(),
    resetAudioGraph: vi.fn(),
    resetCrdtProject: vi.fn(),
    saveProject: vi.fn(),
    /** How many take commits have settled, as the Transport counts them. */
    settledTakes: { value: 0 },
    stopPlayback: vi.fn(),
    unloadPlugin: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ resetAudioGraph: mocks.resetAudioGraph }));
vi.mock('#/modules/CrdtDocument/useCases', () => ({ resetCrdtProject: mocks.resetCrdtProject }));
vi.mock('#/modules/PluginHost/useCases', () => ({ unloadPlugin: mocks.unloadPlugin }));
vi.mock('#/modules/Transport/useCases', () => ({
    countSettledTakes: () => mocks.settledTakes.value,
    isTransportIdle: mocks.isTransportIdle,
    stopPlayback: mocks.stopPlayback,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('../../saveProject/saveProject', () => ({ saveProject: mocks.saveProject }));

import { resetCrdtProjectWithTransportStopped } from '../resetCrdtProjectWithTransportStopped';
import { unsavedClosedTakes } from '../unsavedClosedTakes';

const replaced = { status: 'replaced', finalize: vi.fn() };

/** A take commit settles into the open project. */
function closeTake(): void {
    mocks.settledTakes.value++;
}

/** The Save command's contract: a successful save records the takes settled at its snapshot. */
function saveThroughSnapshot(saved = true): Promise<boolean> {
    const settledAtSnapshot = mocks.settledTakes.value;
    mocks.events.push('save');
    if (saved) {
        unsavedClosedTakes.markSavedThrough(settledAtSnapshot);
    }
    return Promise.resolve(saved);
}

describe('resetCrdtProjectWithTransportStopped', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Each case opens with a project that owes nothing for the takes before it.
        unsavedClosedTakes.acknowledgeAll();
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
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot());
        mocks.resetCrdtProject.mockResolvedValue(replaced);
    });

    it('resets once, without stopping or saving anything, when the transport is idle and no take closed', async () => {
        const onReplaced = vi.fn();

        await expect(resetCrdtProjectWithTransportStopped('Song', onReplaced, () => true)).resolves.toBe(replaced);

        expect(mocks.resetCrdtProject).toHaveBeenCalledExactlyOnceWith(
            'Song',
            expect.any(Function),
            expect.any(Function)
        );
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.resetAudioGraph).not.toHaveBeenCalled();
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('tells the caller once the authority is replaced', async () => {
        const onReplaced = vi.fn();
        mocks.resetCrdtProject.mockImplementationOnce((_name: string, onAuthorityReplaced: () => void) => {
            expect(onReplaced).not.toHaveBeenCalled();
            onAuthorityReplaced();
            return Promise.resolve(replaced);
        });

        await resetCrdtProjectWithTransportStopped('Song', onReplaced, () => true);

        expect(onReplaced).toHaveBeenCalledOnce();
    });

    it('hands every attempt a check that is quiet only when the transport is idle and no take closed unsaved', async () => {
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        const [, , firstCheck] = mocks.resetCrdtProject.mock.calls[0] as [string, () => void, () => boolean];
        const [, , secondCheck] = mocks.resetCrdtProject.mock.calls[1] as [string, () => void, () => boolean];
        expect(secondCheck).toBe(firstCheck);
        expect(firstCheck()).toBe(true);
        mocks.isTransportIdle.mockReturnValue(false);
        expect(firstCheck()).toBe(false);
        mocks.isTransportIdle.mockReturnValue(true);
        closeTake();
        expect(firstCheck()).toBe(false);
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

    it('stops once per refusal and keeps asking until the reset settles', async () => {
        mocks.resetCrdtProject
            .mockResolvedValueOnce({ status: 'transport-active' })
            .mockResolvedValueOnce({ status: 'transport-active' })
            .mockResolvedValueOnce({ status: 'transport-active' });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(replaced);

        expect(mocks.resetCrdtProject).toHaveBeenCalledTimes(4);
        expect(mocks.stopPlayback).toHaveBeenCalledTimes(3);
    });

    it('passes a refusal through untouched', async () => {
        const refused = { status: 'refused', reason: 'session-active' };
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' }).mockResolvedValueOnce(refused);

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(refused);
    });

    it('refuses as superseded, without asking again, when the caller no longer wants the replacement', async () => {
        let wanted = true;
        mocks.resetCrdtProject.mockImplementationOnce(() => {
            wanted = false;
            return Promise.resolve({ status: 'transport-active' });
        });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted)).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('refuses as superseded after a stop, without tearing anything down, when the caller gave up meanwhile', async () => {
        let wanted = true;
        closeTake();
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockImplementationOnce(() => {
            wanted = false;
            return Promise.resolve();
        });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted)).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

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

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted)).resolves.toEqual({
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

    it('saves a take that closed before the replacement began, then asks', async () => {
        closeTake();

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(unsavedClosedTakes.hasUnsaved()).toBe(false);
        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
        expect(mocks.stopPlayback).not.toHaveBeenCalled();
    });

    it('stops, saves what closed, tears the graph and plugins down again, and only then asks again', async () => {
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
            closeTake();
            return Promise.resolve();
        });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        expect(mocks.events).toEqual(['refused', 'stop', 'save', 'reset-graph', 'unload-plugins', 'switch']);
    });

    it('saves again for a take that closes during the save itself', async () => {
        closeTake();
        mocks.saveProject.mockImplementationOnce(async () => {
            const saved = await saveThroughSnapshot();
            closeTake();
            return saved;
        });
        mocks.resetCrdtProject.mockImplementation((_name: string, _onReplaced: () => void, isQuiet: () => boolean) =>
            Promise.resolve(isQuiet() ? replaced : { status: 'transport-active' })
        );

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        expect(mocks.saveProject).toHaveBeenCalledTimes(2);
        expect(unsavedClosedTakes.hasUnsaved()).toBe(false);
    });

    it('tells the user the take is discarded, and still asks, when the outgoing project cannot be saved', async () => {
        closeTake();
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(replaced);

        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Recording discarded — the take could not be saved to the project you are leaving.',
            'warning'
        );
    });

    it('lets the switch through after a failed save instead of saving the same take again', async () => {
        closeTake();
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));
        mocks.resetCrdtProject.mockImplementation((_name: string, _onReplaced: () => void, isQuiet: () => boolean) =>
            Promise.resolve(isQuiet() ? replaced : { status: 'transport-active' })
        );

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(replaced);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.resetCrdtProject).toHaveBeenCalledOnce();
    });

    it('says nothing when the reset refuses after the save failed, because the user stays in the project with the take', async () => {
        const refused = { status: 'refused', reason: 'session-active' };
        closeTake();
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));
        mocks.resetCrdtProject.mockResolvedValueOnce(refused);

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(refused);

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(unsavedClosedTakes.hasUnsaved()).toBe(true);
    });

    it('tells the user once, only after the reset replaced the project, when the save failed', async () => {
        closeTake();
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));
        mocks.resetCrdtProject
            .mockImplementationOnce(() => {
                expect(mocks.notifyUser).not.toHaveBeenCalled();
                return Promise.resolve({ status: 'transport-active' });
            })
            .mockImplementationOnce(() => {
                expect(mocks.notifyUser).not.toHaveBeenCalled();
                return Promise.resolve(replaced);
            });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true)).resolves.toBe(replaced);

        expect(mocks.notifyUser).toHaveBeenCalledExactlyOnceWith(
            'Recording discarded — the take could not be saved to the project you are leaving.',
            'warning'
        );
    });

    it('says nothing when the save failed but a later save of the same project succeeded before the switch', async () => {
        closeTake();
        mocks.saveProject
            .mockImplementationOnce(() => saveThroughSnapshot(false))
            .mockImplementationOnce(() => saveThroughSnapshot());
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockImplementationOnce(() => {
            closeTake();
            return Promise.resolve();
        });

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        expect(mocks.saveProject).toHaveBeenCalledTimes(2);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('says nothing when the save failed and the caller gave up before the switch', async () => {
        let wanted = true;
        closeTake();
        mocks.saveProject.mockImplementation(() => {
            wanted = false;
            return saveThroughSnapshot(false);
        });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted)).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('refuses as superseded, without a reset call, when the caller gave up during the first save', async () => {
        let wanted = true;
        closeTake();
        mocks.saveProject.mockImplementation(() => {
            wanted = false;
            return saveThroughSnapshot();
        });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => wanted)).resolves.toEqual({
            status: 'refused',
            reason: 'superseded',
        });

        expect(mocks.saveProject).toHaveBeenCalledOnce();
        expect(mocks.resetCrdtProject).not.toHaveBeenCalled();
    });

    it('never saves or warns for a replacement that discards the outgoing project, yet acknowledges the take so the switch is not refused', async () => {
        closeTake();
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, 'discard')).resolves.toBe(
            replaced
        );

        const [, , isQuietAtSwitch] = mocks.resetCrdtProject.mock.calls[0] as [string, () => void, () => boolean];
        expect(unsavedClosedTakes.hasUnsaved()).toBe(false);
        expect(isQuietAtSwitch()).toBe(true);
        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });

    it('never saves for a discarding replacement when a take closes during its own stop', async () => {
        mocks.saveProject.mockImplementation(() => saveThroughSnapshot(false));
        mocks.resetCrdtProject.mockResolvedValueOnce({ status: 'transport-active' });
        mocks.stopPlayback.mockImplementationOnce(() => {
            closeTake();
            return Promise.resolve();
        });

        await expect(resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true, 'discard')).resolves.toBe(
            replaced
        );

        expect(mocks.saveProject).not.toHaveBeenCalled();
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(unsavedClosedTakes.hasUnsaved()).toBe(false);
    });

    it('does not tell the user anything when the save succeeds', async () => {
        closeTake();

        await resetCrdtProjectWithTransportStopped('Song', vi.fn(), () => true);

        expect(mocks.notifyUser).not.toHaveBeenCalled();
    });
});
