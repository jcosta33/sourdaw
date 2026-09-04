import { describe, expect, it } from 'vitest';

import { type AgentProjectRepairState } from '#/modules/CrdtDocument/stores';

import { deriveProjectMutationRefusal, type ProjectScopedBriefLock } from '../useProjectMutationRefusal';

const repairState = (overrides: Partial<AgentProjectRepairState> = {}): AgentProjectRepairState => ({
    audioGraphValid: true,
    detectedRevision: 'revision-1',
    inspectionAvailable: true,
    projectInvariantsValid: true,
    rawProjectRetained: true,
    repairCandidates: [],
    status: 'repair-required',
    ...overrides,
});

const briefLock: ProjectScopedBriefLock = {
    id: 'lock-whole-project',
    kind: 'lock',
    statement: 'Freeze the whole arrangement',
};

describe('deriveProjectMutationRefusal', () => {
    it('reports the repair state with its conflict count and validity flags', () => {
        expect(
            deriveProjectMutationRefusal(
                repairState({
                    audioGraphValid: false,
                    projectInvariantsValid: false,
                    repairCandidates: [
                        {
                            kind: 'choose-automerge-conflict-value',
                            conflictIds: ['c1'],
                            path: ['tracks'],
                            targetIds: [],
                        },
                        {
                            kind: 'choose-automerge-conflict-value',
                            conflictIds: ['c2'],
                            path: ['clips'],
                            targetIds: [],
                        },
                        { kind: 'repair-project-invariants', targetIds: [] },
                    ],
                }),
                null
            )
        ).toEqual({
            audioGraphValid: false,
            conflictCount: 2,
            invariantsValid: false,
            kind: 'repair-required',
        });
    });

    it('reports the project-wide brief lock with its statement', () => {
        expect(deriveProjectMutationRefusal(null, briefLock)).toEqual({
            kind: 'production-brief-lock',
            statement: 'Freeze the whole arrangement',
        });
    });

    it('reports the repair state when a brief lock is also present', () => {
        expect(deriveProjectMutationRefusal(repairState(), briefLock)).toMatchObject({ kind: 'repair-required' });
    });

    it('reports nothing when neither gate is closed', () => {
        expect(deriveProjectMutationRefusal(null, null)).toBeNull();
    });
});
