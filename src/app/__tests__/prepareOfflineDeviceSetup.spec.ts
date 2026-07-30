import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTrack, getTrackStoreState } from '#/modules/Arrangement/useCases';
import { prepareCrumbsEngine } from '#/modules/Crumbs/useCases';
import { prepareOfflineLevain } from '#/modules/Levain/useCases';
import { NATIVE_DSP_DEVICE_TYPES } from '#/utils/nativeDspDeviceTypes';

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

// Crumbs' offline setup reads a sample off disk over the native bridge and
// decodes it; likewise never exercised here.
vi.mock('#/modules/Crumbs/useCases', () => ({
    prepareCrumbsEngine: vi.fn(() => Promise.resolve()),
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

describe('prepareOfflineDeviceSetup — hydration table routing', () => {
    beforeEach(() => {
        vi.mocked(getTrackStoreState).mockReset();
        vi.mocked(getTrackStoreState).mockReturnValue({ tracks: [], selectedTrackId: null });
        vi.mocked(prepareOfflineLevain).mockClear();
        vi.mocked(prepareCrumbsEngine).mockClear();
    });

    it('routes levain to its own hydration, forwarding the abort signal it needs to cancel a fetch', async () => {
        const { port } = makePort();
        const controller = new AbortController();

        await prepareOfflineDeviceSetup({
            deviceId: 'levain-1',
            deviceType: 'levain',
            port,
            signal: controller.signal,
        });

        expect(prepareOfflineLevain).toHaveBeenCalledExactlyOnceWith({
            deviceId: 'levain-1',
            port,
            signal: controller.signal,
        });
    });

    // Crumbs is the third hydrating entry. A `CrumbsInstance` is built with an
    // empty sample pool and `note_on` returns before allocating a voice when
    // there is no active sample, so `null` here would have rendered every
    // Crumbs track as digital silence with every parameter faithfully replayed.
    // It takes the signal because it reads a file and decodes it.
    it('routes crumbs to its own hydration, forwarding the abort signal its decode needs', async () => {
        const { port } = makePort();
        const controller = new AbortController();

        await prepareOfflineDeviceSetup({
            deviceId: 'crumbs-1',
            deviceType: 'builtin-crumbs',
            port,
            signal: controller.signal,
        });

        expect(prepareCrumbsEngine).toHaveBeenCalledExactlyOnceWith({
            deviceId: 'crumbs-1',
            port,
            signal: controller.signal,
        });
    });

    // Nine of the twelve native types are an explicit `null` in the table. That is
    // a recorded decision — their whole state arrives as `parameterValues` — so the
    // observable contract is that they post nothing at all, not that they happen to
    // have no branch.
    const NON_HYDRATING_TYPES = NATIVE_DSP_DEVICE_TYPES.filter(
        (type) => type !== 'levain' && type !== 'proof' && type !== 'builtin-crumbs'
    );

    it.each(NON_HYDRATING_TYPES)('posts nothing at the port for %s', async (deviceType) => {
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: `${deviceType}-1`, deviceType, port });

        expect(postMessage).not.toHaveBeenCalled();
        expect(prepareOfflineLevain).not.toHaveBeenCalled();
        expect(prepareCrumbsEngine).not.toHaveBeenCalled();
    });

    it('covers every native device type, so a new one cannot arrive untested', () => {
        // Guards the split above: if a device moves off `null`, this count changes
        // and whoever moved it has to say so here. Crumbs is what moved it from
        // 9-of-11 to 9-of-12 — it arrived hydrating, not `null`.
        expect(NON_HYDRATING_TYPES).toHaveLength(9);
        expect(NATIVE_DSP_DEVICE_TYPES).toHaveLength(12);
    });

    it('does nothing for a device type no native factory builds', async () => {
        const { port, postMessage } = makePort();

        await prepareOfflineDeviceSetup({ deviceId: 'synth-1', deviceType: 'synth', port });

        expect(postMessage).not.toHaveBeenCalled();
        expect(prepareOfflineLevain).not.toHaveBeenCalled();
        expect(prepareCrumbsEngine).not.toHaveBeenCalled();
    });
});
