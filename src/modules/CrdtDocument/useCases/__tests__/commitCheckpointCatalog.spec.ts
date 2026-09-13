import { afterEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({
    commitCheckpointCatalog: vi.fn(),
}));

vi.mock('../../repositories/crdtPersistence/commitCheckpointCatalog', () => persistence);

import { commitCheckpointCatalog } from '../commitCheckpointCatalog';

describe('commitCheckpointCatalog', () => {
    afterEach(() => {
        persistence.commitCheckpointCatalog.mockReset();
    });

    it('forwards the exact owner admission options and every persistence result', async () => {
        const input: Parameters<typeof commitCheckpointCatalog>[0] = {
            ownerProjectId: 'project-a',
            expectedCatalogRevision: null,
            nextState: {
                branches: [
                    {
                        id: 'main',
                        name: 'Main',
                        createdAt: '2026-09-05T10:00:00.000Z',
                        headCheckpointId: null,
                    },
                ],
                currentBranchId: 'main',
                currentCheckpointId: null,
            },
        };
        const options: Parameters<typeof commitCheckpointCatalog>[1] = { shouldCommit: () => true };
        const results = [
            { status: 'committed' as const, catalogRevision: 'revision-a' },
            { status: 'conflict' as const },
            { status: 'superseded' as const },
        ];

        for (const result of results) {
            persistence.commitCheckpointCatalog.mockResolvedValueOnce(result);
            await expect(commitCheckpointCatalog(input, options)).resolves.toEqual(result);
            expect(persistence.commitCheckpointCatalog).toHaveBeenLastCalledWith(input, options);
        }
    });
});
