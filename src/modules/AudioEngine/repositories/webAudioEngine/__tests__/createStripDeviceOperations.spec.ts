import { describe, expect, it, vi } from 'vitest';

import { createRuntimeGraphRevision } from '../createRuntimeGraphRevision';
import { createStripDeviceOperations, type StripDeviceOperationsPorts } from '../createStripDeviceOperations';

import type { TrackNode } from '../../../engine/TrackNode';
import type { TrackChannelStrip } from '../../../models/AudioEngineState';

type FakeDevice = {
    deviceId: string;
    outputNode?: object;
    toasterControls?: object;
    controller?: { allNotesOff?: () => void; reset?: () => void };
};

function fakeTrackNode(devices: FakeDevice[], overrides: Record<string, unknown> = {}): TrackNode {
    return {
        strip: { deviceNodes: devices },
        updateParam: vi.fn(),
        addDevice: vi.fn(() => true),
        ...overrides,
    } as unknown as TrackNode;
}

function createOperations(trackNodes: Map<string, TrackNode>, overrides: Partial<StripDeviceOperationsPorts> = {}) {
    const runtimeGraph = createRuntimeGraphRevision();
    const operations = createStripDeviceOperations({
        isFallback: () => false,
        runtimeGraph,
        trackNodes,
        ensureTrackStripInGraph: () => ({ value: {} as TrackChannelStrip, changed: false }),
        pendingDevicePromises: new Set(),
        deviceReadinessDiagnostics: {} as StripDeviceOperationsPorts['deviceReadinessDiagnostics'],
        ...overrides,
    });
    return { operations, runtimeGraph };
}

describe('createStripDeviceOperations', () => {
    it('drops every device write on the fallback graph', () => {
        const track = fakeTrackNode([]);
        const { operations } = createOperations(new Map([['t1', track]]), { isFallback: () => true });

        operations.updateDeviceParam('t1', 'd1', 'gain', 0.5);
        operations.addDeviceToStrip({ trackId: 't1', deviceId: 'd1', deviceType: 'builtin-eq' });

        expect(track.updateParam).not.toHaveBeenCalled();
        expect(track.addDevice).not.toHaveBeenCalled();
    });

    it('publishes the strip it created when the device insert then throws, and rethrows', () => {
        const fault = new Error('insert failed');
        const track = fakeTrackNode([], {
            addDevice: () => {
                throw fault;
            },
        });
        const { operations, runtimeGraph } = createOperations(new Map([['t1', track]]), {
            ensureTrackStripInGraph: () => ({ value: {} as TrackChannelStrip, changed: true }),
        });

        expect(() => operations.addDeviceToStrip({ trackId: 't1', deviceId: 'd1', deviceType: 'builtin-eq' })).toThrow(
            fault
        );
        expect(runtimeGraph.current()).toBe(1);
    });

    it('publishes nothing when the insert throws on a strip that already existed', () => {
        const track = fakeTrackNode([], {
            addDevice: () => {
                throw new Error('insert failed');
            },
        });
        const { operations, runtimeGraph } = createOperations(new Map([['t1', track]]));

        expect(() => operations.addDeviceToStrip({ trackId: 't1', deviceId: 'd1', deviceType: 'builtin-eq' })).toThrow(
            'insert failed'
        );
        expect(runtimeGraph.current()).toBe(0);
    });

    it('walks on to the next strip when the first node with the id carries no Toaster controls', () => {
        const controls = { pad: 1 };
        const { operations } = createOperations(
            new Map([
                ['t1', fakeTrackNode([{ deviceId: 'd1', outputNode: { at: 't1' } }])],
                ['t2', fakeTrackNode([{ deviceId: 'd1', toasterControls: controls }])],
            ])
        );

        expect(operations.findToasterControls('d1')).toBe(controls);
        expect(operations.findDeviceOutputNode('d1')).toEqual({ at: 't1' });
        expect(operations.findDeviceOutputNode('missing')).toBeNull();
        expect(operations.findLufsMeterReading('d1')).toBeNull();
    });

    it('releases held notes and resets every device controller on every strip', () => {
        const first = { allNotesOff: vi.fn(), reset: vi.fn() };
        const second = { allNotesOff: vi.fn() };
        const { operations } = createOperations(
            new Map([
                ['t1', fakeTrackNode([{ deviceId: 'a', controller: first }, { deviceId: 'b' }])],
                ['t2', fakeTrackNode([{ deviceId: 'c', controller: second }])],
            ])
        );

        operations.releaseHeldNotes();

        expect(first.allNotesOff).toHaveBeenCalledOnce();
        expect(first.reset).toHaveBeenCalledOnce();
        expect(second.allNotesOff).toHaveBeenCalledOnce();
    });

    it('reports ready at once when no device load is pending', async () => {
        const { operations } = createOperations(new Map());

        await expect(operations.waitForDevices()).resolves.toEqual({ status: 'ready', devices: [] });
    });
});
