import { type ReactElement, Suspense } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { TooltipProvider } from "#/components/ui/tooltip";
import { queryClient } from "./queryClient";
import { router } from "./router";

export const App = (): ReactElement => {
    return (
        <QueryClientProvider client={queryClient}>
            <TooltipProvider>
                <Suspense fallback={<AppLoadingFallback />}>
                    <RouterProvider router={router} />
                </Suspense>
            </TooltipProvider>
        </QueryClientProvider>
    );
};

const AppLoadingFallback = (): ReactElement => {
    return (
        <div className="flex h-screen w-screen items-center justify-center bg-background">
            <p className="text-muted-foreground text-sm">Loading WebDAW...</p>
        </div>
    );
};
