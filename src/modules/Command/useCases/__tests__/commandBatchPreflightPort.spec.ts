import { describe, expect, it, vi } from 'vitest';

import { commandBatchPreflightPort } from '../commandBatchPreflightPort';

const state = {
    audioGraphValid: true,
    availableAssetHashes: [],
    availableAudioBufferIds: [],
    lockedRanges: [],
    projectId: 'project-1',
    projectInvariantsValid: true,
    targetFingerprints: {},
};
const input = { assetReferences: [], targetIds: [] };
const firstState = { ...state, projectId: 'first' };
const secondState = { ...state, projectId: 'second' };

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled read first, then the fills.
describe('commandBatchPreflightPort', () => {
    it('throws on a read before registration, naming the registrar', () => {
        expect(() => commandBatchPreflightPort.capture(input)).toThrow('commandBatchPreflightPort.setProvider');
    });

    it('returns what the registered provider captures for the given input', () => {
        const provider = vi.fn(() => firstState);
        commandBatchPreflightPort.setProvider(provider);

        expect(commandBatchPreflightPort.capture(input)).toBe(firstState);
        expect(provider).toHaveBeenCalledExactlyOnceWith(input);
    });

    it('returns what the second provider captures after a second fill', () => {
        commandBatchPreflightPort.setProvider(() => secondState);

        expect(commandBatchPreflightPort.capture(input)).toBe(secondState);
    });
});
