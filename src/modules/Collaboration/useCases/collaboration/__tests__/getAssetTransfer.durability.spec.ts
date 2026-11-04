import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    ASSET_RESUME_DATABASE,
    ASSET_RESUME_MAX_AGE_MS,
    ASSET_RESUME_METADATA,
} from '../../../models/AssetTransferResume';
import { ASSET_CHUNK_SIZE, MIN_ASSET_CHUNK_SIZE, type PeerMessage } from '../../../models/CollaborationTypes';
import { openAssetTransferResumeDatabase } from '../../../repositories/assetTransferResumeIndexedDb';
import { createAssetTransferResumeRepository } from '../../../repositories/assetTransferResumeRepository';
import { PeerConnectionManager } from '../../../repositories/peerConnection';
import {
    installFakeDurableAssetIndexedDb,
    type FakeDurableAssetIndexedDb,
} from '../../__tests__/fakeDurableAssetIndexedDb';
import { AssetTransfer } from '../../assetTransfer';
import { getAssetTransfer } from '../getAssetTransfer';

const OWNER_ID = 'aaaaaaaa-aaaa-8aaa-8aaa-aaaaaaaaaaaa';

const runtime = vi.hoisted(() => ({
    state: { assetTransfer: null as AssetTransfer | null },
}));

vi.mock('../sessionManagement', () => ({ sessionRuntimePrimitives: runtime }));
vi.mock('../getCollaborationAssetOwnerId', () => ({
    collaborationAssetOwnership: { getOwnerId: () => OWNER_ID },
}));

let durableAssetIndexedDb: FakeDurableAssetIndexedDb;
let originalAssetDatabase: IDBFactory;
const instances: AssetTransfer[] = [];

beforeAll(() => {
    durableAssetIndexedDb = installFakeDurableAssetIndexedDb();
    originalAssetDatabase = indexedDB;
});

function createSessionTransfer(): AssetTransfer {
    const transfer = new AssetTransfer(
        new PeerConnectionManager({
            onMessage: () => undefined,
            onConnected: () => undefined,
            onDisconnected: () => undefined,
        }),
        {
            onAssetAvailable: () => undefined,
            onProgress: () => undefined,
            onTransferFailed: () => undefined,
        },
        OWNER_ID
    );
    instances.push(transfer);
    return transfer;
}

function control(message: PeerMessage): Record<string, unknown> {
    if (message.type !== 'crdt-sync') {
        throw new TypeError('Expected serialized asset frame');
    }
    const value: unknown = JSON.parse(message.data);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('Expected asset control object');
    }
    return value as Record<string, unknown>;
}

async function partialCount(): Promise<number> {
    const database = await openAssetTransferResumeDatabase();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(ASSET_RESUME_METADATA, 'readonly');
        const request = transaction.objectStore(ASSET_RESUME_METADATA).count();
        transaction.oncomplete = () => {
            database.close();
            resolve(request.result);
        };
        transaction.onabort = () => {
            database.close();
            reject(transaction.error);
        };
    });
}

