import { vi } from 'vitest';

type DesktopBridgeModule = typeof import('#/utils/desktopBridge');
type DesktopRuntimeModule = typeof import('#/utils/desktopRuntime');

export type ProjectFileIoNativeWrite = {
    readonly bytes: Uint8Array;
    readonly path: string;
};

const projectFileIoFixture = vi.hoisted(() => {
    const nativeWrites: ProjectFileIoNativeWrite[] = [];
    return {
        desktop: false,
        desktopSaveDialog: vi.fn<DesktopBridgeModule['desktopSaveDialog']>(),
        nativeWrites,
        writeFileBytes: vi.fn<DesktopBridgeModule['writeFileBytes']>(({ bytes, path }) => {
            nativeWrites.push({ bytes, path });
            return Promise.resolve();
        }),
    };
});

vi.mock('#/utils/desktopBridge', async (importOriginal) => ({
    ...(await importOriginal<DesktopBridgeModule>()),
    desktopSaveDialog: projectFileIoFixture.desktopSaveDialog,
    isDesktopRuntime: () => projectFileIoFixture.desktop,
    writeFileBytes: projectFileIoFixture.writeFileBytes,
}));

vi.mock('#/utils/desktopRuntime', async (importOriginal) => ({
    ...(await importOriginal<DesktopRuntimeModule>()),
    isDesktopRuntime: () => projectFileIoFixture.desktop,
}));

export function resetProjectFileIoFixture(): void {
    projectFileIoFixture.desktop = false;
    projectFileIoFixture.desktopSaveDialog.mockReset();
    projectFileIoFixture.writeFileBytes.mockClear();
    projectFileIoFixture.nativeWrites.length = 0;
}

export function setProjectFileIoDesktopRuntime(desktop: boolean): void {
    projectFileIoFixture.desktop = desktop;
}

export function queueProjectFileIoSaveDialog(result: Promise<string | null>): void {
    projectFileIoFixture.desktopSaveDialog.mockReturnValueOnce(result);
}

export function getProjectFileIoSaveDialogCallCount(): number {
    return projectFileIoFixture.desktopSaveDialog.mock.calls.length;
}

export function getProjectFileIoNativeWrites(): readonly ProjectFileIoNativeWrite[] {
    return projectFileIoFixture.nativeWrites;
}
