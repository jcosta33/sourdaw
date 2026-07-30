import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';

import { prepareOfflineDeviceSetup } from '../prepareOfflineDeviceSetup';

// Only the project read is faked. The Proof use case under test, its chain-order
// decode and the worklet message it posts are all real — the point of this spec
// is that the order the *project* holds is the order that reaches the engine,
// so nothing between the two may be stubbed.
vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/useCases')>();
    return { ...actual, getTrackStoreState: vi.fn() };
});

// Levain's offline setup fetches sample manifests; this spec never exercises it.
vi.mock('#/modules/Levain/useCases', () => ({
    prepareOfflineLevain: vi.fn(() => Promise.resolve()),
}));

type ReorderMessage = { type: string; order: number[] };
type PortSpy = ReturnType<typeof vi.fn<(message: unknown) => void>>;

function makePort(): { port: MessagePort; postMessage: PortSpy } {
    const postMessage = vi.fn<(message: unknown) => void>();
    const port = { postMessage } as unknown as MessagePort;
    return { port, postMessage };
}

function projectWithProofChainOrder(order: readonly number[]): void {
    const parameterValues: Record<string, number> = { lim_ceiling: -0.8 };
    for (const [index, moduleId] of order.entries()) {
        parameterValues[`chain_order_${index}`] = moduleId;
    }

    const track = {
        ...createTrack({ name: 'Master', kind: 'audio' }),
        devices: [{ id: 'proof-1', name: 'Proof Mastering', type: 'proof', bypassed: false, parameterValues }],
    };

    vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [track], selectedTrackId: null });
}

function reorderMessages(postMessage: PortSpy): ReorderMessage[] {
    const messages: ReorderMessage[] = [];
    for (const [message] of postMessage.mock.calls) {
        if (typeof message !== 'object' || message === null) {
            continue;
        }
        if (!('type' in message) || !('order' in message)) {
            continue;
        }
        const { type, order } = message;
        if (typeof type === 'string' && Array.isArray(order)) {
            messages.push({ type, order: order.map(Number) });
        }
    }
    return messages;
}

describe('prepareOfflineDeviceSetup — Proof chain order', () => {
    beforeEach(() => {
        vi.mocked(getTrackStoreState).mockReset();
    });

    // The order lives in `parameterValues` as `chain_order_N`, which the Proof
    // worklet ignores: only a `reorder` message moves its modules. The offline
    // path replayed the params and never sent the message, so every export
    // rendered the default EQ → Dynamics → Imager → Exciter → Limiter regardless
    // of what the project said.
    it('delivers the order the project holds, not the engine default', async () => {
        // Exciter moved after the limiter — saturating past the ceiling instead of
        // into it. Differs from the default [0,1,2,3,4] only in the last two slots,
        // so an implementation that posts the default fails here.
        projectWithProofChainOrder([0, 1, 2, 4, 3]);
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: 'proof-1', deviceType: 'proof', port });

        expect(reorderMessages(postMessage)).toEqual([{ type: 'reorder', order: [0, 1, 2, 4, 3] }]);
    });

    it('carries a fully permuted order through unchanged', async () => {
        projectWithProofChainOrder([4, 3, 0, 2, 1]);
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: 'proof-1', deviceType: 'proof', port });

        expect(reorderMessages(postMessage)).toEqual([{ type: 'reorder', order: [4, 3, 0, 2, 1] }]);
    });

    // A project saved before the order was persisted, or one whose keys are
    // corrupt, has nothing to say about order. The engine constructs itself in the
    // default order already, so the honest move is to leave it alone rather than
    // assert a default the project never chose.
    it('sends nothing when the project holds no usable order', async () => {
        projectWithProofChainOrder([0, 0, 2, 3, 4]);
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: 'proof-1', deviceType: 'proof', port });

        expect(reorderMessages(postMessage)).toEqual([]);
    });

    it('sends nothing for a device id the project does not carry', async () => {
        projectWithProofChainOrder([0, 1, 2, 4, 3]);
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: 'proof-absent', deviceType: 'proof', port });

        expect(reorderMessages(postMessage)).toEqual([]);
    });
});
