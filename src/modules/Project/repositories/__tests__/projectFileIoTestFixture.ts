import { vi } from 'vitest';

type DesktopBridgeModule = typeof import('#/utils/desktopBridge');
type DesktopRuntimeModule = typeof import('#/utils/desktopRuntime');

const projectFileIoFixture = vi.hoisted(() => ({
    desktop: false,
    desktopSaveDialog: vi.fn<DesktopBridgeModule['desktopSaveDialog']>(),
    writeFileBytes: vi.fn<DesktopBridgeModule['writeFileBytes']>(() => Promise.resolve()),
}));

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

export { projectFileIoFixture };

export function resetProjectFileIoFixture(): void {
    projectFileIoFixture.desktop = false;
    projectFileIoFixture.desktopSaveDialog.mockReset();
    projectFileIoFixture.writeFileBytes.mockClear();
}
