import { describe, expect, it, vi } from 'vitest';

import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../../engine/TrackNode';
import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';
import {
    createRuntimeOutputDeltaApplication,
    type RuntimeOutputDeltaPorts,
} from '../createRuntimeOutputDeltaApplication';

import type { RuntimeGraphOutputDelta } from '../../../models/RuntimeGraphDelta';

function createFakeTrackNode(trackId: string) {
    return {
        strip: { trackId, deviceNodes: [] },
        setOutput: vi.fn((_targetId: string) => true),
    };
}

type FakeTrackNode = ReturnType<typeof createFakeTrackNode>;

function createDelta(targetId: string, appRevision = 0): RuntimeGraphOutputDelta {
    const isTerminal = targetId === 'master' || targetId === 'hw_out';
    const source = { id: 'track-1', kind: 'audio', devices: [] } as const;
    const target = { id: targetId, kind: 'bus', devices: [] } as const;
    return {
        schemaVersion: 1,
        command: 'set-track-output',
        correlation: { appRevision, projectRevision: 'p-1' },
        nodes: isTerminal ? [source] : [source, target],
        edges: [{ kind: 'output', sourceId: 'track-1', targetId }],
        parameters: [],
    };
}

function createFixture(initialNodes: FakeTrackNode[]) {
    const revision = createRuntimeGraphRevision();
    const nodes = new Map(initialNodes.map((node) => [node.strip.trackId, node]));
    const mutateRuntimeGraph = vi.spyOn(revision, 'mutate');
    const hasOutputDestination = vi.fn(
        (outputId: string) => outputId === 'master' || outputId === 'hw_out' || nodes.has(outputId)
    );
    const ports: RuntimeOutputDeltaPorts = {
        readRevision: revision.current,
        readProjectRevisionValidator: revision.projectRevisionValidator,
        readTopologyValidator: revision.topologyValidator,
        mutateRuntimeGraph: revision.mutate,
        readTrackNode: (trackId) => nodes.get(trackId) as unknown as TrackNode | undefined,
        hasOutputDestination,
    };
    return { apply: createRuntimeOutputDeltaApplication(ports), revision, mutateRuntimeGraph, hasOutputDestination };
}

describe('createRuntimeOutputDeltaApplication', () => {
    it('routes the source to its target and publishes one generation', () => {
        const source = createFakeTrackNode('track-1');
        const { apply, revision } = createFixture([source, createFakeTrackNode('bus-1')]);
        const delta = createDelta('bus-1');

        expect(apply(delta)).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            correlation: delta.correlation,
            runtimeRevision: 1,
        });
        expect(source.setOutput).toHaveBeenCalledExactlyOnceWith('bus-1');
        expect(revision.current()).toBe(1);
    });

    it('holds the revision when the source already routes there', () => {
        const source = createFakeTrackNode('track-1');
        source.setOutput.mockReturnValue(false);
        const { apply, revision } = createFixture([source]);

        expect(apply(createDelta('master'))).toMatchObject({ application: 'applied', runtimeRevision: 0 });
        expect(revision.current()).toBe(0);
    });

    it('refuses a stale engine revision before checking the destination', () => {
        const source = createFakeTrackNode('track-1');
        const { apply, hasOutputDestination, mutateRuntimeGraph } = createFixture([source]);

        expect(apply(createDelta('master', 4))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta is stale for the live engine revision',
        });
        expect(hasOutputDestination).not.toHaveBeenCalled();
        expect(mutateRuntimeGraph).not.toHaveBeenCalled();
    });

    it('asks for reconciliation at the current revision when the destination strip is missing', () => {
        const source = createFakeTrackNode('track-1');
        const { apply, mutateRuntimeGraph } = createFixture([source]);
        const delta = createDelta('bus-1');

        expect(apply(delta)).toEqual({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            correlation: delta.correlation,
            reason: 'Live destination strip does not match the compiled graph delta',
            runtimeRevision: 0,
        });
        expect(mutateRuntimeGraph).not.toHaveBeenCalled();
        expect(source.setOutput).not.toHaveBeenCalled();
    });

    it('rejects a missing source strip without touching the graph', () => {
        const { apply, mutateRuntimeGraph } = createFixture([]);

        expect(apply(createDelta('master'))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live source strip does not match the compiled graph delta',
        });
        expect(mutateRuntimeGraph).not.toHaveBeenCalled();
    });

    it('rejects a restored live refusal without advancing', () => {
        const source = createFakeTrackNode('track-1');
        source.setOutput.mockImplementation(() => {
            throw new RuntimeGraphMutationRejected('output restored', new Error('connect failed'));
        });
        const { apply, revision } = createFixture([source]);

        expect(apply(createDelta('master'))).toMatchObject({ acceptance: 'rejected', reason: 'output restored' });
        expect(revision.current()).toBe(0);
    });

    it('advances and asks for reconciliation when the live edit fails after taking effect', () => {
        const source = createFakeTrackNode('track-1');
        source.setOutput.mockImplementation(() => {
            throw new RuntimeGraphMutationFailure(
                { application: 'needs-reconcile', reason: 'output half moved' },
                new Error('connect failed')
            );
        });
        const { apply, revision } = createFixture([source]);

        expect(apply(createDelta('master'))).toMatchObject({
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'output half moved',
            runtimeRevision: 1,
        });
        expect(revision.current()).toBe(1);
    });
});
