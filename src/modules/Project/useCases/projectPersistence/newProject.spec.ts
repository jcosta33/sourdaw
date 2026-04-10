import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { newProject } from './newProject';

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('forwards to injected collaborators (smoke)', () => {
        const stopPlayback = vi.fn();
        const resetAudioGraph = vi.fn();
        const createCrdtProject = vi.fn().mockResolvedValue(undefined);
        const resetModuleStoresToDefault = vi.fn();
        const addTrack = vi.fn();
        const clearUndoHistory = vi.fn();
        const startCrdtAutoSave = vi.fn().mockReturnValue(() => {});
        const removeProjectJson = vi.fn();

        injectDependencies(newProject, {
            stopPlayback,
            resetAudioGraph,
            createCrdtProject,
            resetModuleStoresToDefault,
            addTrack,
            clearUndoHistory,
            startCrdtAutoSave,
            removeProjectJson,
        });

        newProject('Test');

        expect(stopPlayback).toHaveBeenCalledTimes(1);
        expect(resetAudioGraph).toHaveBeenCalledTimes(1);
        expect(resetModuleStoresToDefault).toHaveBeenCalledTimes(1);
        expect(createCrdtProject).toHaveBeenCalledWith('Test');
        expect(addTrack).toHaveBeenCalledWith({ name: 'Master', kind: 'master' });
        expect(removeProjectJson).toHaveBeenCalledTimes(1);
        expect(clearUndoHistory).toHaveBeenCalledTimes(1);
        expect(startCrdtAutoSave).toHaveBeenCalledTimes(1);
    });
});
