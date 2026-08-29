type BrowserViewportComposition = {
    isDevelopment: boolean;
    isDesktopRuntime: boolean;
    isTopLevel: boolean;
    windowName: string;
};

const DIRECT_E2E_VIEWPORT_NAME = 'sourdaw-e2e-direct';

export function shouldHostBrowserViewport({
    isDevelopment,
    isDesktopRuntime,
    isTopLevel,
    windowName,
}: BrowserViewportComposition): boolean {
    const usesDirectDevelopmentViewport = isDevelopment && windowName === DIRECT_E2E_VIEWPORT_NAME;
    return !usesDirectDevelopmentViewport && !isDesktopRuntime && isTopLevel;
}
