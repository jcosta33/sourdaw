import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { newProject } from '../newProject';
import { stopPlayback } from '#/modules/Transport/useCases';
import { resetAudioGraph } from '#/modules/AudioEngine/useCases';
import { createCrdtProject, startCrdtAutoSave } from '#/modules/CrdtDocument/useCases';
import { resetModuleStoresToDefault } from '../helpers/resetModuleStoresToDefault';
import { addTrack } from '#/modules/Arrangement/useCases';
import { clearUndoHistory } from '#/modules/Command/useCases';
import { removeProjectJson } from '../../../repositories/project/storageOperations';

vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        stopPlayback: vi.fn(),
    };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/AudioEngine/useCases')>();
    return {
        ...actual,
        resetAudioGraph: vi.fn(),
    };
});

vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>();
    return {
        ...actual,
        createCrdtProject: vi.fn().mockResolvedValue(undefined),
        startCrdtAutoSave: vi.fn().mockReturnValue(() => {}),
    };
});

vi.mock('../helpers/resetModuleStoresToDefault', () => ({
    resetModuleStoresToDefault: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return {
        ...actual,
        addTrack: vi.fn(),
    };
});

vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    return {
        ...actual,
        clearUndoHistory: vi.fn(),
    };
});

vi.mock('../../../repositories/project/storageOperations', () => ({
    removeProjectJson: vi.fn(),
}));

describe('newProject injectable', () => {
    beforeEach(() => {
        Container.clear();
        vi.clearAllMocks();
    });

    it('forwards to injected collaborators (smoke)', async () => {
        await newProject('Test');

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
