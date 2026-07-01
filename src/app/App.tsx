import { type ReactElement, Suspense } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { TooltipProvider } from '#/components/ui/tooltip';
import { WorkspaceAppBoundary, WorkspaceProjectLoadingFallback } from '#/modules/Workspace/presentations/views';

import { queryClient } from './queryClient';
import { router } from './router';

export const App = (): ReactElement => {
    return (
        <WorkspaceAppBoundary>
            <QueryClientProvider client={queryClient}>
                <TooltipProvider>
                    <Suspense fallback={<WorkspaceProjectLoadingFallback />}>
                        <RouterProvider router={router} />
                    </Suspense>
                </TooltipProvider>
            </QueryClientProvider>
        </WorkspaceAppBoundary>
    );
};
