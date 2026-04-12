import { afterEach, describe, expect, it } from 'vitest';

import { getPreferredRendererBackend } from '../RendererBackend';

describe('getPreferredRendererBackend', () => {
    afterEach(() => {
        Reflect.deleteProperty(navigator, 'gpu');
    });

    it('uses canvas2d when WebGPU is not exposed on navigator', () => {
        expect(getPreferredRendererBackend()).toBe('canvas2d');
    });

    it('selects webgpu when navigator.gpu is present', () => {
        Object.defineProperty(navigator, 'gpu', {
            configurable: true,
            value: {},
        });
        expect(getPreferredRendererBackend()).toBe('webgpu');
    });
});
