import { describe, expect, it, vi } from 'vitest';

import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../../engine/TrackNode';
import {
    createRuntimeDeviceChainDeltaApplication,
    type RuntimeDeviceChainDeltaPorts,
} from '../createRuntimeDeviceChainDeltaApplication';
import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';

import type { RuntimeGraphDeviceChainDelta, RuntimeGraphDeltaNode } from '../../../models/RuntimeGraphDelta';

const EQ = { id: 'eq-1', type: 'equalizer', parameterIds: ['gain'] } as const;

function createFakeTrackNode(trackId: string, devices: RuntimeGraphDeltaNode['devices']) {
    return {
        strip: {
            trackId,
            deviceNodes: devices.map((device) => ({
                deviceId: device.id,
                type: device.type,
                parameterIds: device.parameterIds,
            })),
        },
        applyDeviceChain: vi.fn((_delta: RuntimeGraphDeviceChainDelta) => true),
    };
}

type FakeTrackNode = ReturnType<typeof createFakeTrackNode>;

function createDelta(
    before: RuntimeGraphDeltaNode['devices'],
    after: RuntimeGraphDeltaNode['devices'],
    appRevision = 0
): RuntimeGraphDeviceChainDelta {
    return {
        schemaVersion: 1,
        command: 'replace-track-device-chain',
        correlation: { appRevision, projectRevision: 'p-1' },
        operation: 'replace-device-chain',
        before: { id: 'track-1', kind: 'audio', devices: before },
        after: { id: 'track-1', kind: 'audio', devices: after },
        parameters: [],
    };
}

function createFixture(initialNodes: FakeTrackNode[] = []) {
    const revision = createRuntimeGraphRevision();
    const nodes = new Map(initialNodes.map((node) => [node.strip.trackId, node]));
    const ensureTrackStripInGraph = vi.fn((trackId: string) => {
        nodes.set(trackId, createFakeTrackNode(trackId, []));
    });
    const readTrackNode = vi.fn((trackId: string) => nodes.get(trackId) as unknown as TrackNode | undefined);
    const ports: RuntimeDeviceChainDeltaPorts = {
        readRevision: revision.current,
        readProjectRevisionValidator: revision.projectRevisionValidator,
        readTopologyValidator: revision.topologyValidator,
        mutateRuntimeGraph: revision.mutate,
        readTrackNode,
        ensureTrackStripInGraph,
    };
    return { apply: createRuntimeDeviceChainDeltaApplication(ports), revision, readTrackNode, ensureTrackStripInGraph };
}

describe('createRuntimeDeviceChainDeltaApplication', () => {
    it('applies a changed chain to the live source and publishes one generation', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        const { apply, revision } = createFixture([source]);
        const delta = createDelta([EQ], []);

        const result = apply(delta);

        expect(source.applyDeviceChain).toHaveBeenCalledExactlyOnceWith(delta);
        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            correlation: delta.correlation,
            runtimeRevision: 1,
        });
        expect(revision.current()).toBe(1);
    });

    it('applies nothing new and holds the revision when the live chain already matches', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        source.applyDeviceChain.mockReturnValue(false);
        const { apply, revision } = createFixture([source]);

        const result = apply(createDelta([EQ], [EQ]));

        expect(result).toMatchObject({ application: 'applied', runtimeRevision: 0 });
        expect(revision.current()).toBe(0);
    });

    it('refuses a stale project revision before reading any strip', () => {
        const { apply, revision, readTrackNode, ensureTrackStripInGraph } = createFixture([
            createFakeTrackNode('track-1', [EQ]),
        ]);
        revision.setProjectRevisionValidator(() => false);

        const result = apply(createDelta([EQ], []));

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta is stale for the current project revision',
        });
        expect(readTrackNode).not.toHaveBeenCalled();
        expect(ensureTrackStripInGraph).not.toHaveBeenCalled();
    });

    it('hands the topology validator the post-operation node', () => {
        const topologyValidator = vi.fn(() => true);
        const { apply, revision } = createFixture([createFakeTrackNode('track-1', [EQ])]);
        revision.setTopologyValidator(topologyValidator);
        const delta = createDelta([EQ], []);

        apply(delta);

        expect(topologyValidator).toHaveBeenCalledExactlyOnceWith([delta.after]);
    });

    it('creates a missing empty source strip without publishing, then applies to it', () => {
        const { apply, revision, ensureTrackStripInGraph } = createFixture();

        const result = apply(createDelta([], [EQ]));

        expect(ensureTrackStripInGraph).toHaveBeenCalledExactlyOnceWith('track-1');
        expect(result).toMatchObject({ application: 'applied', runtimeRevision: 1 });
        expect(revision.current()).toBe(1);
    });

    it('rejects a missing source that the delta expects to hold devices, creating nothing', () => {
        const { apply, ensureTrackStripInGraph } = createFixture();

        const result = apply(createDelta([EQ], []));

        expect(result).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live source strip does not match the compiled device-chain delta',
        });
        expect(ensureTrackStripInGraph).not.toHaveBeenCalled();
    });

    it('rejects a restored live refusal without advancing', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        source.applyDeviceChain.mockImplementation(() => {
            throw new RuntimeGraphMutationRejected('chain restored', new Error('load failed'));
        });
        const { apply, revision } = createFixture([source]);

        expect(apply(createDelta([EQ], []))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'chain restored',
        });
        expect(revision.current()).toBe(0);
    });

    it('advances and asks for reconciliation when a live edit fails after taking effect', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        source.applyDeviceChain.mockImplementation(() => {
            throw new RuntimeGraphMutationFailure(
                { application: 'needs-reconcile', reason: 'chain half rebuilt' },
                new Error('connect failed'),
                new Error('restore failed')
            );
        });
        const { apply, revision } = createFixture([source]);
        const delta = createDelta([EQ], []);

        expect(apply(delta)).toEqual({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'failed',
            correlation: delta.correlation,
            reason: 'chain half rebuilt',
            runtimeRevision: 1,
        });
        expect(revision.current()).toBe(1);
    });

    it('reports compensation as not attempted when a typed failure carries no rollback error', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        source.applyDeviceChain.mockImplementation(() => {
            throw new RuntimeGraphMutationFailure(
                { application: 'needs-reconcile', reason: 'chain half rebuilt' },
                new Error('connect failed')
            );
        });
        const { apply } = createFixture([source]);

        expect(apply(createDelta([EQ], []))).toMatchObject({
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'chain half rebuilt',
        });
    });

    it('names an untyped live throw in the reconciliation reason', () => {
        const source = createFakeTrackNode('track-1', [EQ]);
        source.applyDeviceChain.mockImplementation(() => {
            throw new Error('boom');
        });
        const { apply } = createFixture([source]);

        expect(apply(createDelta([EQ], []))).toMatchObject({
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            reason: 'Live device-chain application threw: Error: boom',
        });
    });
});
