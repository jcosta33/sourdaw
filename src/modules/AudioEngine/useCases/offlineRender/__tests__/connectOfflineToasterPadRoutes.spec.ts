import { describe, expect, it, vi } from 'vitest';

import { type DeviceNodeEntry } from '../../buildDeviceChain';
import { connectOfflineToasterPadRoutes } from '../connectOfflineToasterPadRoutes';

import type { OfflineTrackStrip } from '../types';

type RouteTrack = Parameters<typeof connectOfflineToasterPadRoutes>[0]['tracks'][number];
type ConnectPadOutput = NonNullable<DeviceNodeEntry['strategy']['connectPadOutput']>;
type SetPadDryRouted = NonNullable<DeviceNodeEntry['strategy']['setPadDryRouted']>;

function track(id: string, parentId: string | null = null, deviceType?: string): RouteTrack {
    return { id, parentId, devices: deviceType ? [{ type: deviceType }] : [] };
}

function strip(inputNode: AudioNode): OfflineTrackStrip {
    return { inputNode } as OfflineTrackStrip;
}

function toasterEntry(connectPadOutput: ConnectPadOutput, setPadDryRouted: SetPadDryRouted): DeviceNodeEntry {
    const audioNode = {} as AudioNode;
    const node: DeviceNodeEntry['node'] = { inputNode: audioNode, outputNode: audioNode, nodes: [audioNode] };
    return {
        deviceId: 'toaster-device',
        deviceType: 'toaster',
        node,
        strategy: {
            node,
            acceptsNotes: true,
            setParam: vi.fn<(name: string, value: number) => void>(),
            resolveOfflineAutomation: () => null,
            connectPadOutput,
            setPadDryRouted,
        },
    };
}

describe('connectOfflineToasterPadRoutes', () => {
    it('routes all sixteen pad outputs into their child strips before transferring dry ownership', () => {
        const parent = track('parent', null, 'toaster');
        const children = Array.from({ length: 16 }, (_, index) => track(`pad-${index}`, parent.id));
        const connectPadOutput = vi.fn<ConnectPadOutput>();
        const setPadDryRouted = vi.fn<SetPadDryRouted>();
        const destinations = children.map(() => ({}) as AudioNode);
        const trackStripsById = new Map(children.map((child, index) => [child.id, strip(destinations[index]!)]));

        connectOfflineToasterPadRoutes({
            tracks: [parent, ...children],
            trackStripsById,
            deviceEntriesByTrack: new Map([[parent.id, [toasterEntry(connectPadOutput, setPadDryRouted)]]]),
        });

        for (let padIndex = 0; padIndex < 16; padIndex++) {
            expect(connectPadOutput).toHaveBeenNthCalledWith(padIndex + 1, padIndex, destinations[padIndex]);
            expect(setPadDryRouted).toHaveBeenNthCalledWith(padIndex + 1, padIndex, true);
            expect(connectPadOutput.mock.invocationCallOrder[padIndex]).toBeLessThan(
                setPadDryRouted.mock.invocationCallOrder[padIndex]!
            );
        }
    });

    it('does not surrender parent dry ownership without a complete child route', () => {
        const parent = track('parent', null, 'toaster');
        const child = track('child', parent.id);
        const setPadDryRouted = vi.fn<SetPadDryRouted>();

        connectOfflineToasterPadRoutes({
            tracks: [parent, child],
            trackStripsById: new Map([[child.id, strip({} as AudioNode)]]),
            deviceEntriesByTrack: new Map([[parent.id, [toasterEntry(vi.fn<ConnectPadOutput>(), setPadDryRouted)]]]),
        });
        expect(setPadDryRouted).toHaveBeenCalledWith(0, true);

        setPadDryRouted.mockClear();
        connectOfflineToasterPadRoutes({
            tracks: [parent, child],
            trackStripsById: new Map(),
            deviceEntriesByTrack: new Map([[parent.id, [toasterEntry(vi.fn<ConnectPadOutput>(), setPadDryRouted)]]]),
        });
        expect(setPadDryRouted).not.toHaveBeenCalled();
    });

    it('preserves pad indexes when an earlier sibling has no render strip', () => {
        const parent = track('parent', null, 'toaster');
        const first = track('pad-0', parent.id);
        const second = track('pad-1', parent.id);
        const connectPadOutput = vi.fn<ConnectPadOutput>();
        const setPadDryRouted = vi.fn<SetPadDryRouted>();
        const secondInput = {} as AudioNode;

        connectOfflineToasterPadRoutes({
            tracks: [parent, first, second],
            trackStripsById: new Map([[second.id, strip(secondInput)]]),
            deviceEntriesByTrack: new Map([[parent.id, [toasterEntry(connectPadOutput, setPadDryRouted)]]]),
        });

        expect(connectPadOutput).toHaveBeenCalledWith(1, secondInput);
        expect(setPadDryRouted).toHaveBeenCalledWith(1, true);
    });
});
