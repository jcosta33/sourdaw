import { describe, it, expect, beforeEach } from 'vitest';

import { automationStore, type AutomationLane } from '../../stores/automationStore';
import { getAutomationLanes } from '../getAutomationLanes';

const minimalLane: AutomationLane = {
    id: 'lane-1',
    trackId: 't1',
    parameterId: 'p1',
    parameterName: 'Param',
    points: [],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};

describe('getAutomationLanes', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should return an empty array when the automation store is null', () => {
        automationStore.set(null);
        expect(getAutomationLanes()).toEqual([]);
    });

    it('should return an empty array when the store has no lanes', () => {
        expect(getAutomationLanes()).toEqual([]);
    });

    it('should return the lanes array from the current store snapshot', () => {
        const lanes = [minimalLane];
        automationStore.set({ lanes });
        expect(getAutomationLanes()).toBe(lanes);
    });
});
