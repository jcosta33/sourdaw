import { describe, expect, it } from 'vitest';

import { createRendererSessionLifecycle } from '../rendererSessionLifecycle.js';

describe('renderer session lifecycle', () => {
    it('does not recreate a renderer that crashes while approved editor-detach teardown is still pending', () => {
        const lifecycle = createRendererSessionLifecycle();

        lifecycle.startWindow();
        lifecycle.approveTeardown();

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(false);
    });

    it('allows crash recovery again for a replacement session window', () => {
        const lifecycle = createRendererSessionLifecycle();

        lifecycle.approveTeardown();
        lifecycle.startWindow();

        expect(lifecycle.shouldRecreateAfterCrash()).toBe(true);
    });
});
