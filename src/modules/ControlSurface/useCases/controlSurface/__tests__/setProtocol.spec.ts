import { describe, it, expect, beforeEach } from 'vitest';

import { controlSurfaceStore } from '../../../stores/controlSurface';
import { setProtocol } from '../setProtocol';

const initialState = controlSurfaceStore.value;

describe('setProtocol', () => {
    beforeEach(() => {
        controlSurfaceStore.set(initialState);
    });

    it('sets the active protocol', () => {
        setProtocol('osc');

        expect(controlSurfaceStore.value?.protocol).toBe('osc');
    });

    it('is a no-op when the control surface has no state', () => {
        controlSurfaceStore.set(null);

        setProtocol('hui');

        expect(controlSurfaceStore.value).toBeNull();
    });
});
