import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    pendingProjectReplacements,
    runProjectLoadTransaction,
    setProjectIdentityTransitionDependencies,
} from '#/modules/Project/useCases';

import { importDawProject } from '../importDawProject';

const mocks = vi.hoisted(() => ({
    parseDawProject: vi.fn(),
    notifyUser: vi.fn(),
    logger: { warn: vi.fn() },
}));

vi.mock('../parseDawProject', () => ({ parseDawProject: mocks.parseDawProject }));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notifyUser }));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mocks.logger }));

describe('importDawProject parse failure authority', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
    });

    it('does not notify after a real successor project transaction activates', async () => {
        const parsing = Promise.withResolvers<never>();
        mocks.parseDawProject.mockReturnValue(parsing.promise);
        const importing = importDawProject({ buffer: new ArrayBuffer(8), fileName: 'old.dawproject' });
        expect(mocks.parseDawProject).toHaveBeenCalledTimes(1);

        const successor = runProjectLoadTransaction();
        expect(await successor.prepare()).toBe(true);
        expect(successor.activate()).toBe(true);
        const failure = new Error('old parse failed');
        parsing.reject(failure);

        await expect(importing).resolves.toEqual({ ok: false, warnings: [] });
        expect(successor.isCurrent()).toBe(true);
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledWith('[importDawProject] parse failure', failure);
    });

    it('does not notify after the caller withdraws its pending replacement', async () => {
        const shouldProceed = pendingProjectReplacements.capture();
        const parsing = Promise.withResolvers<never>();
        mocks.parseDawProject.mockReturnValue(parsing.promise);
        const importing = importDawProject({
            buffer: new ArrayBuffer(8),
            fileName: 'withdrawn.dawproject',
            shouldProceed,
        });
        expect(mocks.parseDawProject).toHaveBeenCalledTimes(1);

        pendingProjectReplacements.withdraw();
        expect(shouldProceed()).toBe(false);
        const failure = new Error('withdrawn parse failed');
        parsing.reject(failure);

        await expect(importing).resolves.toEqual({ ok: false, warnings: [] });
        expect(mocks.notifyUser).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledWith('[importDawProject] parse failure', failure);
    });
});
