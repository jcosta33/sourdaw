import { describe, expect, it } from 'vitest';

import {
    createProviderSemanticListPlanningResponder,
    createProviderToolPlanningFixture,
} from './providerToolPlanningFixture';

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

    it('restarts catalog discovery for a retried semantic planning attempt', () => {
        const respond = createProviderSemanticListPlanningResponder(
            [
                {
                    id: 'insert-left-compressor',
                    name: 'addDevice',
                    arguments: { deviceType: 'Compressor', afterDeviceId: 'device-left-eq' },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Bass Left' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
                {
                    id: 'insert-right-compressor',
                    name: 'addDevice',
                    arguments: { deviceType: 'Compressor', afterDeviceId: 'device-right-eq' },
                    selector: {
                        targetArgument: 'trackId',
                        entity: 'track',
                        where: { name: 'Bass Right' },
                        quantity: { unit: 'targets', exactly: 1 },
                    },
                },
            ],
            { targetIds: ['track-left', 'track-right'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] }
        );

        expect(JSON.parse(respond('new planning attempt'))).toEqual([
            { name: 'agent.catalog.discover', arguments: { category: 'command', names: ['addDevice'] } },
        ]);
        expect(JSON.parse(respond('Application-owned tool receipts from turn 1'))).toMatchObject([
            {
                name: 'command.batch.propose',
                arguments: { list: { items: [{ name: 'addDevice' }, { name: 'addDevice' }] } },
            },
        ]);
        expect(JSON.parse(respond('new planning attempt after provider retry'))).toEqual([
            { name: 'agent.catalog.discover', arguments: { category: 'command', names: ['addDevice'] } },
        ]);
    });
});
