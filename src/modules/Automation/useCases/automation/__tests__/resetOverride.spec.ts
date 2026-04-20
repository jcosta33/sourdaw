import { describe, it, expect, vi, beforeEach } from 'vitest';

import { automationStore } from '../../../stores/automationStore';
import { resetOverride } from '../resetOverride';

describe('resetOverride', () => {
    beforeEach(() => {
        automationStore.set({
            lanes: [
                {
                    id: 'l1',
                    trackId: 't1',
                    parameterId: 'p1',
                    parameterName: 'P1',
                    points: [],
                    objects: [
                        {
                            id: 'o1',
                            laneId: 'l1',
                            startBeat: 0,
                            endBeat: 4,
                            points: [],
                            name: 'Obj 1',
                            overrides: { points: true },
                        },
                    ],
                    visible: true,
                    enabled: true,
                    collapsed: false,
                    virginTerritory: false,
                    minValue: 0,
                    maxValue: 1,
                },
            ],
        });
    });

    it('should remove property from overrides map', () => {
        resetOverride('l1', 'o1', 'points');
        const lane = automationStore.value?.lanes[0];
        expect(lane?.objects[0]?.overrides?.points).toBeUndefined();
    });
});
