import { beforeEach, describe, expect, it, vi } from 'vitest';

import { notifyUser } from '#/utils/Notification/notifyUser';

import { RuntimeGraphMutationFailure, RuntimeGraphMutationRejected, type TrackNode } from '../../../engine/TrackNode';
import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';
import {
    createRuntimeTrackStripInitialization,
    type RuntimeTrackStripInitializationPorts,
} from '../createRuntimeTrackStripInitialization';

import type {
    RuntimeGraphDeltaDevice,
    RuntimeGraphInitializationOutput,
    RuntimeGraphTrackStripInitializationDelta,
} from '../../../models/RuntimeGraphDelta';
import type { ToasterPadBinding } from '../createToasterPadRouting';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/infra/release/deviceReleaseAdmission', () => ({
    isDeviceReleaseAdmitted: (deviceType: string) => deviceType !== 'withheld-device',
}));

const EQ: RuntimeGraphDeltaDevice = { id: 'eq-1', type: 'equalizer', parameterIds: ['gain'] };

function createFakeTrackNode(trackId: string, devices: readonly RuntimeGraphDeltaDevice[] = [], outputId?: string) {
    return {
        trackId,
        strip: {
            trackId,
            outputId,
            deviceNodes: devices.map((device) => ({
                deviceId: device.id,
                type: device.type,
                parameterIds: device.parameterIds,
            })),
        },
        addDevice: vi.fn((_id: string, type: string) => type !== 'withheld-device'),
        dispose: vi.fn(),
    };
}

type FakeTrackNode = ReturnType<typeof createFakeTrackNode>;

function createDelta(
    devices: readonly RuntimeGraphDeltaDevice[],
    output: Partial<RuntimeGraphInitializationOutput> = {},
    appRevision = 0
): RuntimeGraphTrackStripInitializationDelta {
    return {
        schemaVersion: 1,
        command: 'initialize-track-strip',
        correlation: { appRevision, projectRevision: 'p-1' },
        nodes: [{ id: 'track-1', kind: 'audio', devices }],
        output: { kind: 'output', sourceId: 'track-1', targetId: 'master', ...output },
        parameters: [],
    };
}

function createFixture(initialNodes: FakeTrackNode[] = [], padBindings = new Map<string, ToasterPadBinding>()) {
    const revision = createRuntimeGraphRevision();
    const nodes = new Map<string, FakeTrackNode>(initialNodes.map((node) => [node.trackId, node]));
    const calls: string[] = [];
    let fallback = false;
    const created: FakeTrackNode[] = [];
    const setTrackOutputTransaction = vi.fn(
        (node: TrackNode, outputId: string, _padBinding: ToasterPadBinding | undefined) => {
            calls.push(`output:${node.trackId}->${outputId}`);
            return { value: undefined, changed: true };
        }
    );
    const ports: RuntimeTrackStripInitializationPorts = {
        readRevision: revision.current,
        readProjectRevisionValidator: revision.projectRevisionValidator,
        readTopologyValidator: revision.topologyValidator,
        mutateRuntimeGraph: revision.mutate,
        isFallback: () => fallback,
        readTrackNode: (trackId) => nodes.get(trackId) as unknown as TrackNode | undefined,
        readToasterPadBinding: (trackId) => padBindings.get(trackId),
        hasOutputDestination: (outputId) => outputId === 'master' || outputId === 'hw_out' || nodes.has(outputId),
        createTrackNode: vi.fn((trackId: string) => {
            calls.push(`create:${trackId}`);
            const node = createFakeTrackNode(trackId);
            node.dispose.mockImplementation(() => calls.push(`dispose:${trackId}`));
            created.push(node);
            return node as unknown as TrackNode;
        }),
        registerTrackNode: (trackId, node) => {
            calls.push(`register:${trackId}`);
            nodes.set(trackId, node as unknown as FakeTrackNode);
        },
        unregisterTrackNode: (trackId) => {
            calls.push(`unregister:${trackId}`);
            nodes.delete(trackId);
        },
        setTrackOutputTransaction,
    };
    return {
        initialization: createRuntimeTrackStripInitialization(ports),
        revision,
        nodes,
        calls,
        created,
        ports,
        setTrackOutputTransaction,
        enterFallback: () => {
            fallback = true;
        },
    };
}

