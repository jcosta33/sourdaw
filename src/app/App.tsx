import { type ReactElement, Suspense } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';

import { TooltipProvider } from '#/components/ui/tooltip';
import { WorkspaceAppBoundary, WorkspaceProjectLoadingFallback } from '#/modules/WorkspaceShell/presentations/views';

import { queryClient } from './queryClient';
import { registerDeviceEnginePorts } from './registerDeviceEnginePorts';
import { registerSupportingServicePorts } from './registerSupportingServicePorts';
import { router } from './router';

// `main.tsx` loads this module and `bootstrap` independently, and the preset
// browser reads factory presets while it renders, so the device and supporting
// service ports must be in place before the first render whichever of the two
// evaluates first.
registerDeviceEnginePorts();
registerSupportingServicePorts();

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
