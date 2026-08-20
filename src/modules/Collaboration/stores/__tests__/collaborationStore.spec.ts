import { describe, it, expect, beforeEach } from 'vitest';

import { type CollaborationState, type PeerInfo } from '../../models/CollaborationTypes';
import { collaborationStore } from '../collaborationStore';

const defaultState: CollaborationState = {
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
};

function samplePeer(id: string): PeerInfo {
    return {
        id,
        name: `Peer ${id}`,
        color: '#3b82f6',
        isHost: false,
        isConnected: true,
        lastSeen: 1_700_000_000_000,
        latencyMs: 42,
    };
}

describe('collaborationStore defaults', () => {
    beforeEach(() => {
        collaborationStore.set(defaultState);
    });

    it('seeds a disabled, disconnected, host-less session with no peers', () => {
        expect(collaborationStore.value).toEqual(defaultState);
    });
});

describe('collaborationStore writes', () => {
    beforeEach(() => {
        collaborationStore.set(defaultState);
    });

    it('reads back a full session state written with set', () => {
        const hosting: CollaborationState = {
            isEnabled: true,
            sessionId: 'session-1',
            localPeerId: 'peer-host',
            localName: 'Ada',
            localColor: '#3b82f6',
            isHost: true,
            peers: [samplePeer('peer-guest')],
            connectionStatus: 'connected',
            error: null,
            quarantinedPeerIds: [],
        };

        collaborationStore.set(hosting);

        expect(collaborationStore.value).toEqual(hosting);
    });

    it('applies a partial transition via update without touching unrelated fields', () => {
        collaborationStore.set({ ...defaultState, localName: 'Ada', localColor: '#3b82f6' });

        collaborationStore.update((current) => ({
            ...(current ?? defaultState),
            isEnabled: true,
            connectionStatus: 'connecting',
        }));

        expect(collaborationStore.value?.isEnabled).toBe(true);
        expect(collaborationStore.value?.connectionStatus).toBe('connecting');
        expect(collaborationStore.value?.localName).toBe('Ada');
        expect(collaborationStore.value?.localColor).toBe('#3b82f6');
    });

    it('appends a peer to the roster via update, preserving existing peers', () => {
        const first = samplePeer('peer-1');
        collaborationStore.set({ ...defaultState, peers: [first] });

        collaborationStore.update((current) => ({
            ...(current ?? defaultState),
            peers: [...(current?.peers ?? []), samplePeer('peer-2')],
        }));

        expect(collaborationStore.value?.peers).toEqual([first, samplePeer('peer-2')]);
    });

    it('records a connection error and status transition', () => {
        collaborationStore.set({ ...defaultState, connectionStatus: 'connecting' });

        collaborationStore.update((current) => ({
            ...(current ?? defaultState),
            connectionStatus: 'error',
            error: 'Signaling channel closed',
            quarantinedPeerIds: [],
        }));

        expect(collaborationStore.value?.connectionStatus).toBe('error');
        expect(collaborationStore.value?.error).toBe('Signaling channel closed');
    });
});

describe('collaborationStore subscribe/clear', () => {
    beforeEach(() => {
        collaborationStore.set(defaultState);
    });

    it('notifies subscribers on set and stops after unsubscribe', () => {
        const seen: (CollaborationState | null)[] = [];
        const unsubscribe = collaborationStore.subscribe((value) => {
            seen.push(value);
        });

        collaborationStore.set({ ...defaultState, isEnabled: true });
        unsubscribe();
        collaborationStore.set({ ...defaultState, isEnabled: false });

        expect(seen).toHaveLength(1);
        expect(seen[0]?.isEnabled).toBe(true);
    });

    it('clears back to null', () => {
        collaborationStore.set({ ...defaultState, isEnabled: true });

        collaborationStore.clear();

        expect(collaborationStore.value).toBeNull();
    });
});