describe('createRuntimeTrackStripInitialization', () => {
    beforeEach(() => {
        vi.mocked(notifyUser).mockClear();
    });

    it('builds the strip privately, then registers and routes it, publishing one generation', () => {
        const { initialization, revision, calls, created } = createFixture();
        const delta = createDelta([EQ], { padBinding: { toasterParentTrackId: 'toaster', padIndex: 2 } });

        const result = initialization.apply(delta);

        expect(calls).toEqual(['create:track-1', 'register:track-1', 'output:track-1->master']);
        expect(created[0]?.addDevice).toHaveBeenCalledExactlyOnceWith('eq-1', 'equalizer', undefined, undefined, [
            'gain',
        ]);
        expect(result).toEqual({
            acceptance: 'accepted',
            application: 'applied',
            correlation: delta.correlation,
            runtimeRevision: 1,
        });
        expect(revision.current()).toBe(1);
    });

    it('publishes no generation for a strip built in fallback mode', () => {
        const { initialization, revision, enterFallback } = createFixture();
        enterFallback();

        expect(initialization.apply(createDelta([]))).toMatchObject({ application: 'applied', runtimeRevision: 0 });
        expect(revision.current()).toBe(0);
    });

    it('accepts an existing strip that already matches without building anything', () => {
        const existing = createFakeTrackNode('track-1', [EQ], 'master');
        const { initialization, revision, ports } = createFixture([existing]);
        revision.mutate(() => ({ value: undefined, changed: true }));

        const result = initialization.apply(createDelta([EQ], {}, 1));

        expect(result).toMatchObject({ application: 'applied', runtimeRevision: 1 });
        expect(ports.createTrackNode).not.toHaveBeenCalled();
        expect(revision.current()).toBe(1);
    });

    it('rejects an existing strip whose pad binding differs from the snapshot', () => {
        const existing = createFakeTrackNode('track-1', [EQ], 'master');
        const { initialization } = createFixture(
            [existing],
            new Map([['track-1', { toasterParentTrackId: 'toaster', padIndex: 1 }]])
        );

        expect(initialization.apply(createDelta([EQ]))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live source strip does not match the compiled initialization snapshot',
        });
    });

    it('rejects an existing strip routed to another output than the snapshot, building nothing', () => {
        const existing = createFakeTrackNode('track-1', [EQ], 'bus-1');
        const { initialization, revision, ports } = createFixture([existing]);

        expect(initialization.apply(createDelta([EQ]))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live source strip does not match the compiled initialization snapshot',
        });
        expect(ports.createTrackNode).not.toHaveBeenCalled();
        expect(revision.current()).toBe(0);
    });

    it('refuses a stale project revision before any strip is read or built', () => {
        const { initialization, revision, ports } = createFixture();
        revision.setProjectRevisionValidator(() => false);

        expect(initialization.apply(createDelta([EQ]))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph initialization is stale for the current project revision',
        });
        expect(ports.createTrackNode).not.toHaveBeenCalled();
    });

    it('asks for reconciliation when the output destination strip is missing, building nothing', () => {
        const { initialization, ports } = createFixture();
        const delta = createDelta([], { targetId: 'bus-1' });

        expect(initialization.apply(delta)).toEqual({
            acceptance: 'accepted',
            application: 'needs-reconcile',
            compensation: 'not-attempted',
            correlation: delta.correlation,
            reason: 'Live destination strip does not match the compiled initialization snapshot',
            runtimeRevision: 0,
        });
        expect(ports.createTrackNode).not.toHaveBeenCalled();
    });

    it('unregisters then disposes the private strip and rejects when routing is restored after a failure', () => {
        const { initialization, revision, calls, setTrackOutputTransaction } = createFixture();
        setTrackOutputTransaction.mockImplementation(() => {
            throw new RuntimeGraphMutationRejected('output restored', new Error('pad busy'));
        });

        const result = initialization.apply(createDelta([]));

        expect(calls).toEqual(['create:track-1', 'register:track-1', 'unregister:track-1', 'dispose:track-1']);
        expect(result).toEqual({ acceptance: 'rejected', application: 'not-applied', reason: 'output restored' });
        expect(revision.current()).toBe(0);
    });

    it('asks for reconciliation at the unchanged revision when routing restoration failed', () => {
        const { initialization, revision, setTrackOutputTransaction } = createFixture();
        setTrackOutputTransaction.mockImplementation(() => {
            throw new RuntimeGraphMutationFailure(
                { application: 'needs-reconcile', reason: 'pad half bound' },
                new Error('pad busy'),
                new Error('restore failed')
            );
        });

        expect(initialization.apply(createDelta([]))).toMatchObject({
            application: 'needs-reconcile',
            compensation: 'failed',
            reason: 'pad half bound',
            runtimeRevision: 0,
        });
        expect(revision.current()).toBe(0);
    });

    it('rejects a strip that cannot be created before publication', () => {
        const { initialization, ports, calls } = createFixture();
        vi.mocked(ports.createTrackNode).mockImplementation(() => {
            throw new Error('Audio engine has been disposed.');
        });

        expect(initialization.apply(createDelta([]))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live strip initialization failed before publication: Error: Audio engine has been disposed.',
        });
        expect(calls).toEqual([]);
    });

    it('routes the initialized strip with the delta pad binding', () => {
        const { initialization, setTrackOutputTransaction, created } = createFixture();
        const padBinding = { toasterParentTrackId: 'toaster', padIndex: 2 };

        initialization.apply(createDelta([], { padBinding }));

        expect(setTrackOutputTransaction).toHaveBeenCalledExactlyOnceWith(created[0], 'master', padBinding);
    });

    it('rejects, building nothing, when a live destination strip does not match its compiled snapshot', () => {
        const destination = createFakeTrackNode('bus-1', [], undefined);
        const { initialization, ports } = createFixture([destination]);
        const delta: RuntimeGraphTrackStripInitializationDelta = {
            ...createDelta([], { targetId: 'bus-1' }),
            nodes: [
                { id: 'track-1', kind: 'audio', devices: [] },
                { id: 'bus-1', kind: 'audio', devices: [EQ] },
            ],
        };

        expect(initialization.apply(delta)).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live destination strip does not match the compiled initialization snapshot',
        });
        expect(ports.createTrackNode).not.toHaveBeenCalled();
    });

    it('unregisters and disposes the private strip when adding a device throws before publication', () => {
        const { initialization, ports, revision, calls, nodes } = createFixture();
        vi.mocked(ports.createTrackNode).mockImplementation((trackId: string) => {
            calls.push(`create:${trackId}`);
            const node = createFakeTrackNode(trackId);
            node.addDevice.mockImplementation(() => {
                throw new Error('device load exploded');
            });
            node.dispose.mockImplementation(() => calls.push(`dispose:${trackId}`));
            return node as unknown as TrackNode;
        });

        expect(initialization.apply(createDelta([EQ]))).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Live strip initialization failed before publication: Error: device load exploded',
        });
        expect(calls).toEqual(['create:track-1', 'unregister:track-1', 'dispose:track-1']);
        expect(nodes.has('track-1')).toBe(false);
        expect(revision.current()).toBe(0);
    });

    it('does not match a snapshot that expects no pad binding against a strip that has one', () => {
        const existing = createFakeTrackNode('track-1', [], 'master');
        const { initialization } = createFixture(
            [existing],
            new Map([['track-1', { toasterParentTrackId: 'toaster', padIndex: 0 }]])
        );

        expect(initialization.apply(createDelta([]))).toMatchObject({
            acceptance: 'rejected',
            application: 'not-applied',
        });
    });

    it('warns once per withheld device type until the notices are forgotten', () => {
        const withheld: RuntimeGraphDeltaDevice = { id: 'w-1', type: 'withheld-device', parameterIds: [] };
        const { initialization, nodes } = createFixture();

        initialization.apply(createDelta([withheld]));
        nodes.clear();
        initialization.apply(createDelta([withheld], {}, 1));
        expect(notifyUser).toHaveBeenCalledOnce();

        initialization.forgetWithheldDeviceNotices();
        nodes.clear();
        initialization.apply(createDelta([withheld], {}, 2));
        expect(notifyUser).toHaveBeenCalledTimes(2);
        expect(notifyUser).toHaveBeenLastCalledWith(
            '"withheld-device" is withheld from this build. Its project data is preserved, but it will remain silent.',
            'warning'
        );
    });
});
