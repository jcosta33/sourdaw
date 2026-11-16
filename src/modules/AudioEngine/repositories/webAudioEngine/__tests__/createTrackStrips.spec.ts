import { describe, expect, it, vi } from 'vitest';

import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';
import { createTrackStrips, type TrackStripsPorts } from '../createTrackStrips';

vi.mock('../../../engine/TrackNode', async (importActual) => {
    const actual = await importActual<typeof import('../../../engine/TrackNode')>();
    class FakeTrackNode {
        readonly strip: { outputId: string | undefined; deviceNodes: Array<{ deviceId: string }>; gainNode: object };
        nativeCarried = false;
        readonly dispose = vi.fn();
        readonly disposeLeavingProject = vi.fn();
        readonly setMute = vi.fn();
        constructor(readonly trackId: string) {
            this.strip = { outputId: undefined, deviceNodes: [], gainNode: { trackId } };
        }
        setNativeCarried(carried: boolean): void {
            this.nativeCarried = carried;
        }
        setOutput(outputId: string): boolean {
            const changed = this.strip.outputId !== outputId;
            this.strip.outputId = outputId;
            return changed;
        }
    }
    return { ...actual, TrackNode: FakeTrackNode };
});

vi.mock('../../../engine/BusNode', () => ({
    BusNode: class {
        readonly dispose = vi.fn();
        readonly strip: { busId: string };
        constructor(busId: string) {
            this.strip = { busId };
        }
    },
}));

type FakeNode = {
    strip: { outputId: string | undefined; deviceNodes: Array<{ deviceId: string }> };
    nativeCarried: boolean;
    dispose: ReturnType<typeof vi.fn>;
    disposeLeavingProject: ReturnType<typeof vi.fn>;
    setMute: ReturnType<typeof vi.fn>;
};

function createStrips(overrides: Partial<TrackStripsPorts> = {}) {
    const order: string[] = [];
    const runtimeGraph = createRuntimeGraphRevision();
    const ports: TrackStripsPorts = {
        lifecycle: {
            context: () => ({ createGain: () => ({}) }) as unknown as AudioContext,
            master: () => ({ gainNode: {} }) as unknown as ReturnType<TrackStripsPorts['lifecycle']['master']>,
            isFallback: () => false,
            assertActive: () => {},
        },
        runtimeGraph,
        sends: {
            sendsForTrack: () => [],
            reconnectTrack: vi.fn(),
            removeSendsFromTrack: (trackId) => order.push(`sends-from:${trackId}`),
            removeSendsToBus: (busId) => order.push(`sends-to:${busId}`),
        },
        sidechains: {
            reconnectTrack: vi.fn(),
            forgetPendingRoutesOf: (trackId) => order.push(`forget-pending:${trackId}`),
            removeConnectionsOf: (trackId) => order.push(`sidechains-of:${trackId}`),
        },
        toasterPads: {
            reconcileParent: vi.fn(),
            handleDeviceRemoved: vi.fn(),
            forgetRoutesOfRemovedStrip: (trackId) => order.push(`pads-of:${trackId}`),
            snapshotRoute: () => undefined,
            updateBinding: () => false,
            restoreBinding: vi.fn(),
        },
        deviceReadinessDiagnostics: {} as TrackStripsPorts['deviceReadinessDiagnostics'],
        deviceCollaborators: {} as TrackStripsPorts['deviceCollaborators'],
        readTransportBuffer: () => null,
        getAdjustmentBusForTrack: () => null,
        ensureTrackStripThroughEngine: vi.fn(),
        ...overrides,
    };
    const strips = createTrackStrips(ports);
    function node(trackId: string): FakeNode {
        const found = strips.trackNodes.get(trackId);
        if (!found) {
            throw new Error(`No strip for ${trackId}`);
        }
        return found as unknown as FakeNode;
    }
    return { strips, order, runtimeGraph, ports, node };
}

