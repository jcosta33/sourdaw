import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { clearCachedAudioBuffers, resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { clearUndoHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';
import { createCrdtProject, projectActionHistoryToStore, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';

import { removeProjectJson } from '../../../repositories/project/storageOperations';
import { defaultProjectStoreState, projectStore } from '../../../stores/projectStore';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { newProject } from '../newProject';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

vi.mock('#/modules/Transport/useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    clearCachedAudioBuffers: vi.fn(),
    resetAudioGraph: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    createCrdtProject: vi.fn().mockResolvedValue(true),
    projectActionHistoryToStore: vi.fn(),
    startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
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
        vi.mocked(startCrdtAutoSave).mockClear();
        projectStore.set({ ...defaultProjectStoreState, initialized: true, loading: false });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
    });

    it('should reset replay authority before the empty CRDT becomes active', async () => {
        newProject('Test');

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(vi.mocked(resetActionReplayAuthority).mock.invocationCallOrder[0]).toBeLessThan(
            vi.mocked(createCrdtProject).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
        );

        await vi.waitFor(() => expect(startCrdtAutoSave).toHaveBeenCalledTimes(1));

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(resetAudioGraph).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(createCrdtProject).toHaveBeenCalledWith({ name: 'Test', canActivate: expect.any(Function) });
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master', select: false });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearCachedAudioBuffers).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);

        const remove_project_json_order = vi.mocked(removeProjectJson).mock.invocationCallOrder[0];
        const clear_audio_buffers_order = vi.mocked(clearCachedAudioBuffers).mock.invocationCallOrder[0];
        const clear_undo_history_order = vi.mocked(clearUndoHistory).mock.invocationCallOrder[0];

        expect(clear_audio_buffers_order).toBeGreaterThan(remove_project_json_order);
        expect(clear_audio_buffers_order).toBeLessThan(clear_undo_history_order);
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
        await vi.waitFor(() => expect(createCrdtProject).toHaveBeenCalledTimes(1));
        newProject('Second');
        await vi.waitFor(() => expect(createCrdtProject).toHaveBeenCalledTimes(2));

        resolve_second?.();
        await vi.waitFor(() => expect(projectStore.value?.name).toBe('Second'));
        resolve_first?.();
        await Promise.resolve();

        expect(projectStore.value?.name).toBe('Second');
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });

    it('should preserve source action-history projection when target creation fails', async () => {
        vi.mocked(createCrdtProject).mockResolvedValueOnce(false);

        newProject('Failed');

        await vi.waitFor(() => expect(createCrdtProject).toHaveBeenCalledTimes(1));
        expect(projectActionHistoryToStore).not.toHaveBeenCalled();
    });

    it('should shut down the old peer transport before repository replacement can notify', async () => {
        let finish_shutdown: (() => void) | undefined;
        let old_peer_active = true;
        const documents_seen_by_old_peer: string[] = [];
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: () =>
                new Promise<void>((resolve) => {
                    finish_shutdown = () => {
                        old_peer_active = false;
                        resolve();
                    };
                }),
        });
        vi.mocked(createCrdtProject).mockImplementation(async ({ name }) => {
            if (old_peer_active) {
                documents_seen_by_old_peer.push(name);
            }
            return true;
        });

        newProject('Project B');
        expect(createCrdtProject).not.toHaveBeenCalled();
        finish_shutdown?.();
        await vi.waitFor(() => expect(createCrdtProject).toHaveBeenCalledTimes(1));

        expect(documents_seen_by_old_peer).toEqual([]);
        expect(projectActionHistoryToStore).toHaveBeenCalledTimes(1);
    });
});
