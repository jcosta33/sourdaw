import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

type SetPadParam = (pad: number, name: string, value: number) => void;
type ToasterControls = { ready: boolean; setPadParam: SetPadParam };
type TrackStrip = { deviceNodes: Array<{ deviceId?: string; toasterControls?: ToasterControls }> };

const mockResolveDeviceTarget = vi.hoisted(() =>
    vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({ status: 'missing' }))
);
const mockGetTrackStrip = vi.hoisted(() => vi.fn<(trackId: string) => TrackStrip | undefined>());
const mockUpdatePad = vi.hoisted(() => vi.fn<(deviceId: string, padIndex: number, updates: unknown) => void>());

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mockResolveDeviceTarget,
}));

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
        mockResolveDeviceTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: 'dev-1',
        });
        setPadParam = vi.fn<SetPadParam>();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: true, setPadParam } }],
        });
    });

    it('writes to the addressed Toaster, not the first one on the track', () => {
        // A track can host more than one Toaster. The selector had `deviceId` in
        // scope — it passes it to `updatePad` on the line above — and then threw
        // it away, taking whichever Toaster came first in the chain. Editing a
        // pad on the second one silently retuned the first.
        const otherSetPadParam = vi.fn<SetPadParam>();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [
                { deviceId: 'dev-other', toasterControls: { ready: true, setPadParam: otherSetPadParam } },
                { deviceId: 'dev-1', toasterControls: { ready: true, setPadParam } },
            ],
        });

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 5, key: 'tune', value: 12 });

        expect(setPadParam).toHaveBeenCalledWith(5, 'tune', 12);
        expect(otherSetPadParam).not.toHaveBeenCalled();
    });

    it('skips a device that is still loading rather than writing into its placeholder', () => {
        // The old predicate was `ready !== undefined`, which is *true* when
        // `ready` is false — so it matched a placeholder controller whose
        // `setPadParam` goes nowhere, and did so in preference to a real
        // loaded device later in the chain.
        const loadingSetPadParam = vi.fn<SetPadParam>();
        mockGetTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: 'dev-1', toasterControls: { ready: false, setPadParam: loadingSetPadParam } }],
        });

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 1, key: 'decay', value: 0.2 });

        expect(loadingSetPadParam).not.toHaveBeenCalled();
    });

    it('writes the pad update to the store', () => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 2, key: 'tune', value: 7 });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 2, { tune: 7 });
    });

    /**
     * The store and the wire disagree on the type of a mute. `PadState.muted` is
     * a boolean; the engine's pad params are uniformly numeric. Writing the raw
     * numeric into the store leaves a value the persisted kit chunk refuses —
     * `readPads` in `ToasterKitState.ts` gates on `typeof stored.muted ===
     * 'boolean'` — so the mute holds for the session and vanishes on the next
     * project load. Both values are driven: asserting only `1 -> true` cannot
     * tell a real narrowing from a hardcoded `{ muted: true }`.
     */
    it.each([
        { value: 1, stored: true },
        { value: 0, stored: false },
    ])('narrows a numeric muted=$value to $stored for the store', ({ value, stored }) => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 4, key: 'muted', value });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 4, { muted: stored });
    });

    it.each([
        { value: 1, stored: true },
        { value: 0, stored: false },
    ])('keeps the numeric muted=$value on the wire to the worklet', ({ value }) => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 4, key: 'muted', value });

        expect(setPadParam).toHaveBeenCalledWith(4, 'muted', value);
    });

    it.each([
        { value: 1, stored: true },
        { value: 0, stored: false },
    ])('narrows a numeric soloed=$value to $stored for the store', ({ value, stored }) => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 6, key: 'soloed', value });

        expect(mockUpdatePad).toHaveBeenCalledWith('dev-1', 6, { soloed: stored });
        expect(setPadParam).toHaveBeenCalledWith(6, 'soloed', value);
    });

    /**
     * `name`, `color` and `engineType` are strings in `PadState`. A numeric wire
     * value carries no string, so writing it would put a number where the kit
     * reader only accepts a string — same silent-drop-on-reload failure as the
     * boolean case. The worklet dispatch is unaffected: the engine side is
     * numeric for every param id.
     */
    it.each(['name', 'color', 'engineType'] as const)(
        'drops a numeric write to the string field %s instead of storing a number',
        (key) => {
            setPadParamImmediate({ deviceId: 'dev-1', padIndex: 7, key, value: 3 });

            expect(mockUpdatePad).not.toHaveBeenCalled();
            expect(setPadParam).toHaveBeenCalledWith(7, key, 3);
        }
    );

    it('dispatches straight to the worklet in the same call, bypassing rAF coalescing', () => {
        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 3, key: 'decay', value: 0.4 });

        expect(setPadParam).toHaveBeenCalledWith(3, 'decay', 0.4);
        expect(setPadParam).toHaveBeenCalledTimes(1);
    });

    it.each(['missing', 'ineligible'] as const)('rejects a %s owner before store or runtime effects', (status) => {
        mockResolveDeviceTarget.mockReturnValue({ status });

        setPadParamImmediate({ deviceId: 'dev-1', padIndex: 0, key: 'pan', value: -0.3 });

        expect(mockUpdatePad).not.toHaveBeenCalled();
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
