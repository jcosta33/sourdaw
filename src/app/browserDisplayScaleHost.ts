const DISPLAY_SCALE_MESSAGE_TYPE = 'sourdaw:browser-display-scale';
const MIN_DISPLAY_SCALE = 0.5;
const MAX_DISPLAY_SCALE = 2;

function isSupportedDisplayScale(value: unknown): value is number {
    return (
        typeof value === 'number' && Number.isFinite(value) && value >= MIN_DISPLAY_SCALE && value <= MAX_DISPLAY_SCALE
    );
}

function readDisplayScale(data: unknown): number | null {
    if (typeof data !== 'object' || data === null || !('type' in data) || !('scale' in data)) {
        return null;
    }
    if (data.type !== DISPLAY_SCALE_MESSAGE_TYPE || !isSupportedDisplayScale(data.scale)) {
        return null;
    }
    return data.scale;
}

function sizeViewport(frame: HTMLIFrameElement, scale: number): void {
    frame.style.height = `${String(100 / scale)}vh`;
    frame.style.transform = `scale(${String(scale)})`;
    frame.style.width = `${String(100 / scale)}vw`;
}

export function mountBrowserDisplayScaleHost(root: HTMLElement): void {
    document.documentElement.style.height = '100%';
    document.documentElement.style.overflow = 'hidden';
    document.documentElement.style.width = '100%';
    document.body.style.height = '100%';
    document.body.style.margin = '0';
    document.body.style.overflow = 'hidden';
    document.body.style.width = '100%';
    root.style.height = '100%';
    root.style.overflow = 'hidden';
    root.style.position = 'relative';
    root.style.width = '100%';

    const frame = document.createElement('iframe');
    frame.title = 'Sourdaw';
    frame.src = window.location.href;
    frame.style.border = '0';
    frame.style.display = 'block';
    frame.style.left = '0';
    frame.style.position = 'absolute';
    frame.style.top = '0';
    frame.style.transformOrigin = 'top left';
    sizeViewport(frame, 1);
    root.replaceChildren(frame);

    const handleDisplayScale = (event: MessageEvent): void => {
        if (event.origin !== window.location.origin || event.source !== frame.contentWindow) {
            return;
        }
        const scale = readDisplayScale(event.data);
        if (scale === null) {
            return;
        }
        sizeViewport(frame, scale);
    };
    const handlePageHide = (event: PageTransitionEvent): void => {
        if (!event.persisted) {
            window.removeEventListener('message', handleDisplayScale);
            window.removeEventListener('pagehide', handlePageHide);
        }
    };
    window.addEventListener('message', handleDisplayScale);
    window.addEventListener('pagehide', handlePageHide);
}
