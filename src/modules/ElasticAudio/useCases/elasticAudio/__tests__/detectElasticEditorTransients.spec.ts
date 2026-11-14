import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppActionConflictError } from '#/modules/Command/errors/AppActionExecutionError';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';

const mocks = vi.hoisted(() => ({
    execute: vi.fn<(action: unknown, options?: unknown) => Promise<void>>(),
    notify: vi.fn(),
    markComplete: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));
vi.mock('#/modules/Command/useCases/executeAppAction', () => ({ executeAppAction: mocks.execute }));
vi.mock('../markElasticDetectionComplete', () => ({ markElasticDetectionComplete: mocks.markComplete }));
vi.mock('../captureElasticDetectionOwner', () => ({
    captureElasticDetectionOwner: (_source: unknown, _signal: unknown, clipId: string) => ({
        clipId,
        validSource: true,
        signal: new AbortController().signal,
        revision: transientDetectionLifecycle.revision(clipId),
        matches: () => true,
        isInvalidated: () => false,
        dispose: () => {},
        abort: () => {},
    }),
}));

import { detectElasticEditorTransients } from '../detectElasticEditorTransients';
import { transientDetectionLifecycle } from '../transientDetectionLifecycle';

describe('detectElasticEditorTransients', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        agentProjectRepairStateStore.set(null);
        mocks.execute.mockImplementation(async () => {
            // The registered detector takes its invocation revision when it commits.
            transientDetectionLifecycle.cancel('clip-1');
        });
    });

    it('marks detection complete once the action committed', async () => {
        await expect(detectElasticEditorTransients('clip-1', 0.5)).resolves.toBe(true);
        expect(mocks.markComplete).toHaveBeenCalledTimes(1);
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('resolves false, tells the user why and does not mark completion on a refused project', async () => {
        mocks.execute.mockRejectedValueOnce(new AppActionConflictError('detectTransients'));

        await expect(detectElasticEditorTransients('clip-1', 0.5)).resolves.toBe(false);

        expect(mocks.markComplete).not.toHaveBeenCalled();
        expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
            "Detect transients was refused because the project can't be changed right now.",
            'warning'
        );
    });

    it('still rejects a failure that is not a refusal', async () => {
        const failure = new Error('worker failed');
        mocks.execute.mockRejectedValueOnce(failure);

        await expect(detectElasticEditorTransients('clip-1', 0.5)).rejects.toBe(failure);
        expect(mocks.notify).not.toHaveBeenCalled();
    });
});
