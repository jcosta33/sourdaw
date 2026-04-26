import { describe, it, expect, beforeEach } from 'vitest';

import { grooveStore } from '#/modules/Arrangement/stores/grooveStore';
import { getGrooveOffsetAtBeat } from '#/modules/Arrangement/useCases/groove/applyGrooveTemplate';

describe('getGrooveOffsetAtBeat', () => {
    beforeEach(() => {
        grooveStore.set({
            templates: [
                {
                    id: 'swing',
                    name: 'Swing',
                    offsets: [0, 0.1], // alternate on-beat, off-beat
                    resolution: 0.5,
                },
            ],
            projectGrooveId: 'swing',
            projectGrooveIntensity: 1.0,
        });
    });

    it('should return 0 if no groove is active', () => {
        grooveStore.set({ ...grooveStore.value!, projectGrooveId: null });
        expect(getGrooveOffsetAtBeat(0.5)).toBe(0);
    });

    it('should compute offset based on resolution and intensity', () => {
        // resolution 0.5. beat 0 is step 0, beat 0.5 is step 1.
        expect(getGrooveOffsetAtBeat(0)).toBe(0);
        expect(getGrooveOffsetAtBeat(0.5)).toBe(0.1);
        expect(getGrooveOffsetAtBeat(1.0)).toBe(0);
        expect(getGrooveOffsetAtBeat(1.5)).toBe(0.1);

        // Intensity 0.5
        grooveStore.set({ ...grooveStore.value!, projectGrooveIntensity: 0.5 });
        expect(getGrooveOffsetAtBeat(0.5)).toBe(0.05);
    });
});
