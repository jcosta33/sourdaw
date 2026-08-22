import { desktopWindowControls, usesFramelessWindowChrome } from '#/utils/desktopBridge';

export type WindowChromeControls = {
    /** True only on the frameless Linux build, where these controls exist at all. */
    readonly frameless: boolean;
    readonly minimize: () => Promise<void>;
    /** Maximizes or restores; resolves with the resulting maximized state. */
    readonly toggleMaximize: () => Promise<boolean>;
    readonly close: () => Promise<void>;
    readonly isMaximized: () => Promise<boolean>;
    /** Subscribe to maximize/restore transitions. Returns the unsubscribe function. */
    readonly listenMaximized: (callback: (maximized: boolean) => void) => () => void;
};

/**
 * The desktop window-chrome surface behind the frameless Linux build's header
 * controls.
 *
 * The desktop bridge is confined to the repository layer, so the header view
 * reaches the shell's minimize/maximize/close through here and the use case
 * above it rather than importing the IPC seam itself.
 */
export function getWindowChromeControls(): WindowChromeControls {
    return {
        frameless: usesFramelessWindowChrome(),
        minimize: () => desktopWindowControls().minimize(),
        toggleMaximize: () => desktopWindowControls().toggleMaximize(),
        close: () => desktopWindowControls().close(),
        isMaximized: () => desktopWindowControls().isMaximized(),
        listenMaximized: (callback) => desktopWindowControls().listenMaximized(callback),
    };
}
