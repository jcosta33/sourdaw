import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type DeviceRef = {
    trackId: string;
    deviceId: string;
};

type SetPadParam = (pad: number, name: string, value: number) => void;

type ToasterControls = {
    ready: boolean;
    setPadParam: SetPadParam;
};

type TrackStrip = {
    deviceNodes: Array<{
        toasterControls?: ToasterControls;
    }>;
};

const mockFindDeviceRef = vi.hoisted(() => vi.fn<(deviceId: string) => DeviceRef | null>(() => null));
const mockGetTrackStrip = vi.hoisted(() => vi.fn<(trackId: string) => TrackStrip | undefined>());
const mockUpdatePad = vi.hoisted(() => vi.fn<(deviceId: string, padIndex: number, updates: unknown) => void>());

vi.mock('../helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../helpers')>();
    return { ...actual, findDeviceRef: mockFindDeviceRef };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

vi.mock('../../../stores/toasterStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../stores/toasterStore')>()),
    updatePad: mockUpdatePad,
}));

import { setToasterPadParam } from '../setToasterPadParam';

describe('setToasterPadParam', () => {
    let rafCallbacks: FrameRequestCallback[];
    let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn<typeof globalThis, 'requestAnimationFrame'>>;
    let setPadParam: ReturnType<typeof vi.fn<SetPadParam>>;

    function flushFrame(): void {
        const callbacks = rafCallbacks;
        rafCallbacks = [];
        for (const callback of callbacks) {
            callback(0);
        }
    }

    function wireReadyToasterControls(): void {
        setPadParam = vi.fn<SetPadParam>();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ toasterControls: { ready: true, setPadParam } }],
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        rafCallbacks = [];
        requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        mockFindDeviceRef.mockReturnValue({ trackId: 'track-1', deviceId: 'dev-1' });
        wireReadyToasterControls();
    });

    afterEach(() => {
        requestAnimationFrameSpy.mockRestore();
    });

    it('should expose only setToasterPadParam from the defining file', async () => {
        const moduleExports = await import('../setToasterPadParam');
        expect(Object.keys(moduleExports).sort()).toEqual(['setToasterPadParam']);
    });

    it('should write numeric pad keys to the store before runtime dispatch', () => {
        setToasterPadParam('dev-1', 2, 'tune', 7);

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 2, { tune: 7 });
        expect(setPadParam).not.toHaveBeenCalled();

        flushFrame();

        expect(setPadParam).toHaveBeenCalledWith(2, 'tune', 7);
    });

    it('should skip store writes for string pad fields', () => {
        const stringFields = ['engineType', 'name', 'color'] as const;

        for (const key of stringFields) {
            setToasterPadParam('dev-1', 0, key, 1);
        }

        expect(mockUpdatePad).not.toHaveBeenCalled();

        flushFrame();

        expect(setPadParam).toHaveBeenCalledTimes(3);
        expect(setPadParam).toHaveBeenCalledWith(0, 'engineType', 1);
        expect(setPadParam).toHaveBeenCalledWith(0, 'name', 1);
        expect(setPadParam).toHaveBeenCalledWith(0, 'color', 1);
    });

    it('should not schedule a frame when no device ref exists', () => {
        mockFindDeviceRef.mockReturnValue(null);

        setToasterPadParam('dev-1', 0, 'decay', 0.6);

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 0, { decay: 0.6 });
        expect(requestAnimationFrameSpy).not.toHaveBeenCalled();
        expect(setPadParam).not.toHaveBeenCalled();
    });

    it('should coalesce repeated writes to one frame and flush only the latest value', () => {
        setToasterPadParam('dev-1', 0, 'tone', 0.1);
        setToasterPadParam('dev-1', 0, 'tone', 0.2);
        setToasterPadParam('dev-1', 0, 'tone', 0.3);

        expect(mockUpdatePad).toHaveBeenCalledTimes(3);
        expect(requestAnimationFrameSpy).toHaveBeenCalledTimes(1);
        expect(setPadParam).not.toHaveBeenCalled();

        flushFrame();

        expect(setPadParam).toHaveBeenCalledTimes(1);
        expect(setPadParam).toHaveBeenCalledWith(0, 'tone', 0.3);
    });

    it('should no-op on flush when the track strip is missing', () => {
        mockGetTrackStrip.mockReturnValue(undefined);

        setToasterPadParam('dev-1', 0, 'drive', 4);
        flushFrame();

        expect(setPadParam).not.toHaveBeenCalled();
    });

    it('should no-op on flush when Toaster controls are missing', () => {
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{}],
        });

        setToasterPadParam('dev-1', 0, 'pan', -0.25);
        flushFrame();

        expect(setPadParam).not.toHaveBeenCalled();
    });
});
