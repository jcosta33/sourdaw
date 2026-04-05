import { type ReactElement, Suspense } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from '#/components/ui/tooltip';
import { ErrorBoundary } from '#/modules/Workspace/presentations/components/ErrorBoundary';
import { ProjectLoadingOverlay } from '#/modules/Workspace/presentations/components/ProjectLoadingOverlay';
import { Analytics } from '@vercel/analytics/react';
import { queryClient } from './queryClient';
import { router } from './router';

export const App = (): ReactElement => {
    return (
        <ErrorBoundary>
            <QueryClientProvider client={queryClient}>
                <TooltipProvider>
                    <Suspense fallback={<ProjectLoadingOverlay />}>
                        <RouterProvider router={router} />
                    </Suspense>
                </TooltipProvider>
            </QueryClientProvider>
            <Analytics />
        </ErrorBoundary>
    );
};
