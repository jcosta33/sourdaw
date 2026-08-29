import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    bridge: { display: { setZoomFactor: vi.fn() } },
    createSourdawBridge: vi.fn(),
    exposeInMainWorld: vi.fn(),
    ipcRenderer: {},
    setZoomFactor: vi.fn(),
}));

vi.mock('electron', () => ({
    contextBridge: { exposeInMainWorld: mocks.exposeInMainWorld },
    ipcRenderer: mocks.ipcRenderer,
    webFrame: { setZoomFactor: mocks.setZoomFactor },
}));

vi.mock('../bridge.js', () => ({
    createSourdawBridge: mocks.createSourdawBridge,
}));

describe('preload display zoom wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mocks.createSourdawBridge.mockReturnValue(mocks.bridge);
    });

    it('routes the published display capability to webFrame.setZoomFactor', async () => {
        await import('../preload.js');

        expect(mocks.exposeInMainWorld).toHaveBeenCalledWith('sourdaw', mocks.bridge);
        expect(mocks.createSourdawBridge).toHaveBeenCalledWith(
            mocks.ipcRenderer,
            undefined,
            undefined,
            undefined,
            expect.any(Function)
        );

        const setDisplayZoom = mocks.createSourdawBridge.mock.calls[0]?.[4] as ((factor: number) => void) | undefined;
        expect(setDisplayZoom).toBeTypeOf('function');
        setDisplayZoom?.(1.75);
        expect(mocks.setZoomFactor).toHaveBeenCalledWith(1.75);
    });
});
