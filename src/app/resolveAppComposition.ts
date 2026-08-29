type AppComposition = 'application' | 'browser-host' | 'desktop-startup-error';

type AppCompositionEnvironment = {
    hasDesktopBridge: boolean;
    isDevelopment: boolean;
    isTopLevel: boolean;
    protocol: string;
    windowName: string;
};

const DIRECT_E2E_VIEWPORT_NAME = 'sourdaw-e2e-direct';

export function resolveAppComposition({
    hasDesktopBridge,
    isDevelopment,
    isTopLevel,
    protocol,
    windowName,
}: AppCompositionEnvironment): AppComposition {
    if (protocol === 'app:') {
        return hasDesktopBridge ? 'application' : 'desktop-startup-error';
    }

    const usesDirectDevelopmentViewport = isDevelopment && windowName === DIRECT_E2E_VIEWPORT_NAME;
    if (hasDesktopBridge || !isTopLevel || usesDirectDevelopmentViewport) {
        return 'application';
    }

    return 'browser-host';
}
