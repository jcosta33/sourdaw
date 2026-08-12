import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pushHardwareTransport } from '../../../repositories/pushHardwareTransport';
import { pushStore } from '../../../stores/push';
import { connectPush } from '../connectPush';

vi.mock('../../../repositories/pushHardwareTransport', () => ({
    pushHardwareTransport: {
        connect: vi.fn(),
        disconnect: vi.fn(),
    },
}));

describe('connectPush', () => {
    beforeEach(() => {
        vi.mocked(pushHardwareTransport.connect).mockReset().mockResolvedValue();
        vi.mocked(pushHardwareTransport.disconnect).mockReset().mockResolvedValue();
        pushStore.set({
            ...pushStore.value!,
            connected: false,
            model: null,
        });
    });

    it('marks connected only after the hardware transport is ready', async () => {
        let finishConnection: (() => void) | undefined;
        vi.mocked(pushHardwareTransport.connect).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishConnection = resolve;
                })
        );

        const connection = connectPush('push2');
        expect(pushStore.value?.connected).toBe(false);

        finishConnection?.();
        await connection;

        expect(pushStore.value?.connected).toBe(true);
        expect(pushStore.value?.model).toBe('push2');
    });

    it('preserves disconnected state when the hardware transport rejects', async () => {
        vi.mocked(pushHardwareTransport.connect).mockRejectedValue(new Error('Push 2 not found'));

        await expect(connectPush('push2')).rejects.toThrow('Push 2 not found');
        expect(pushStore.value?.connected).toBe(false);
        expect(pushStore.value?.model).toBeNull();
    });

    it('clears connection truth when the native transport reports terminal I/O loss', async () => {
        let onDisconnect: Parameters<typeof pushHardwareTransport.connect>[0]['onDisconnect'] | undefined;
        vi.mocked(pushHardwareTransport.connect).mockImplementation((input) => {
            onDisconnect = input.onDisconnect;
            return Promise.resolve();
        });

        await connectPush('push2');
        onDisconnect?.();

        expect(pushStore.value?.connected).toBe(false);
        expect(pushStore.value?.model).toBeNull();
    });

    it('should not mutate when push store is null', async () => {
        pushStore.set(null);
        await connectPush('push2');
        expect(pushStore.value).toBeNull();
    });
});
