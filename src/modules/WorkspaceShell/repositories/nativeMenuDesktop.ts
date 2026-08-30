import { desktopNativeMenu, isDesktopRuntime } from '#/utils/desktopBridge';

/** Desktop IO stays behind the WorkspaceShell repository boundary. */
export const nativeMenuDesktop = () => (isDesktopRuntime() ? desktopNativeMenu() : undefined);
