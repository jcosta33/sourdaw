import { logger } from '#/infra/logger/appLogger';
import { desktopGpuMemoryBudgetBytes, desktopTotalMemoryBytes, isDesktopRuntime } from '#/utils/desktopBridge';

export type MachineMemoryFigures = {
    totalBytes: number;
    /** What the GPU can hold, or null where the desktop shell cannot say. */
    gpuBudgetBytes: number | null;
};

/** A GPU budget the shell could not read is unknown, not a reason to discard the total that was read. */
async function readGpuBudgetBytes(): Promise<number | null> {
    try {
        return await desktopGpuMemoryBudgetBytes();
    } catch (error) {
        logger.warn('The desktop shell could not report the GPU memory budget; Large is not offered', { error });
        return null;
    }
}

/** Total physical memory and the GPU budget in bytes, or null where no desktop shell can report them (a plain browser). */
export async function readMachineMemoryFigures(): Promise<MachineMemoryFigures | null> {
    if (!isDesktopRuntime()) {
        return null;
    }
    const [totalBytes, gpuBudgetBytes] = await Promise.all([desktopTotalMemoryBytes(), readGpuBudgetBytes()]);
    return { totalBytes, gpuBudgetBytes };
}
