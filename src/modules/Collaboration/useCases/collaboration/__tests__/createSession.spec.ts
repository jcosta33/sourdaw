import { describe, it, expect, vi, beforeEach } from 'vitest';

import { collaborationStore } from '../../../stores/collaborationStore';
import { createSession } from '../createSession';

/**
 * `createSession` orchestrates against the WebRTC/signaling boundary exposed
 * by `sessionManagement`'s `sessionRuntimePrimitives`. Mock that boundary
 * entirely so these specs exercise createSession's own orchestration and
 * store write without opening a real peer connection.
 */
const mockRuntime = vi.hoisted(() => ({
    state: { sessionSecret: null as string | null },
    cleanup: vi.fn<(owner?: object | null, requestWitness?: number) => boolean>(),
    initialize: vi.fn<(assetOwnerId: string) => Promise<void>>(),
    captureOwner: vi.fn<() => object | null>(),
    settleRetainedTeardown: vi.fn<() => Promise<void>>(),
    runLifecycle: vi.fn(<T>(operation: () => Promise<T>) => operation()),
    startPlayheadBroadcast: vi.fn<() => void>(),
    startBranchSync: vi.fn<(isHost: boolean) => void>(),
    generatePeerId: vi.fn<() => string>(),
    generateSessionId: vi.fn<() => string>(),
    generateSessionSecret: vi.fn<() => string>(),
    pickPeerColor: vi.fn<(excludeColors: string[]) => string>(),
}));
const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: mockRuntime }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: loggerMock.warn } }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    collaborationAssetOwnership: { getOwnerId: () => 'project-owner-1' },
}));

describe('createSession', () => {
    const owner = {};

    beforeEach(() => {
        vi.clearAllMocks();
        collaborationStore.set(null);
        mockRuntime.state.sessionSecret = null;
        mockRuntime.generatePeerId.mockReturnValue('peer-1');
        mockRuntime.generateSessionId.mockReturnValue('sess-1');
        mockRuntime.generateSessionSecret.mockReturnValue('secret-1');
        mockRuntime.pickPeerColor.mockReturnValue('#3b82f6');
        mockRuntime.captureOwner.mockReturnValue(owner);
        mockRuntime.cleanup.mockReturnValue(true);
        mockRuntime.initialize.mockResolvedValue(undefined);
        mockRuntime.settleRetainedTeardown.mockResolvedValue(undefined);
    });

    it('mints a fresh room secret onto the session runtime', async () => {
        await createSession('Host');

        expect(mockRuntime.generateSessionSecret).toHaveBeenCalledTimes(1);
        expect(mockRuntime.state.sessionSecret).toBe('secret-1');
    });

    it('returns the generated session id', async () => {
        mockRuntime.generateSessionId.mockReturnValue('sess-42');

        await expect(createSession('Host')).resolves.toBe('sess-42');
    });

    it('resets prior runtime state before initializing the new host session', async () => {
        await createSession('Host');

        expect(mockRuntime.cleanup).toHaveBeenCalledTimes(1);
        expect(mockRuntime.initialize).toHaveBeenCalledExactlyOnceWith('project-owner-1');
        expect(mockRuntime.startPlayheadBroadcast).toHaveBeenCalledTimes(1);
        expect(mockRuntime.startBranchSync).toHaveBeenCalledWith(true);
    });

    it('requests a peer color that excludes no other peers for a fresh session', async () => {
        await createSession('Host');

        expect(mockRuntime.pickPeerColor).toHaveBeenCalledWith([]);
    });

    it('writes the new session into the collaboration store as the host with no peers yet', async () => {
        await createSession('Bob');

        expect(collaborationStore.value).toEqual({
            isEnabled: true,
            sessionId: 'sess-1',
            localPeerId: 'peer-1',
            localName: 'Bob',
            localColor: '#3b82f6',
            isHost: true,
            peers: [],
            connectionStatus: 'disconnected',
            error: null,
            quarantinedPeerIds: [],
        });
    });

    it('cleans only its partial runtime when host setup fails', async () => {
        mockRuntime.startBranchSync.mockImplementationOnce(() => {
            throw new Error('branch setup failed');
        });

        await expect(createSession('Host')).rejects.toThrow('branch setup failed');

        expect(mockRuntime.cleanup).toHaveBeenLastCalledWith(owner);
        expect(mockRuntime.settleRetainedTeardown).toHaveBeenCalledTimes(2);
    });

    it('reports both the host setup error and a partial-runtime cleanup failure', async () => {
        const setupError = new Error('branch setup failed');
        const cleanupError = new Error('cleanup failed');
        mockRuntime.startBranchSync.mockImplementationOnce(() => {
            throw setupError;
        });
        mockRuntime.cleanup.mockReturnValueOnce(true).mockImplementationOnce(() => {
            throw cleanupError;
        });

        await expect(createSession('Host')).rejects.toEqual(
            expect.objectContaining({ errors: [setupError, cleanupError] })
        );
        expect(loggerMock.warn).toHaveBeenCalledWith(
            '[Collaboration] Failed to clean up host session setup:',
            cleanupError
        );
    });

    it('does not install a replacement until retained teardown settles', async () => {
        const teardownEntered = Promise.withResolvers<void>();
        const teardown = Promise.withResolvers<void>();
        mockRuntime.settleRetainedTeardown.mockImplementationOnce(async () => {
            teardownEntered.resolve();
            await teardown.promise;
        });

        const creating = createSession('Host');
        await teardownEntered.promise;

        expect(mockRuntime.initialize).not.toHaveBeenCalled();
        teardown.resolve();
        await creating;
        expect(mockRuntime.initialize).toHaveBeenCalledOnce();
    });
});
