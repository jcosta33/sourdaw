import { describe, expect, it } from 'vitest';

import { commandProjectDivergencePort } from '../commandProjectDivergencePort';

const input = { baseRevision: 'r', commandsCompatible: true, targetIds: [] };
const first = { kind: 'none' as const, mayReapply: true, repairCandidates: [], targetIds: [] };
const second = { kind: 'deleted-target' as const, mayReapply: false, repairCandidates: [], targetIds: ['t'] };

// Vitest gives each spec file a fresh module graph, so the cases below run in
// order: the unfilled read first, then the fills.
describe('commandProjectDivergencePort', () => {
    it('throws on a read before registration, naming the registrar', () => {
        expect(() => commandProjectDivergencePort.classify(input)).toThrow('commandProjectDivergencePort.setProvider');
    });

    it('returns what the registered provider classifies', () => {
        commandProjectDivergencePort.setProvider(() => first);

        expect(commandProjectDivergencePort.classify(input)).toBe(first);
    });

    it('returns what the second provider classifies after a second fill', () => {
        commandProjectDivergencePort.setProvider(() => second);

        expect(commandProjectDivergencePort.classify(input)).toBe(second);
    });
});
