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

function createDeviceChainDelta(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        operation: 'add-device',
        before: {
            id: 'track-1',
            kind: 'audio',
            devices: [{ id: 'eq-1', type: 'eq', parameterIds: ['frequency'] }],
        },
        after: {
            id: 'track-1',
            kind: 'audio',
            devices: [
                { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                { id: 'compressor-1', type: 'compressor', parameterIds: ['attack', 'ratio'] },
            ],
        },
        parameters: [],
        ...overrides,
    };
}

function createTrackStripInitialization(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 1,
        command: 'initialize-track-strip',
        correlation: { appRevision: 4, projectRevision: 'project-revision-4' },
        nodes: [
            {
                id: 'source',
                kind: 'audio',
                devices: [{ id: 'compressor', type: 'builtin-compressor', parameterIds: ['attack', 'ratio'] }],
            },
        ],
        output: { kind: 'output', sourceId: 'source', targetId: 'hw_out' },
        parameters: [],
        ...overrides,
    };
}

describe('agent runtime graph boundary', () => {
    it('compiles a bounded immutable output delta with exact device order and parameter ids', () => {
        const result = compileRuntimeGraphDelta(createDelta());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'set-track-output') {
            return;
        }
        expect(result.delta.nodes[0]?.devices.map((device) => device.id)).toEqual(['compressor']);
        expect(result.delta.nodes[0]?.devices.map((device) => device.type)).toEqual(['builtin-compressor']);
        expect(result.delta.nodes[0]?.devices[0]?.parameterIds).toEqual(['attack', 'ratio']);
        expect(Object.isFrozen(result.delta)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes)).toBe(true);
        expect(Object.isFrozen(result.delta.nodes[0]?.devices)).toBe(true);
    });

    it('compiles an immutable device-chain add with exact before and after topology', () => {
        const result = compileRuntimeGraphDelta(createDeviceChainDelta());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'replace-track-device-chain') {
            return;
        }
        expect(result.delta.before.devices.map((device) => device.id)).toEqual(['eq-1']);
        expect(result.delta.after.devices.map((device) => device.id)).toEqual(['eq-1', 'compressor-1']);
        expect(Object.isFrozen(result.delta.before.devices)).toBe(true);
        expect(Object.isFrozen(result.delta.after.devices[1]?.parameterIds)).toBe(true);
    });

    it('compiles one immutable baseline snapshot with exact output and device schema', () => {
        const result = compileRuntimeGraphDelta(createTrackStripInitialization());

        expect(result.status).toBe('compiled');
        if (result.status !== 'compiled' || result.delta.command !== 'initialize-track-strip') {
            return;
        }
        expect(result.delta.nodes[0]?.devices.map((device) => device.id)).toEqual(['compressor']);
        expect(result.delta.output).toEqual({ kind: 'output', sourceId: 'source', targetId: 'hw_out' });
        expect(Object.isFrozen(result.delta)).toBe(true);
        expect(Object.isFrozen(result.delta.output)).toBe(true);
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

    it.each([
        [
            'duplicate device identity',
            createDeviceChainDelta({
                after: {
                    ...createDeviceChainDelta().after,
                    devices: [
                        { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                        { id: 'eq-1', type: 'compressor', parameterIds: [] },
                    ],
                },
            }),
        ],
        [
            'unsorted parameter schema',
            createDeviceChainDelta({
                after: {
                    ...createDeviceChainDelta().after,
                    devices: [
                        { id: 'eq-1', type: 'eq', parameterIds: ['frequency'] },
                        { id: 'compressor-1', type: 'compressor', parameterIds: ['ratio', 'attack'] },
                    ],
                },
            }),
        ],
        [
            'operation does not match ordered chain',
            createDeviceChainDelta({ operation: 'add-device', after: createDeviceChainDelta().before }),
        ],
        ['extra continuous payload', createDeviceChainDelta({ parameters: [{ id: 'attack', value: 2 }] })],
    ])('rejects malformed device-chain proposals before live mutation: %s', (_label, delta) => {
        expect(compileRuntimeGraphDelta(delta).status).toBe('invalid');
    });

    it.each([
        [
            'duplicate device identities',
            createTrackStripInitialization({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [
                            { id: 'duplicate', type: 'eq', parameterIds: [] },
                            { id: 'duplicate', type: 'compressor', parameterIds: [] },
                        ],
                    },
                ],
            }),
        ],
        [
            'unsorted parameter schema',
            createTrackStripInitialization({
                nodes: [
                    {
                        id: 'source',
                        kind: 'audio',
                        devices: [{ id: 'compressor', type: 'compressor', parameterIds: ['ratio', 'attack'] }],
                    },
                ],
            }),
        ],
        ['extra continuous payload', createTrackStripInitialization({ parameters: [{ id: 'attack', value: 2 }] })],
        [
            'malformed output binding',
            createTrackStripInitialization({ output: { kind: 'output', sourceId: 'source', targetId: 'source' } }),
        ],
    ])('rejects malformed initialization snapshots before a live strip can publish: %s', (_label, snapshot) => {
        expect(compileRuntimeGraphDelta(snapshot).status).toBe('invalid');
    });
});
