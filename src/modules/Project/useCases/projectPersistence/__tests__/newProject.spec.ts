import { describe, it, expect, vi, beforeEach } from 'vitest';

import { Container } from '#/infra/di/Container';
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases/engineAccess/resetAudioGraph';
import { clearUndoHistory } from '#/modules/Command/stores';
import { createCrdtProject } from '#/modules/CrdtDocument/useCases/crdtProjectLifecycle';
import { startCrdtAutoSave } from '#/modules/CrdtDocument/useCases/startCrdtAutoSave';
import { stopPlayback } from '#/modules/Transport/useCases/transportControls/stopPlayback';

import { removeProjectJson } from '../../../repositories/project/storageOperations';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { newProject } from '../newProject';

vi.mock('#/modules/Transport/useCases/transportControls/stopPlayback', () => ({
    stopPlayback: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases/engineAccess/resetAudioGraph', () => ({
    resetAudioGraph: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases/crdtProjectLifecycle', () => ({
    createCrdtProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('#/modules/CrdtDocument/useCases/startCrdtAutoSave', () => ({
    startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
}));

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases/addTrack', () => ({
    addTrack: vi.fn(),
}));

vi.mock('#/modules/Command/stores', () => ({
    clearUndoHistory: vi.fn(),
}));

vi.mock('../../../repositories/project/storageOperations', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('forwards to injected collaborators (smoke)', () => {
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
