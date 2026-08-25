import { describe, expect, it } from 'vitest';

import { type AgentPlanProposal } from '../../models/AgentRun';
import { normalizeAgentPlanProposal } from '../normalizeAgentPlanProposal';

function createProposal(scope: AgentPlanProposal['scope']): AgentPlanProposal {
    return {
        semantic: { classification: 'simple', uncertainty: [] },
        objective: 'Copy a bounded articulation gesture.',
        constraints: ['Stay within the proposed command scope.'],
        scope,
        capabilityIds: ['copyMidiArticulations'],
        assetIds: [],
        alternatives: [],
        validationStrategy: ['Validate through the command authority parser.'],
        stoppingConditions: ['Stop before mutation if the scope is invalid.'],
    };
}

describe('normalizeAgentPlanProposal', () => {
    it('accepts point target ranges', () => {
        const proposal = createProposal({
            targetIds: ['clip-chorus-two'],
            targetRanges: [{ startBeat: 4, endBeat: 4 }],
            protectedTargetIds: [],
            protectedRanges: [],
        });

        expect(normalizeAgentPlanProposal(proposal)?.scope.targetRanges).toEqual([{ startBeat: 4, endBeat: 4 }]);
    });

    it('rejects point protected ranges', () => {
        const proposal = createProposal({
            targetIds: ['clip-chorus-two'],
            targetRanges: [],
            protectedTargetIds: ['clip-chorus-one'],
            protectedRanges: [{ startBeat: 4, endBeat: 4 }],
        });

        expect(normalizeAgentPlanProposal(proposal)).toBeNull();
    });

    it('rejects inverted target ranges', () => {
        const proposal = createProposal({
            targetIds: ['clip-chorus-two'],
            targetRanges: [{ startBeat: 5, endBeat: 4 }],
            protectedTargetIds: [],
            protectedRanges: [],
        });

        expect(normalizeAgentPlanProposal(proposal)).toBeNull();
    });
});
