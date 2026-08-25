import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ExecutableRuntimeAction } from '../../../models/ExecutableRuntimeAction';
import { createStemImportConfirmationResourceLease } from '../createStemImportConfirmationResourceLease';

const mocks = vi.hoisted(() => ({
    discard: vi.fn(),
    loggerError: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { error: mocks.loggerError } }));
vi.mock('../registerPreparedStemImportResources', () => ({
    preparedStemImportResources: {
        discard: mocks.discard,
        protect: vi.fn(),
        release: vi.fn(),
        retainForRecovery: vi.fn(),
    },
}));

const stemAction = {
    type: 'importStemSet',
    payload: {
        selectionId: 'selection-1',
        groupName: 'Imported Stems',
        projectTempo: 120,
        folderId: 'folder-1',
        stems: [
            {
                stemId: 'stem-1',
                sourceName: 'Drums.wav',
                role: 'other',
                sourceTempo: 120,
                durationSeconds: 10,
                sourceBytes: 100,
                decodedBytes: 200,
                audioBufferId: 'buffer-1',
                assetLeaseId: 'asset-lease-1',
                trackId: 'track-1',
                trackName: 'Drums',
                trackGain: 1,
                trackPan: 0,
                clipId: 'clip-1',
            },
        ],
    },
} satisfies ExecutableRuntimeAction;

describe('createStemImportConfirmationResourceLease', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.discard.mockResolvedValue(undefined);
    });

    it('logs an asynchronous discard failure instead of leaving the release rejection unhandled', async () => {
        const failure = new Error('temporary asset cleanup persistence unavailable');
        mocks.discard.mockRejectedValueOnce(failure);
        const lease = createStemImportConfirmationResourceLease('run-1', [stemAction]);
        if (!lease) {
            throw new Error('Expected a prepared stem resource lease');
        }

        lease.release();

        await vi.waitFor(() =>
            expect(mocks.loggerError).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({
                    message: 'Prepared stem import resource cleanup failed after confirmation release',
                    cause: failure,
                })
            )
        );
    });
});
