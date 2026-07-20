import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { mcuSetFader } from '../mcuSetFader';

const initialState = controlSurfaceStore.value;

describe('mcuSetFader', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it('rounds and clamps the target fader position without touching the others', () => {
        mcuSetFader(2, 1023.6);
        mcuSetFader(0, -50);

        const faders = controlSurfaceStore.value?.mcu.faders;
        expect(faders?.[2]?.position).toBe(1023);
        expect(faders?.[0]?.position).toBe(0);
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        mcuSetFader(0, 500);

        expect(controlSurfaceStore.value).toBeNull();
    });
});
