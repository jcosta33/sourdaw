import { describe, expect, it, vi } from 'vitest';

import { createEngineDeviceCollaborators } from '../createEngineDeviceCollaborators';

import type { EngineUseCaseCollaborators } from '../../../models/EngineDeviceCollaborators';

function createUseCases(): EngineUseCaseCollaborators {
    return {
        captureParameterWriteReceipt: vi.fn(),
        createFaustDeviceNode: vi.fn(),
        reportLatency: vi.fn(),
        clearReportedLatency: vi.fn(),
    };
}

describe('createEngineDeviceCollaborators', () => {
    it('refuses a use-case write before the composition root wires one', async () => {
        const { collaborators } = createEngineDeviceCollaborators();

        expect(() => collaborators.reportLatency('d1', 3)).toThrow(
            'AudioEngine reportLatency is not wired: the composition root installs it through initEngineDeviceCollaborators'
        );
        await expect(collaborators.createFaustDeviceNode({} as BaseAudioContext, 'p')).rejects.toThrow(
            'AudioEngine createFaustDeviceNode is not wired'
        );
    });

    it('resolves the installed use cases per call through the one stable collaborator object', () => {
        const slot = createEngineDeviceCollaborators();
        const held = slot.collaborators;
        const useCases = createUseCases();

        slot.setUseCaseCollaborators(useCases);
        held.reportLatency('d1', 3);

        expect(useCases.reportLatency).toHaveBeenCalledExactlyOnceWith('d1', 3);
    });

    it('refuses again once the use cases are unwired', () => {
        const slot = createEngineDeviceCollaborators();
        slot.setUseCaseCollaborators(createUseCases());

        slot.setUseCaseCollaborators(null);

        expect(() => slot.collaborators.clearReportedLatency('d1')).toThrow(
            'AudioEngine clearReportedLatency is not wired'
        );
    });
});