describe('getAssetTransfer durable live-stage ownership', () => {
    beforeEach(() => {
        durableAssetIndexedDb.reset();
        runtime.state.assetTransfer = null;
        const partialDatabase = new IDBFactory();
        vi.stubGlobal('indexedDB', {
            open: (name: string, version?: number) => {
                if (name === ASSET_RESUME_DATABASE) {
                    return partialDatabase.open(name, version);
                }
                return originalAssetDatabase.open(name, version);
            },
        });
        vi.stubGlobal('IDBKeyRange', IDBKeyRange);
    });

    afterEach(() => {
        runtime.state.assetTransfer = createSessionTransfer();
        getAssetTransfer();
        runtime.state.assetTransfer = null;
        for (const transfer of instances.splice(0)) {
            transfer.dispose();
        }
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('preserves one transfer-safe stage across no-session and session swaps before confirmation owns it', async () => {
        const projectTransfer = getAssetTransfer();
        if (!projectTransfer) {
            throw new TypeError('Expected project asset transfer');
        }
        const promoted = await projectTransfer.stageDurableAsset(
            new Blob(['pending-confirmation-promote']),
            'pending-confirmation-promote.wav',
            'asset-stage-project-session-swap-promote',
            { protectAcrossTransfer: true }
        );
        const cancelled = await projectTransfer.stageDurableAsset(
            new Blob(['pending-confirmation-cancel']),
            'pending-confirmation-cancel.wav',
            'asset-stage-project-session-swap-cancel',
            { protectAcrossTransfer: true }
        );

        const sessionTransfer = createSessionTransfer();
        runtime.state.assetTransfer = sessionTransfer;
        expect(getAssetTransfer()).toBe(sessionTransfer);
        await sessionTransfer.reopenDurableAsset('sha256:missing');

        runtime.state.assetTransfer = null;
        const replacementProjectTransfer = getAssetTransfer();
        await replacementProjectTransfer?.reopenDurableAsset('sha256:missing');

        await expect(
            replacementProjectTransfer?.reopenDurableStagedAsset(promoted.leaseId, promoted.hash)
        ).resolves.toMatchObject({ status: 'opened', leaseId: promoted.leaseId });
        await expect(
            replacementProjectTransfer?.reopenDurableStagedAsset(cancelled.leaseId, cancelled.hash)
        ).resolves.toMatchObject({ status: 'opened', leaseId: cancelled.leaseId });
        await expect(
            replacementProjectTransfer?.prepareDurablePromotionRecovery('stem-promotion:session-swap', [
                { leaseId: promoted.leaseId, expectedHash: promoted.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            replacementProjectTransfer?.commitDurablePromotionRecovery('stem-promotion:session-swap')
        ).resolves.toMatchObject({ status: 'committed' });
        await expect(
            replacementProjectTransfer?.completeDurablePromotionRecovery('stem-promotion:session-swap')
        ).resolves.toMatchObject({ status: 'completed' });
        await expect(
            replacementProjectTransfer?.prepareDurableCleanupRecovery('stem-cleanup:session-swap', [
                { leaseId: cancelled.leaseId, expectedHash: cancelled.hash },
            ])
        ).resolves.toMatchObject({ status: 'prepared' });
        await expect(
            replacementProjectTransfer?.completeDurableCleanupRecovery('stem-cleanup:session-swap')
        ).resolves.toMatchObject({ status: 'completed' });

        const cleanupTransfer = createSessionTransfer();
        runtime.state.assetTransfer = cleanupTransfer;
        getAssetTransfer();
        await cleanupTransfer.reopenDurableAsset('sha256:missing');
        await expect(cleanupTransfer.reopenDurableAsset(promoted.hash)).resolves.toMatchObject({
            status: 'opened',
            hash: promoted.hash,
        });
        await expect(cleanupTransfer.reopenDurableStagedAsset(cancelled.leaseId, cancelled.hash)).resolves.toEqual({
            status: 'failed',
            reason: 'lease-terminal-conflict',
        });
        await cleanupTransfer.releaseDurableAsset(promoted.hash);
        cleanupTransfer.dispose();
    });

    it('recreates the actual project-only runtime after a session swap and resumes committed wire chunks', async () => {
        const requests: PeerMessage[] = [];
        const emissions: Array<() => void> = [];
        const responses: PeerMessage[] = [];
        vi.spyOn(PeerConnectionManager.prototype, 'broadcastCrdtSync').mockImplementation((message) => {
            requests.push(message);
            emissions.shift()?.();
        });
        function request(transfer: AssetTransfer, hash: string): Promise<void> {
            const emitted = new Promise<void>((resolve) => emissions.push(resolve));
            transfer.requestAsset(hash);
            return emitted;
        }
        const record = async ({ message }: { message: PeerMessage }) => {
            responses.push(message);
        };
        vi.spyOn(PeerConnectionManager.prototype, 'sendCrdtSync').mockImplementation(record);
        vi.spyOn(PeerConnectionManager.prototype, 'sendCrdtSyncBuffered').mockImplementation(record);
        const sender = createSessionTransfer();
        const bytes = new Uint8Array(ASSET_CHUNK_SIZE * 2 + 17).fill(63);
        const hash = await sender.addLocalAsset(new Blob([bytes]), 'project-runtime.wav');
        const project = getAssetTransfer();
        if (!project) {
            throw new TypeError('Expected the actual project runtime');
        }
        await request(project, hash);
        await sender.handleMessage('project-before-swap', requests[0]!);
        await project.handleMessage('sender-before-swap', responses[0]!);
        await project.handleMessage('sender-before-swap', responses[1]!);
        expect(await partialCount()).toBe(1);

        const session = createSessionTransfer();
        runtime.state.assetTransfer = session;
        expect(getAssetTransfer()).toBe(session);
        runtime.state.assetTransfer = null;
        const replacement = getAssetTransfer();
        if (!replacement) {
            throw new TypeError('Expected the replacement project runtime');
        }
        expect(replacement).not.toBe(project);
        await replacement.resumeDurableOwnerRebindsAfterProjectLoad({
            ownerId: OWNER_ID,
            signal: new AbortController().signal,
            isCurrent: () => true,
        });
        await request(replacement, hash);
        expect(control(requests[1]!).missingChunks).toEqual([1, 2]);
        expect(control(requests[1]!).attemptToken).not.toBe(control(requests[0]!).attemptToken);
        responses.length = 0;
        await sender.handleMessage('project-after-swap', requests[1]!);
        const controls = responses.map(control);
        const chunks = controls.filter((value) => value.type === 'asset.chunk');
        expect(chunks.map((value) => value.index)).toEqual([1, 2]);
        for (const response of responses) {
            await replacement.handleMessage('sender-after-swap', response);
        }
        await vi.waitFor(() => expect(replacement.hasAsset(hash)).toBe(true));
        expect(new Uint8Array(await replacement.getAsset(hash)!.arrayBuffer())).toEqual(bytes);
        expect(await partialCount()).toBe(0);
    });

    it('expires old temporary rows only through the still-current project-load recovery hook', async () => {
        const start = 1_800_000_000_000;
        const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
        const repository = createAssetTransferResumeRepository(OWNER_ID);
        await repository.begin(
            {
                hash: `sha256:${'4'.repeat(64)}`,
                size: MIN_ASSET_CHUNK_SIZE,
                chunkSize: MIN_ASSET_CHUNK_SIZE,
                chunkCount: 1,
                name: 'aged.wav',
                mime: 'audio/wav',
            },
            'aged-writer'
        );
        clock.mockReturnValue(start + ASSET_RESUME_MAX_AGE_MS + 1);
        const transfer = getAssetTransfer();
        if (!transfer) {
            throw new TypeError('Expected project asset transfer');
        }
        let current = false;
        const authority = { ownerId: OWNER_ID, signal: new AbortController().signal, isCurrent: () => current };
        await transfer.resumeDurableOwnerRebindsAfterProjectLoad(authority);
        expect(await partialCount()).toBe(1);
        current = true;
        await transfer.resumeDurableOwnerRebindsAfterProjectLoad(authority);
        expect(await partialCount()).toBe(0);
    });
});
