type AppComposition = 'application' | 'browser-host' | 'desktop-startup-error';

type AppCompositionEnvironment = {
    hasDesktopBridge: boolean;
    isDevelopment: boolean;
    isTopLevel: boolean;
    protocol: string;
    userAgent: string;
    windowName: string;
};

const DIRECT_E2E_VIEWPORT_NAME = 'sourdaw-e2e-direct';

export const BROWSER_APPLICATION_FRAME_NAME = 'sourdaw-application';

export function resolveAppComposition({
    hasDesktopBridge,
    isDevelopment,
    isTopLevel,
    protocol,
    userAgent,
    windowName,
}: AppCompositionEnvironment): AppComposition {
    const isElectronDocument = protocol === 'app:' || userAgent.includes('Electron/');
    if (isElectronDocument) {
        return hasDesktopBridge ? 'application' : 'desktop-startup-error';
    }

    const usesDirectDevelopmentViewport = isDevelopment && windowName === DIRECT_E2E_VIEWPORT_NAME;
    if (!isTopLevel || usesDirectDevelopmentViewport) {
        return 'application';
    }

    return 'browser-host';
}
