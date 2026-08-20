import { afterEach, describe, expect, it } from 'vitest';

import { collaborationStore } from '../../../stores/collaborationStore';
import { canExecuteCommandBatch } from '../canExecuteCommandBatch';

const disconnectedState = {
    connectionStatus: 'disconnected' as const,
    error: null,
    quarantinedPeerIds: [],
    isEnabled: false,
    isHost: false,
    localColor: '',
    localName: '',
    localPeerId: null,
    peers: [],
    sessionId: null,
};

describe('canExecuteCommandBatch', () => {
    afterEach(() => {
        collaborationStore.set(disconnectedState);
    });

    it('admits standalone and host execution but rejects a collaboration joiner', () => {
        collaborationStore.set(disconnectedState);
        expect(canExecuteCommandBatch()).toBe(true);

        collaborationStore.set({
            ...disconnectedState,
            connectionStatus: 'connected',
            isEnabled: true,
            isHost: true,
            localPeerId: 'host-peer',
            sessionId: 'session-1',
        });
        expect(canExecuteCommandBatch()).toBe(true);

        collaborationStore.set({
            ...disconnectedState,
            connectionStatus: 'connected',
            isEnabled: true,
            isHost: false,
            localPeerId: 'joiner-peer',
            sessionId: 'session-1',
        });
        expect(canExecuteCommandBatch()).toBe(false);
    });
});
