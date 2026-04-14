import { describe, it, expect, beforeEach } from 'vitest';
import { automationStore, type AutomationLane } from '../../../stores/automationStore';
import { resetYZoom } from '../resetYZoom';

const lane: AutomationLane = {
    id: 'lane-1',
    trackId: 't1',
    parameterId: 'p',
    parameterName: 'P',
    points: [],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    virginTerritory: false,
    minValue: 0,
    maxValue: 1,
    viewMinValue: 0.1,
    viewMaxValue: 0.9,
};

describe('resetYZoom', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [{ ...lane }] });
    });

    it('should not write when the automation store is null', () => {
        automationStore.set(null);
        resetYZoom('lane-1');
        expect(automationStore.value).toBeNull();
    });

    it('should clear view min/max for the matching lane', () => {
        resetYZoom('lane-1');

        const l = automationStore.value?.lanes[0];
        expect(l?.viewMinValue).toBeUndefined();
        expect(l?.viewMaxValue).toBeUndefined();
    });
});
