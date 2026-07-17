import { createRouter } from '@tanstack/react-router';

import { routeTree } from '#/routeTree.gen';

import { queryClient } from './queryClient';

export const router = createRouter({
    routeTree,
    defaultPreload: 'intent',
    scrollRestoration: true,
    context: {
        queryClient,
    },
});

declare module '@tanstack/react-router' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions
    interface Register {
        router: typeof router;
    }
}
