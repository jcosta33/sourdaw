import { isDesktopRuntime } from '#/utils/desktopBridge';

// eslint-disable-next-line @typescript-eslint/require-await -- callers expect Promise<boolean>
export async function isAudioAiServerRunning(): Promise<boolean> {
    return isDesktopRuntime();
}
