import { createMemoryHistory, createRouter, isNotFound } from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { queryClient } from '#/app/queryClient';
import { routeTree } from '#/routeTree.gen';

function createGalleryRouter() {
    return createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ['/dev/control-gallery'] }),
        context: { queryClient },
    });
}

describe('development control gallery route', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it('admits the gallery in development', async () => {
        vi.stubEnv('DEV', true);
        const router = createGalleryRouter();

        await router.load();

        expect(router.state.matches.at(-1)?.status).toBe('success');
    });

    it('returns a recognized not-found result outside development', async () => {
        vi.stubEnv('DEV', false);
        const router = createGalleryRouter();

        await router.load();

        const match = router.state.matches.at(-1);
        expect(match?.status).toBe('notFound');
        expect(isNotFound(match?.error)).toBe(true);
    });
});
