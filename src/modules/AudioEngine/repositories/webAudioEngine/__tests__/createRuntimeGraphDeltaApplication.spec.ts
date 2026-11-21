import { describe, expect, it, vi } from 'vitest';

import { createRuntimeGraphDeltaApplication } from '../createRuntimeGraphDeltaApplication';
import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';

import type { TrackNode } from '../../../engine/TrackNode';

const CORRELATION = { appRevision: 0, projectRevision: 'p-1' };
const SOURCE_NODE = { id: 'track-1', kind: 'audio', devices: [] };

const OUTPUT_INPUT = {
    schemaVersion: 1,
    command: 'set-track-output',
    correlation: CORRELATION,
    nodes: [SOURCE_NODE],
    edges: [{ kind: 'output', sourceId: 'track-1', targetId: 'master' }],
    parameters: [],
};

const INITIALIZATION_INPUT = {
    schemaVersion: 1,
    command: 'initialize-track-strip',
    correlation: CORRELATION,
    nodes: [SOURCE_NODE],
    output: { kind: 'output', sourceId: 'track-1', targetId: 'master' },
    parameters: [],
};

function createFixture() {
    const revision = createRuntimeGraphRevision();
    const source = {
        trackId: 'track-1',
        strip: { trackId: 'track-1', deviceNodes: [] },
        setOutput: vi.fn(() => true),
        applyDeviceChain: vi.fn(() => true),
    };
    const nodes = new Map<string, unknown>();
    const createTrackNode = vi.fn(() => source as unknown as TrackNode);
    const application = createRuntimeGraphDeltaApplication({
        readRevision: revision.current,
        readProjectRevisionValidator: revision.projectRevisionValidator,
        readTopologyValidator: revision.topologyValidator,
        mutateRuntimeGraph: revision.mutate,
        isFallback: () => false,
        readTrackNode: (trackId) => nodes.get(trackId) as TrackNode | undefined,
        readToasterPadBinding: () => undefined,
        hasOutputDestination: (outputId) => outputId === 'master',
        ensureTrackStripInGraph: vi.fn(),
        createTrackNode,
        registerTrackNode: (trackId, node) => {
            nodes.set(trackId, node);
        },
        unregisterTrackNode: (trackId) => {
            nodes.delete(trackId);
        },
        setTrackOutputTransaction: () => ({ value: undefined, changed: true }),
    });
    return { application, revision, source, nodes, createTrackNode };
}

describe('createRuntimeGraphDeltaApplication', () => {
    it('refuses input the compiler rejects, with the compiler reason', () => {
        const { application, revision } = createFixture();

        expect(application.apply({ schemaVersion: 2 })).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime graph delta schema version or command is unsupported',
        });
        expect(revision.current()).toBe(0);
    });

    it('dispatches an output delta to the output edge', () => {
        const { application, source, nodes } = createFixture();
        nodes.set('track-1', source);

        expect(application.apply(OUTPUT_INPUT)).toMatchObject({ application: 'applied', runtimeRevision: 1 });
        expect(source.setOutput).toHaveBeenCalledExactlyOnceWith('master');
        expect(source.applyDeviceChain).not.toHaveBeenCalled();
    });

    it('dispatches an initialization snapshot to strip initialization', () => {
        const { application, createTrackNode } = createFixture();

        expect(application.apply(INITIALIZATION_INPUT)).toMatchObject({ application: 'applied', runtimeRevision: 1 });
        expect(createTrackNode).toHaveBeenCalledExactlyOnceWith('track-1');
    });

    it('initializes a strip from a snapshot entrypoint', () => {
        const { application, nodes } = createFixture();

        expect(application.initializeTrackStripFromSnapshot(INITIALIZATION_INPUT)).toMatchObject({
            application: 'applied',
            runtimeRevision: 1,
        });
        expect(nodes.has('track-1')).toBe(true);
    });

    it('refuses any other command at the snapshot entrypoint without touching the graph', () => {
        const { application, source, nodes, revision } = createFixture();
        nodes.set('track-1', source);

        expect(application.initializeTrackStripFromSnapshot(OUTPUT_INPUT)).toEqual({
            acceptance: 'rejected',
            application: 'not-applied',
            reason: 'Runtime strip initialization requires an initialization snapshot',
        });
        expect(source.setOutput).not.toHaveBeenCalled();
        expect(revision.current()).toBe(0);
    });
});
