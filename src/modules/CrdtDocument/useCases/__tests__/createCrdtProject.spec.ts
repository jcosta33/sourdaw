import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createCrdtProject } from '../createCrdtProject';

const mocks = vi.hoisted(() => ({
    compactProject: vi.fn(),
    resetCrdtProject: vi.fn(),
    finalize: vi.fn(),
}));

vi.mock('../compactProject', () => ({ compactProject: mocks.compactProject }));
vi.mock('../resetCrdtProject', () => ({ resetCrdtProject: mocks.resetCrdtProject }));

describe('createCrdtProject', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.compactProject.mockResolvedValue(undefined);
        mocks.finalize.mockResolvedValue('finalized');
        mocks.resetCrdtProject.mockResolvedValue({ status: 'replaced', finalize: mocks.finalize });
    });

    it('should initialize the repository and compact', async () => {
        await createCrdtProject('New Project');

        expect(mocks.resetCrdtProject).toHaveBeenCalledWith('New Project');
        expect(mocks.compactProject).toHaveBeenCalledOnce();
    });

    // C3 — the branch list becomes durable only after the snapshot it names.
    it('finalizes the reset after the initial snapshot', async () => {
        await createCrdtProject('New Project');

        expect(mocks.finalize).toHaveBeenCalledOnce();
        expect(mocks.compactProject.mock.invocationCallOrder[0]!).toBeLessThan(
            mocks.finalize.mock.invocationCallOrder[0]!
        );
    });

    // C1 — the bootstrap path has no project to fall back to, so a refusal is
    // a failure to create rather than something to work around.
    it('rejects naming the refusal, without compacting, when the reset is refused', async () => {
        mocks.resetCrdtProject.mockResolvedValue({ status: 'refused', reason: 'session-active' });

        await expect(createCrdtProject('New Project')).rejects.toThrow(
            '[createCrdtProject] Project reset refused (session-active)'
        );

        expect(mocks.compactProject).not.toHaveBeenCalled();
    });

    // C5 — a caller told the project exists must be able to rely on its branch
    // list and its durable bundle describing the same project.
    it('rejects naming the outcome when the reset did not finalize', async () => {
        mocks.finalize.mockResolvedValue('authority-mismatch');

        await expect(createCrdtProject('New Project')).rejects.toThrow(
            '[createCrdtProject] Project reset did not finalize (authority-mismatch)'
        );
    });
});
