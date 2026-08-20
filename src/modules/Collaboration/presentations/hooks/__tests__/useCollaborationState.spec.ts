import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { collaborationStore } from '../../../stores/collaborationStore';
import { useCollaborationState } from '../useCollaborationState';

const mocks = vi.hoisted(() => ({
    useStore: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: mocks.useStore,
}));

describe('useCollaborationState', () => {
    it('reads from collaborationStore via useStore', () => {
        const state = {
            isEnabled: true,
            sessionId: 's1',
            localPeerId: 'p1',
            localName: 'Me',
            localColor: '#fff',
            isHost: true,
            peers: [],
            connectionStatus: 'connected' as const,
            error: null,
            quarantinedPeerIds: [],
        };
        mocks.useStore.mockReturnValue(state);

        const { result } = renderHook(() => useCollaborationState());

        expect(mocks.useStore).toHaveBeenCalledWith(collaborationStore, expect.objectContaining({ isEnabled: false }));
        expect(result.current).toBe(state);
    });

    it('supplies a disconnected default state to useStore', () => {
        mocks.useStore.mockReturnValue(undefined);

        renderHook(() => useCollaborationState());

        const [, defaultState] = mocks.useStore.mock.calls.at(-1) as [unknown, Record<string, unknown>];
        expect(defaultState).toEqual({
            isEnabled: false,
            sessionId: null,
            localPeerId: null,
            localName: '',
            localColor: '',
            isHost: false,
            peers: [],
            connectionStatus: 'disconnected',
            error: null,
            quarantinedPeerIds: [],
        });
    });
});
