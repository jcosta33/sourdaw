import { describe, expect, it } from 'vitest';

import { createProviderToolPlanningFixture } from './providerToolPlanningFixture';

describe('provider tool planning fixture', () => {
    it('discovers exactly the proposed commands before returning a scope-preserving batch proposal', () => {
        const scope = {
            targetIds: ['track-vocals', 'bus-hall'],
            targetRanges: [{ startBeat: 16, endBeat: 32 }],
            protectedTargetIds: ['track-dialogue'],
            protectedRanges: [],
        };
        const next = createProviderToolPlanningFixture(
            [
                { name: 'selectWorkflowCapability', arguments: { capabilityId: 'backing-vocal-plate' } },
                { name: 'automateSendRange', arguments: { trackIds: ['track-vocals'], busId: 'bus-hall' } },
            ],
            scope
        );

        expect(JSON.parse(next())).toEqual([
            {
                name: 'agent.catalog.discover',
                arguments: { category: 'command', names: ['automateSendRange'] },
            },
        ]);
        expect(JSON.parse(next())).toMatchObject([
            { name: 'selectWorkflowCapability', arguments: { capabilityId: 'backing-vocal-plate' } },
            {
                name: 'command.batch.propose',
                arguments: {
                    commands: [
                        { name: 'automateSendRange', arguments: { trackIds: ['track-vocals'], busId: 'bus-hall' } },
                    ],
                    plan: { scope, capabilityIds: ['automateSendRange'] },
                },
            },
        ]);
    });

    it('rejects repeated commands so a caller must provide bounded semantic selectors', () => {
        expect(() =>
            createProviderToolPlanningFixture([
                { name: 'setTrackPan', arguments: { trackId: 'track-left', pan: -20 } },
                { name: 'setTrackPan', arguments: { trackId: 'track-right', pan: 20 } },
            ])
        ).toThrow('Repeated commands require an explicit workflow fixture with bounded semantic selectors.');
    });
});
