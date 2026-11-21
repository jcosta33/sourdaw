import { describe, expect, it } from 'vitest';

import { commandBatchPreviewPort } from '../commandBatchPreviewPort';

const workspace = {
    getProjectDocument: () => ({}),
    release: () => undefined,
    scope: <Result>(run: () => Result) => run(),
};
const create = () => workspace;
const createRecovery = () => workspace;

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled reads first, then the fills.
describe('commandBatchPreviewPort', () => {
    it('throws on each read before registration, naming the registrar', () => {
        expect(() => commandBatchPreviewPort.create('r')).toThrow('commandBatchPreviewPort.setProvider');
        expect(() => commandBatchPreviewPort.createRecovery('r')).toThrow(
            'commandBatchPreviewPort.setRecoveryProvider'
        );
    });

    it('serves each registered provider', () => {
        commandBatchPreviewPort.setProvider(create);
        commandBatchPreviewPort.setRecoveryProvider(createRecovery);
        expect(commandBatchPreviewPort.create('r')).toBe(workspace);
        expect(commandBatchPreviewPort.createRecovery('r')).toBe(workspace);
    });

    it('answers from the second providers after a second fill', () => {
        const other = { ...workspace, release: () => undefined };
        commandBatchPreviewPort.setProvider(() => other);
        commandBatchPreviewPort.setRecoveryProvider(() => other);

        expect(commandBatchPreviewPort.create('r')).toBe(other);
        expect(commandBatchPreviewPort.createRecovery('r')).toBe(other);
    });
});
