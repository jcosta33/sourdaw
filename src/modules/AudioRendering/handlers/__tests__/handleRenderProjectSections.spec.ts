import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type AppAction, type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { handleRemoveRenderedProjectSections } from '../handleRemoveRenderedProjectSections';
import { handleRenderProjectSections } from '../handleRenderProjectSections';

const mocks = vi.hoisted(() => ({
    captureProjectRevision: vi.fn(),
    getAgentSectionRenderArtifacts: vi.fn(),
    renderAgentProjectSections: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/useCases', () => ({
    captureProjectRevision: mocks.captureProjectRevision,
}));

vi.mock('../../useCases/getAgentSectionRenderArtifacts', () => ({
    getAgentSectionRenderArtifacts: mocks.getAgentSectionRenderArtifacts,
}));

vi.mock('../../useCases/renderAgentProjectSections', () => ({
    renderAgentProjectSections: mocks.renderAgentProjectSections,
}));

function createJob(overrides: Partial<RenderProjectSectionJobSnapshot> = {}): RenderProjectSectionJobSnapshot {
    return {
        jobId: 'render-chorus-one',
        sectionId: 'section-chorus-one',
        sectionName: 'Chorus One',
        startBeat: 16,
        endBeat: 48,
        sampleRate: 44_100,
        tailSeconds: 0,
        ...overrides,
    };
}

function createAction(jobs = [createJob()]): Extract<AppAction, { type: 'renderProjectSections' }> {
    return {
        type: 'renderProjectSections',
        payload: {
            sectionIds: jobs.map((job) => job.sectionId),
            jobs,
        },
    };
}

describe('handleRenderProjectSections', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.captureProjectRevision.mockReturnValue('revision-after-commit');
        mocks.getAgentSectionRenderArtifacts.mockReturnValue([]);
        mocks.renderAgentProjectSections.mockResolvedValue(undefined);
    });

    it('defers rendering until commit and reuses one post-commit revision for reconciliation', async () => {
        const action = createAction();
        const result = await handleRenderProjectSections.execute(action);

        if (!result) {
            throw new Error('Expected renderProjectSections to return an execution result');
        }
        expect(result.status).toBe('written');
        expect(mocks.captureProjectRevision).not.toHaveBeenCalled();
        expect(mocks.renderAgentProjectSections).not.toHaveBeenCalled();
        if (result.status !== 'written') {
            throw new Error('Expected renderProjectSections to be writable');
        }

        await result.afterCommit?.();
        mocks.captureProjectRevision.mockReturnValue('revision-later');
        await result.afterAmbiguousCommit?.();

        expect(mocks.captureProjectRevision).toHaveBeenCalledOnce();
        expect(mocks.renderAgentProjectSections).toHaveBeenNthCalledWith(1, {
            jobs: action.payload.jobs,
            sourceRevision: 'revision-after-commit',
        });
        expect(mocks.renderAgentProjectSections).toHaveBeenNthCalledWith(2, {
            jobs: action.payload.jobs,
            sourceRevision: 'revision-after-commit',
        });
        expect(handleRenderProjectSections.requiresAbortCompensation).toBe(false);
    });

    it('rejects malformed, duplicate, and conflicting job snapshots before commit', () => {
        const malformed = createAction([createJob({ endBeat: 16 })]);
        const duplicate = createAction([
            createJob(),
            createJob({ sectionId: 'section-chorus-two', sectionName: 'Chorus Two' }),
        ]);
        const conflict = createAction();
        expect(handleRenderProjectSections.execute(malformed)).toEqual({ status: 'conflict' });
        expect(handleRenderProjectSections.execute(duplicate)).toEqual({ status: 'conflict' });
        mocks.getAgentSectionRenderArtifacts.mockReturnValue([
            {
                ...createJob({ sectionId: 'other-section' }),
                owner: 'agent-section-render',
                retention: 'session',
            },
        ]);
        expect(handleRenderProjectSections.execute(conflict)).toEqual({ status: 'conflict' });
        expect(mocks.renderAgentProjectSections).not.toHaveBeenCalled();
    });

    it('describes exact session artifacts and a guarded inverse', () => {
        const jobs = [
            createJob(),
            createJob({
                jobId: 'render-chorus-two',
                sectionId: 'section-chorus-two',
                sectionName: 'Chorus Two',
                startBeat: 64,
                endBeat: 96,
            }),
        ];
        const action = createAction(jobs);

        expect(handleRenderProjectSections.describe(action)).toEqual({
            label: 'Render "Chorus One" (section-chorus-one) as render-chorus-one, "Chorus Two" (section-chorus-two) as render-chorus-two into session-owned artifacts',
            inverseAction: {
                type: 'removeRenderedProjectSections',
                payload: { sectionIds: ['section-chorus-one', 'section-chorus-two'], jobs },
            },
        });
        expect(handleRenderProjectSections.undoable).toBe(true);
        expect(handleRenderProjectSections.canReapplyAfterDivergence?.(action)).toBe(true);
        expect(
            handleRemoveRenderedProjectSections.canReapplyAfterDivergence?.({
                type: 'removeRenderedProjectSections',
                payload: { sectionIds: ['section-chorus-one', 'section-chorus-two'], jobs },
            })
        ).toBe(true);
    });
});
