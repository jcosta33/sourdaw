import { describe, expect, it } from 'vitest';

import { createDefaultProductionBrief, type ProductionBrief } from '../../models/ProductionBrief';
import { describeProductionBriefChange } from '../describeProductionBriefChange';

const before: ProductionBrief = {
    ...createDefaultProductionBrief(100),
    vision: 'Warm and roomy',
    references: [{ id: 'old-ref', label: 'Old demo', uri: null, assetHash: null, createdAt: 100 }],
    locks: [{ id: 'lock-drums', scope: { kind: 'track', trackId: 'drums' }, statement: 'Drums', createdAt: 100 }],
};

describe('describe a production brief change', () => {
    it('lists each added entry with its scope named, and counts the locks kept', () => {
        const after: ProductionBrief = {
            ...before,
            revision: 1,
            vision: 'Late-night lo-fi record',
            references: [{ id: 'new-ref', label: 'Rainy tape demo', uri: null, assetHash: null, createdAt: 200 }],
            hardConstraints: [
                { id: 'c', scope: { kind: 'track', trackId: 'vocal' }, statement: 'Keep it intimate', createdAt: 200 },
            ],
            preferences: [{ id: 'p', scope: { kind: 'project' }, statement: 'Dusty', createdAt: 200 }],
            sectionGoals: [{ id: 'g', sectionId: 'chorus', statement: 'Lift a little', createdAt: 200 }],
            trackRoles: [{ id: 'r', trackId: 'ghost', role: 'keys', createdAt: 200 }],
        };

        expect(
            describeProductionBriefChange({
                before,
                after,
                trackNames: { vocal: 'Vox' },
                sectionNames: { chorus: 'Chorus 1' },
            })
        ).toEqual([
            'Vision: Late-night lo-fi record',
            'Reference: Rainy tape demo',
            'Reference removed: Old demo',
            'Must hold (Vox): Keep it intimate',
            'Preference (whole project): Dusty',
            'Chorus 1 goal: Lift a little',
            'Role: an unnamed track is the keys',
            'Locks kept: 1',
        ]);
    });

    it('describes nothing for a payload that is not a brief', () => {
        expect(
            describeProductionBriefChange({
                before,
                after: { ...before, locks: 'none' },
                trackNames: {},
                sectionNames: {},
            })
        ).toBeNull();
        expect(
            describeProductionBriefChange({
                before: { ...before, schemaVersion: 2 },
                after: before,
                trackNames: {},
                sectionNames: {},
            })
        ).toBeNull();
    });

    it('lists nothing for entries both briefs hold', () => {
        expect(describeProductionBriefChange({ before, after: before, trackNames: {}, sectionNames: {} })).toEqual([
            'Locks kept: 1',
        ]);
    });
});
