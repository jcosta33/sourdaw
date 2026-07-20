import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { mcuUpdateTimecode } from '../mcuUpdateTimecode';

const initialState = controlSurfaceStore.value;

describe('mcuUpdateTimecode', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it('formats bars/beats/ticks into a zero-padded timecode string', () => {
        mcuUpdateTimecode(5, 2, 17);

        expect(controlSurfaceStore.value?.mcu.timecodeDisplay).toBe('005:02:017');
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        mcuUpdateTimecode(1, 1, 1);

        expect(controlSurfaceStore.value).toBeNull();
    });
});
