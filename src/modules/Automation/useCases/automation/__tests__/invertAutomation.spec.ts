import { describe, it, expect, beforeEach } from 'vitest';

import { automationStore, type AutomationLane } from '../../../stores/automationStore';
import { invertAutomation } from '../invertAutomation';

const lane: AutomationLane = {
    id: 'lane-1',
    trackId: 't1',
    parameterId: 'p',
    parameterName: 'P',
    points: [{ beat: 0, value: 0.25, curve: 'linear', tension: 0 }],
    objects: [],
    visible: true,
    enabled: true,
    collapsed: false,
    minValue: 0,
    maxValue: 1,
};

describe('invertAutomation', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [{ ...lane }] });
    });

    it('should not write when the automation store is null', () => {
        automationStore.set(null);
        invertAutomation('lane-1');
        expect(automationStore.value).toBeNull();
    });

    it('should invert point values around the lane min/max range', () => {
        invertAutomation('lane-1');

        const param = automationStore.value?.lanes[0]?.points[0];
        expect(param?.value).toBeCloseTo(0.75);
    });
});
