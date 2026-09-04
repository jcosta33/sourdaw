import { beforeEach, describe, expect, it } from 'vitest';

import {
    createDefaultProductionBrief,
    type ProductionBrief,
    type ProductionDecision,
} from '../../models/ProductionBrief';
import { defaultProjectStoreState, projectStore } from '../../stores/projectStore';
import { getProjectScopedBriefLock } from '../getProjectScopedBriefLock';

const decision = (overrides: Partial<ProductionDecision>): ProductionDecision => ({
    id: 'decision-1',
    scope: { kind: 'project' },
    statement: 'Keep the arrangement as approved',
    rationale: null,
    status: 'locked',
    sourceRunId: null,
    relatedBatchId: null,
    supersededByDecisionId: null,
    createdAt: 101,
    ...overrides,
});

const setBrief = (overrides: Partial<ProductionBrief>): void => {
    projectStore.set({
        ...structuredClone(defaultProjectStoreState),
        productionBrief: { ...createDefaultProductionBrief(100), ...overrides },
    });
};

describe('getProjectScopedBriefLock', () => {
    beforeEach(() => {
        setBrief({});
    });

    it('reports the lock that protects the whole project', () => {
        setBrief({
            locks: [
                {
                    id: 'lock-whole-project',
                    scope: { kind: 'project' },
                    statement: 'Freeze the whole arrangement for the client review',
                    createdAt: 101,
                },
            ],
        });

        expect(getProjectScopedBriefLock()).toEqual({
            id: 'lock-whole-project',
            kind: 'lock',
            statement: 'Freeze the whole arrangement for the client review',
        });
    });

    it('reports nothing for a lock scoped to one track', () => {
        setBrief({
            locks: [
                {
                    id: 'lock-drums',
                    scope: { kind: 'track', trackId: 'track-drums' },
                    statement: 'Keep the drums as they are',
                    createdAt: 101,
                },
            ],
        });

        expect(getProjectScopedBriefLock()).toBeNull();
    });

    it('reports a locked decision that covers the whole project', () => {
        setBrief({ decisions: [decision({ id: 'decision-frozen', statement: 'The arrangement is final' })] });

        expect(getProjectScopedBriefLock()).toEqual({
            id: 'decision-frozen',
            kind: 'decision',
            statement: 'The arrangement is final',
        });
    });

    it('reports nothing for an accepted decision that covers the whole project', () => {
        setBrief({ decisions: [decision({ status: 'accepted' })] });

        expect(getProjectScopedBriefLock()).toBeNull();
    });

    it('reports nothing without a project', () => {
        projectStore.set(null);

        expect(getProjectScopedBriefLock()).toBeNull();
    });
});
