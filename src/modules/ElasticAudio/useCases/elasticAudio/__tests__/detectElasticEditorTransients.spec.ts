import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import { createHandler } from '#/utils/createHandler';
import { type HandlerExecutionResult } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    notify: vi.fn(),
    markComplete: vi.fn(),
}));

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: mocks.notify }));
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

let detectorOutcome: () => HandlerExecutionResult | void = () => undefined;

function registerDetector(): void {
    clearHandlerRegistry();
    registerHandlerMap({
        detectTransients: createHandler<'detectTransients'>({
            undoable: false,
            describe: () => ({ label: 'Detect transients' }),
            previewExecution: 'unsupported-external',
            requiresAbortCompensation: false,
            execute: () => detectorOutcome(),
        }),
    });
}

describe('detectElasticEditorTransients', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerDetector();
        // The registered detector takes its invocation revision when it commits.
        detectorOutcome = () => {
            transientDetectionLifecycle.cancel('clip-1');
        };
    });

    afterEach(() => {
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
    });

    it('marks detection complete once the action committed', async () => {
        await expect(detectElasticEditorTransients('clip-1', 0.5)).resolves.toBe(true);
        expect(mocks.markComplete).toHaveBeenCalledTimes(1);
        expect(mocks.notify).not.toHaveBeenCalled();
    });

    it('resolves false, tells the user why and does not mark completion when the project refuses the mutation', async () => {
        agentProjectRepairStateStore.set({
            audioGraphValid: false,
            detectedRevision: 'revision-1',
            inspectionAvailable: true,
            projectInvariantsValid: false,
            rawProjectRetained: true,
            repairCandidates: [],
            status: 'repair-required',
        });

        await expect(detectElasticEditorTransients('clip-1', 0.5)).resolves.toBe(false);

        expect(mocks.markComplete).not.toHaveBeenCalled();
        expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
            'Project repair is required before project actions can execute',
            'warning'
        );
    });

    it.each([
        'Transient detection was cancelled or its source changed',
        'Transient detection failed: analysis-timed-out',
    ])('rejects the detector conflict %j without a refusal warning', async (reason) => {
        detectorOutcome = () => ({ status: 'conflict', reason });

        await expect(detectElasticEditorTransients('clip-1', 0.5)).rejects.toThrow(reason);
        expect(mocks.notify).not.toHaveBeenCalled();
        expect(mocks.markComplete).not.toHaveBeenCalled();
    });

    it('still rejects a failure that is not a refusal', async () => {
        const failure = new Error('worker failed');
        detectorOutcome = () => {
            throw failure;
        };

        await expect(detectElasticEditorTransients('clip-1', 0.5)).rejects.toBe(failure);
        expect(mocks.notify).not.toHaveBeenCalled();
    });
});
