import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { mcuSetMode } from '../mcuSetMode';

const initialState = controlSurfaceStore.value;

describe('mcuSetMode', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it.each([
        ['pan', 'PAN'],
        ['send', 'SND'],
        ['plugin', 'PLG'],
    ] as const)('sets mode %s and its assignment display to %s', (mode, display) => {
        mcuSetMode(mode);

        expect(controlSurfaceStore.value?.mcu.mode).toBe(mode);
        expect(controlSurfaceStore.value?.mcu.assignmentDisplay).toBe(display);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        mcuSetMode('send');

        expect(controlSurfaceStore.value).toBeNull();
    });
});
