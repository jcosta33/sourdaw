import { describe, expect, it, vi } from 'vitest';

const { mockGetTrackStoreState, mockGetRestoredProofChainOrder } = vi.hoisted(() => ({
    mockGetTrackStoreState: vi.fn(),
    mockGetRestoredProofChainOrder: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({ getTrackStoreState: mockGetTrackStoreState }));
vi.mock('../../services/getRestoredProofChainOrder', () => ({
    getRestoredProofChainOrder: mockGetRestoredProofChainOrder,
}));

import { captureOfflineProof } from '../captureOfflineProof';
import { prepareOfflineProof } from '../prepareOfflineProof';

describe('prepareOfflineProof', () => {
    it('projects captured parameters without reacquiring the same live device id', () => {
        const device = { parameterValues: { chain_order_0: 3 } };
        const captured = captureOfflineProof({ deviceId: 'proof-1', device });
        device.parameterValues.chain_order_0 = 2;
        mockGetTrackStoreState.mockReturnValue({
            tracks: [{ devices: [{ id: 'proof-1', type: 'proof', parameterValues: { chain_order_0: 0 } }] }],
        });
        mockGetRestoredProofChainOrder.mockImplementation((values) =>
            values.chain_order_0 === 3 ? [3, 0, 1, 2, 4] : [0, 1, 2, 3, 4]
        );
        const port = { postMessage: vi.fn() } as unknown as MessagePort;

        prepareOfflineProof({ deviceId: 'proof-1', port, captured });

        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'reorder', order: [3, 0, 1, 2, 4] });
    });

    it('preserves captured absence when the project later gains the same id', () => {
        const captured = captureOfflineProof({ deviceId: 'proof-1', device: null });
        mockGetTrackStoreState.mockReturnValue({
            tracks: [{ devices: [{ id: 'proof-1', type: 'proof', parameterValues: {} }] }],
        });
        mockGetRestoredProofChainOrder.mockReturnValue([0, 1, 2, 3, 4]);
        const postMessage = vi.fn();
        prepareOfflineProof({ deviceId: 'proof-1', port: { postMessage } as unknown as MessagePort, captured });
        expect(postMessage).not.toHaveBeenCalled();
    });

    it('posts a reorder message when the device is found with a valid chain order', () => {
        mockGetTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 't1',
                    devices: [
                        { id: 'proof-1', type: 'proof', parameterValues: { chain_order_0: 3, chain_order_1: 0 } },
                    ],
                },
            ],
        });
        mockGetRestoredProofChainOrder.mockReturnValue([3, 0, 1, 2, 4]);
        const port = { postMessage: vi.fn() } as unknown as MessagePort;
        prepareOfflineProof({ deviceId: 'proof-1', port });
        expect(port.postMessage).toHaveBeenCalledExactlyOnceWith({
            type: 'reorder',
            order: [3, 0, 1, 2, 4],
        });
    });

    it('does nothing when track state is unavailable', () => {
        mockGetTrackStoreState.mockReturnValue(null);
        const port = { postMessage: vi.fn() } as unknown as MessagePort;
        prepareOfflineProof({ deviceId: 'proof-1', port });
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when the device is not found in any track', () => {
        mockGetTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'other', type: 'builtin-eq', parameterValues: {} }] }],
        });
        const port = { postMessage: vi.fn() } as unknown as MessagePort;
        prepareOfflineProof({ deviceId: 'proof-missing', port });
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('does nothing when the chain order cannot be restored', () => {
        mockGetTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'proof-1', type: 'proof', parameterValues: {} }] }],
        });
        mockGetRestoredProofChainOrder.mockReturnValue(null);
        const port = { postMessage: vi.fn() } as unknown as MessagePort;
        prepareOfflineProof({ deviceId: 'proof-1', port });
        expect(port.postMessage).not.toHaveBeenCalled();
    });

    it('ignores non-proof devices with the same id', () => {
        mockGetTrackStoreState.mockReturnValue({
            tracks: [{ id: 't1', devices: [{ id: 'proof-1', type: 'builtin-eq', parameterValues: {} }] }],
        });
        const port = { postMessage: vi.fn() } as unknown as MessagePort;
        prepareOfflineProof({ deviceId: 'proof-1', port });
        expect(port.postMessage).not.toHaveBeenCalled();
    });
});
