import { beforeEach, describe, expect, it } from 'vitest';

import { createAutomationLane } from '../../../models/Automation';
import { automationStore } from '../../../stores/automationStore';
import * as subject from '../addAutomationLane';

describe('addAutomationLane', () => {
    beforeEach(() => {
        automationStore.set({ lanes: [] });
    });

    it('should export addAutomationLane', () => {
        expect(subject.addAutomationLane).toBeDefined();
        const time = typeof subject.addAutomationLane;
        expect(time === 'function' || time === 'object').toBe(true);
    });

    it('adds a track lane when the same parameter already has a clip lane', () => {
        const clipLane = createAutomationLane('track-1', 'gain', 'Gain', 0, 1, 'clip-1');
        automationStore.set({ lanes: [clipLane] });

        subject.addAutomationLane('track-1', 'gain', 'Gain');

        expect(automationStore.value?.lanes).toHaveLength(2);
        expect(automationStore.value?.lanes).toContainEqual(
            expect.objectContaining({ trackId: 'track-1', clipId: undefined })
        );
    });
});
