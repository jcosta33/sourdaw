import { describe, expect, it, vi, beforeEach } from 'vitest';

import { TrackDummy } from '../../__tests__/TrackDummy';
import { runtimeGraphTopology, type RuntimeGraphTopologyNode } from '../runtimeGraphTopology';

const mocks = vi.hoisted(() => ({
    getAllTracks: vi.fn(),
}));

vi.mock('../../repositories/track/getAllTracks', () => ({
    getAllTracks: mocks.getAllTracks,
}));

function currentTopology(): readonly RuntimeGraphTopologyNode[] {
    const source = TrackDummy.create({
        id: 'source',
        kind: 'audio',
        devices: [
            {
                id: 'compressor',
                name: 'Compressor',
                type: 'builtin-compressor',
                bypassed: false,
                parameterValues: { ratio: 4, attack: 20 },
            },
        ],
    });
    const target = TrackDummy.create({ id: 'target', kind: 'bus' });
    mocks.getAllTracks.mockReturnValue([source, target]);
    return [runtimeGraphTopology.createNode(source), runtimeGraphTopology.createNode(target)];
}

describe('runtime graph project topology', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('derives the canonical node from owner track/device facts', () => {
        const [source] = currentTopology();

        expect(source).toEqual({
            id: 'source',
            kind: 'audio',
            devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
        });
        expect(runtimeGraphTopology.matchesCurrentProject(currentTopology())).toBe(true);
    });

    it.each([
        [
            'node kind',
            (nodes: readonly RuntimeGraphTopologyNode[]) => [{ ...nodes[0]!, kind: 'midi' as const }, nodes[1]!],
        ],
        [
            'device factory type',
            (nodes: readonly RuntimeGraphTopologyNode[]) => [
                {
                    ...nodes[0]!,
                    devices: [{ id: 'compressor', type: 'builtin-limiter', parameterIds: ['attack', 'ratio'] }],
                },
                nodes[1]!,
            ],
        ],
        [
            'missing parameter id',
            (nodes: readonly RuntimeGraphTopologyNode[]) => [
                {
                    ...nodes[0]!,
                    devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack'] }],
                },
                nodes[1]!,
            ],
        ],
        [
            'extra parameter id',
            (nodes: readonly RuntimeGraphTopologyNode[]) => [
                {
                    ...nodes[0]!,
                    devices: [
                        {
                            id: 'compressor',
                            type: 'builtin-compressor',
                            parameterIds: ['attack', 'ratio', 'threshold'],
                        },
                    ],
                },
                nodes[1]!,
            ],
        ],
    ])('rejects changed %s', (_label, mutate) => {
        const topology = currentTopology();

        expect(runtimeGraphTopology.matchesCurrentProject(mutate(topology))).toBe(false);
    });
});
