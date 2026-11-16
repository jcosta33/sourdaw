import { desktopTotalMemoryBytes, isDesktopRuntime } from '#/utils/desktopBridge';

/** Total physical memory in bytes, or null where no desktop shell can report it (a plain browser). */
export async function readMachineTotalMemoryBytes(): Promise<number | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    return desktopTotalMemoryBytes();
}
