import { describe, expect, it } from 'vitest';

import { changesLinkedValuesByActionType } from '../ChangesLinkedValuesByActionType';

describe('changesLinkedValuesByActionType', () => {
    it('withholds exactly the lane creation, enabled flag and automation mode from changing source points', () => {
        const unchanged = Object.entries(changesLinkedValuesByActionType)
            .filter(([, changes]) => !changes)
            .map(([type]) => type);

        expect(unchanged.toSorted()).toEqual(['addAutomationLane', 'setAutomationLaneEnabled', 'setAutomationMode']);
    });

    it('counts an action type the list does not withhold as changing linked values', () => {
        expect(changesLinkedValuesByActionType.addAutomationPoint).toBe(true);
    });
});
