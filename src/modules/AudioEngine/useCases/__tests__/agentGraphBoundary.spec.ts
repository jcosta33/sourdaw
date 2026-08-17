import { describe, expect, it } from 'vitest';

import { compileRuntimeGraphDelta } from '../compileRuntimeGraphDelta';

type DeltaInput = {
    schemaVersion: number;
    command: string;
    correlation: { appRevision: number; projectRevision: string };
    nodes: unknown[];
    edges: unknown[];
    parameters: unknown[];
};

function createDelta(overrides: Partial<DeltaInput> = {}): DeltaInput {
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
            },
            { id: 'return', kind: 'bus', devices: [] },
        ],
        edges: [{ kind: 'output', sourceId: 'source', targetId: 'return' }],
        parameters: [],
        ...overrides,
    };
}

describe('agent runtime graph boundary', () => {
    it('compiles a bounded immutable output delta with exact device order and parameter ids', () => {
        const result = compileRuntimeGraphDelta(createDelta());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled') {
            return;
        }
        expect(result.delta.nodes[0]?.devices.map((device) => device.id)).toEqual(['compressor']);
        expect(result.delta.nodes[0]?.devices.map((device) => device.type)).toEqual(['builtin-compressor']);
        expect(result.delta.nodes[0]?.devices[0]?.parameterIds).toEqual(['attack', 'ratio']);
        expect(Object.isFrozen(result.delta)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes[0]?.devices)).toBe(true);
    });

    it.each([
        [
            'duplicate graph nodes',
            createDelta({
                nodes: [
                    { id: 'source', kind: 'audio', devices: [] },
                    { id: 'source', kind: 'bus', devices: [] },
                ],
            }),
        ],
        ['missing output endpoint', createDelta({ nodes: [createDelta().nodes[0]] })],
        ['missing output edge', createDelta({ edges: [] })],
        ['unsupported topology kind', createDelta({ nodes: [{ id: 'source', kind: 'vca', devices: [] }] })],
        [
            'unordered endpoint',
            createDelta({
                nodes: [
                    { id: 'return', kind: 'bus', devices: [] },
                    { id: 'source', kind: 'audio', devices: [] },
                ],
            }),
        ],
        [
            'unsorted parameter ids',
            createDelta({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['ratio', 'attack'] }],
                    },
                    { id: 'return', kind: 'bus', devices: [] },
                ],
            }),
        ],
    ])('rejects %s before a runtime consumer can act', (_label, delta) => {
        expect(compileRuntimeGraphDelta(delta).status).toBe('invalid');
    });
});
