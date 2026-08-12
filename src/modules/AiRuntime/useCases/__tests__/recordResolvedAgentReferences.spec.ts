import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentReferenceHistoryStore } from '../../stores/agentReferenceHistoryStore';
import { recordResolvedAgentReferences } from '../recordResolvedAgentReferences';

describe('recordResolvedAgentReferences', () => {
    beforeEach(() => {
        agentReferenceHistoryStore.set([]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('records resolved stable IDs and refreshes only the references in the latest proposal', () => {
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200);
        recordResolvedAgentReferences([
            {
                id: 'track-vocals',
                confidence: 1,
                evidence: [{ kind: 'exact-name', value: 'Vocals' }],
            },
            {
                id: 'track-bass',
                confidence: 0.95,
                evidence: [{ kind: 'role', value: 'low end' }],
            },
        ]);
        recordResolvedAgentReferences([
            {
                id: 'track-vocals',
                confidence: 0.75,
                evidence: [{ kind: 'fuzzy-name', value: 'Vocals' }],
            },
        ]);

        expect(agentReferenceHistoryStore.value).toEqual([
            {
                id: 'track-bass',
                referencedAt: 100,
                confidence: 0.95,
                evidence: [{ kind: 'role', value: 'low end' }],
            },
            {
                id: 'track-vocals',
                referencedAt: 200,
                confidence: 0.75,
                evidence: [{ kind: 'fuzzy-name', value: 'Vocals' }],
            },
        ]);
    });
});
