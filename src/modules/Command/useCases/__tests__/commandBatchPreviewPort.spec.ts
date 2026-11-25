import { describe, expect, it, vi } from 'vitest';

import { commandBatchPreviewPort } from '../commandBatchPreviewPort';

const createWorkspace = () => ({
    getProjectDocument: () => ({}),
    release: () => undefined,
    scope: <Result>(run: () => Result) => run(),
});
const previewWorkspace = createWorkspace();
const recoveryWorkspace = createWorkspace();

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled reads first, then the fills.
describe('commandBatchPreviewPort', () => {
    it('throws on each read before registration, naming the registrar', () => {
        expect(() => commandBatchPreviewPort.create('r')).toThrow('commandBatchPreviewPort.setProvider');
        expect(() => commandBatchPreviewPort.createRecovery('r')).toThrow(
            'commandBatchPreviewPort.setRecoveryProvider'
        );
    });

    it('serves each read from its own provider with the base revision', () => {
        const create = vi.fn(() => previewWorkspace);
        const createRecovery = vi.fn(() => recoveryWorkspace);
        commandBatchPreviewPort.setProvider(create);
        commandBatchPreviewPort.setRecoveryProvider(createRecovery);

        expect(commandBatchPreviewPort.create('revision-1')).toBe(previewWorkspace);
        expect(commandBatchPreviewPort.createRecovery('revision-2')).toBe(recoveryWorkspace);
        expect(create).toHaveBeenCalledExactlyOnceWith('revision-1');
        expect(createRecovery).toHaveBeenCalledExactlyOnceWith('revision-2');
    });

    it('answers from the second providers after a second fill', () => {
        const otherPreview = createWorkspace();
        const otherRecovery = createWorkspace();
        commandBatchPreviewPort.setProvider(() => otherPreview);
        commandBatchPreviewPort.setRecoveryProvider(() => otherRecovery);

        expect(commandBatchPreviewPort.create('r')).toBe(otherPreview);
        expect(commandBatchPreviewPort.createRecovery('r')).toBe(otherRecovery);
    });
});