describe('createTrackStrips', () => {
    it('forgets queued routes of an absent strip without publishing a revision', () => {
        const { strips, order, runtimeGraph } = createStrips();

        strips.removeTrackStrip('ghost');

        expect(order).toEqual(['forget-pending:ghost', 'pads-of:ghost']);
        expect(runtimeGraph.current()).toBe(0);
    });

    it('sweeps the removed strip routing, reroutes its sources to hw_out and takes its devices out', () => {
        const { strips, order, runtimeGraph, node } = createStrips();
        strips.ensureTrackStrip('target');
        strips.ensureTrackStrip('source');
        strips.setTrackOutput('source', 'target');
        const target = node('target');
        const revisionBefore = runtimeGraph.current();

        strips.removeTrackStrip('target');

        expect(order).toEqual(['forget-pending:target', 'pads-of:target', 'sends-from:target', 'sidechains-of:target']);
        expect(node('source').strip.outputId).toBe('hw_out');
        expect(target.disposeLeavingProject).toHaveBeenCalledOnce();
        expect(target.dispose).not.toHaveBeenCalled();
        expect(strips.getTrackStrip('target')).toBeUndefined();
        expect(runtimeGraph.current()).toBe(revisionBefore + 1);
    });

    it('keeps the devices of a deactivated strip in the project', () => {
        const { strips, node } = createStrips();
        strips.ensureTrackStrip('folder');
        const folder = node('folder');

        strips.deactivateTrackStrip('folder');

        expect(folder.dispose).toHaveBeenCalledOnce();
        expect(folder.disposeLeavingProject).not.toHaveBeenCalled();
    });

    it('removes the sends into a bus before its backing strip', () => {
        const { strips, order } = createStrips();
        strips.ensureBusStrip('bus');
        order.length = 0;

        strips.removeBusStrip('bus');

        expect(order.slice(0, 2)).toEqual(['sends-to:bus', 'forget-pending:bus']);
        expect(strips.busNodes.has('bus')).toBe(false);
        expect(strips.trackNodes.has('bus')).toBe(false);
    });

    it('hands the native-carried set to strips created later, until a reset forgets it', () => {
        const { strips, node } = createStrips();
        strips.ensureTrackStrip('a');
        strips.setNativeCarriedTracks(new Set(['a', 'b']));
        strips.ensureTrackStrip('b');

        expect([node('a').nativeCarried, node('b').nativeCarried]).toEqual([true, true]);

        strips.forgetNativeCarriedTracks();
        strips.ensureTrackStrip('c');
        expect(node('c').nativeCarried).toBe(false);
    });

    it('ensures the strip through the assembled engine before muting it', () => {
        const ensureTrackStripThroughEngine = vi.fn();
        const { strips, node } = createStrips({ ensureTrackStripThroughEngine });
        strips.ensureTrackStrip('t1');

        strips.setTrackMute('t1', true);

        expect(ensureTrackStripThroughEngine).toHaveBeenCalledExactlyOnceWith('t1');
        expect(node('t1').setMute).toHaveBeenCalledExactlyOnceWith(true);
    });

    it('refuses an output route to an absent destination and leaves the output alone', () => {
        const { strips, runtimeGraph, node } = createStrips();
        strips.ensureTrackStrip('t1');
        const revisionBefore = runtimeGraph.current();

        strips.setTrackOutput('t1', 'missing');

        expect(node('t1').strip.outputId).toBeUndefined();
        expect(runtimeGraph.current()).toBe(revisionBefore);
    });

    it('publishes no revision for a strip built on the fallback graph', () => {
        const { strips, runtimeGraph, ports } = createStrips();
        const fallback = createTrackStrips({ ...ports, lifecycle: { ...ports.lifecycle, isFallback: () => true } });

        fallback.ensureTrackStrip('t1');
        strips.ensureTrackStrip('t2');

        expect(fallback.trackNodes.has('t1')).toBe(true);
        expect(runtimeGraph.current()).toBe(1);
    });
});
