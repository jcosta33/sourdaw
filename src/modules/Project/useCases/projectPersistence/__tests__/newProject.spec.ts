import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearActionHistory, clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import { createCrdtProject, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';

import { removeProjectJson } from '../../../repositories/project/storageOperations';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { newProject } from '../newProject';

vi.mock('#/modules/Transport/useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: vi.fn().mockResolvedValue(true),
    startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    clearActionHistory: vi.fn(),
    clearUndoHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

vi.mock('../../../repositories/project/storageOperations', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
        vi.mocked(clearActionHistory).mockReset();
        vi.mocked(startCrdtAutoSave).mockClear();
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
    });

    it('should reset replay authority before and after the new CRDT becomes active', async () => {
        newProject('Test');

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(clearActionHistory).not.toHaveBeenCalled();
        expect(vi.mocked(resetActionReplayAuthority).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(createCrdtProject).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );

        await vi.waitFor(() => expect(clearActionHistory).toHaveBeenCalledTimes(1));

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(resetAudioGraph).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(createCrdtProject).toHaveBeenCalledWith({ name: 'Test', canActivate: expect.any(Function) });
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master', select: false });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearCachedAudioBuffers).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);

        expect(vi.mocked(clearActionHistory).mock.invocationCallOrder[0]).toBeGreaterThan(
            vi.mocked(createCrdtProject).mock.invocationCallOrder[0] ?? Number.NEGATIVE_INFINITY
        );

        const remove_project_json_order = vi.mocked(removeProjectJson).mock.invocationCallOrder[0];
        const clear_audio_buffers_order = vi.mocked(clearCachedAudioBuffers).mock.invocationCallOrder[0];
        const clear_undo_history_order = vi.mocked(clearUndoHistory).mock.invocationCallOrder[0];

        expect(clear_audio_buffers_order).toBeGreaterThan(remove_project_json_order);
        expect(clear_audio_buffers_order).toBeLessThan(clear_undo_history_order);
    });

    it('should not start normal persistence when target scrub fails', async () => {
        const failure = new Error('target scrub failed');
        vi.mocked(clearActionHistory).mockImplementation(() => {
            throw failure;
        });

        newProject('Blocked');

        await vi.waitFor(() => expect(clearActionHistory).toHaveBeenCalledTimes(1));
        expect(startCrdtAutoSave).not.toHaveBeenCalled();
        expect(projectStore.value).toEqual(expect.objectContaining({ initialized: false, loading: true }));
    });

    it('should keep the latest project when create promises resolve in reverse order', async () => {
        let resolve_first: (() => void) | undefined;
        let resolve_second: (() => void) | undefined;
        vi.mocked(createCrdtProject).mockImplementation(
            ({ name }) =>
                new Promise<boolean>((resolve) => {
                    if (name === 'First') {
                        resolve_first = () => resolve(true);
                    } else {
                        resolve_second = () => resolve(true);
                    }
                })
        );

        newProject('First');
        newProject('Second');

        resolve_second?.();
        await vi.waitFor(() => expect(projectStore.value?.name).toBe('Second'));
        resolve_first?.();
        await Promise.resolve();

        expect(projectStore.value?.name).toBe('Second');
        expect(clearActionHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });
});
