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
    it.each([
        'builtin-synth',
        'synth',
        'builtin-synth-strings',
        'builtin-drum-kit',
        'drum-kit',
        'builtin-drum-machine-808',
    ])('keeps %s in guarded project identity but excludes it only from Web Audio', (type) => {
        const track = TrackDummy.create({
            kind: 'midi',
            devices: [
                { id: 'instrument', name: 'Instrument', type, bypassed: false, parameterValues: { cutoff: 0.5 } },
                { id: 'effect', name: 'Crust', type: 'crust', bypassed: false, parameterValues: { ceiling: -1 } },
            ],
        });
        mocks.getAllTracks.mockReturnValue([track]);
        const project = runtimeGraphTopology.createNode(track);
        const webAudio = runtimeGraphTopology.createWebAudioNode(track);
        expect(project.devices.map((device) => device.id)).toEqual(['instrument', 'effect']);
        expect(webAudio.devices).toEqual([{ id: 'effect', type: 'crust', parameterIds: ['ceiling'] }]);
        expect(runtimeGraphTopology.matchesNode(track, project)).toBe(true);
        expect(runtimeGraphTopology.matchesNode(track, webAudio)).toBe(false);
        expect(runtimeGraphTopology.matchesCurrentProject([webAudio])).toBe(true);
        expect(runtimeGraphTopology.matchesCurrentProject([project])).toBe(false);
    });

    it('does not hide unknown device types from Web Audio construction', () => {
        const track = TrackDummy.create({
            devices: [
                { id: 'unknown', name: 'Unknown', type: 'unknown-unbuildable', bypassed: false, parameterValues: {} },
            ],
        });
        expect(runtimeGraphTopology.createWebAudioNode(track).devices).toEqual([
            { id: 'unknown', type: 'unknown-unbuildable', parameterIds: [] },
        ]);
    });
});
