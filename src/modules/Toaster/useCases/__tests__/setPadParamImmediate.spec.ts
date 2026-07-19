import { describe, it, expect, vi, beforeEach } from 'vitest';

type DeviceRef = { trackId: string; deviceId: string };
type SetPadParam = (pad: number, name: string, value: number) => void;
type ToasterControls = { ready: boolean; setPadParam: SetPadParam };
type TrackStrip = { deviceNodes: Array<{ toasterControls?: ToasterControls }> };

const mockFindDeviceRef = vi.hoisted(() => vi.fn<(deviceId: string) => DeviceRef | null>(() => null));
const mockGetTrackStrip = vi.hoisted(() => vi.fn<(trackId: string) => TrackStrip | undefined>());
const mockUpdatePad = vi.hoisted(() => vi.fn<(deviceId: string, padIndex: number, updates: unknown) => void>());

vi.mock('../toasterParamBridge/helpers', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../toasterParamBridge/helpers')>();
    return { ...actual, findDeviceRef: mockFindDeviceRef };
});

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mockGetTrackStrip,
}));

vi.mock('../../stores/toasterStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../stores/toasterStore')>()),
    updatePad: mockUpdatePad,
}));

import { setPadParamImmediate } from '../setPadParamImmediate';

describe('setPadParamImmediate', () => {
    let setPadParam: ReturnType<typeof vi.fn<SetPadParam>>;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFindDeviceRef.mockReturnValue({ trackId: 'track-1', deviceId: 'dev-1' });
        setPadParam = vi.fn<SetPadParam>();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ toasterControls: { ready: true, setPadParam } }],
        });
    });

    it('writes the pad update to the store', () => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 2, key: 'tune', value: 7 });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 2, { tune: 7 });
    });

    it('dispatches straight to the worklet in the same call, bypassing rAF coalescing', () => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 3, key: 'decay', value: 0.4 });

        expect(setPadParam).toHaveBeenCalledWith(3, 'decay', 0.4);
        expect(setPadParam).toHaveBeenCalledTimes(1);
    });

    it('still updates the store but skips the worklet when no device ref exists', () => {
        mockFindDeviceRef.mockReturnValue(null);

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 0, key: 'pan', value: -0.3 });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 0, { pan: -0.3 });
        expect(mockGetTrackStrip).not.toHaveBeenCalled();
        expect(setPadParam).not.toHaveBeenCalled();
    });

    it('still updates the store but skips the worklet when the track strip is missing', () => {
        mockGetTrackStrip.mockReturnValue(undefined);

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 0, key: 'drive', value: 5 });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 0, { drive: 5 });
        expect(setPadParam).not.toHaveBeenCalled();
    });

    it('skips the worklet when no device node exposes toaster controls', () => {
        mockGetTrackStrip.mockReturnValue({ deviceNodes: [{}] });

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 0, key: 'tone', value: 0.9 });

        expect(setPadParam).not.toHaveBeenCalled();
    });
});
