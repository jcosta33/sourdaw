import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import { type DeviceWriteTargetResolution } from '#/modules/Arrangement/stores';

const mocks = vi.hoisted(() => ({
    resolveEligibleDeviceWriteTarget: vi.fn<(deviceId: string) => DeviceWriteTargetResolution>(() => ({
        status: 'missing',
    })),
    getTrackStrip: vi.fn(),
    assignToasterPatternGroove: vi.fn<() => Promise<void>>(),
}));

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/stores')>()),
    resolveEligibleDeviceWriteTarget: mocks.resolveEligibleDeviceWriteTarget,
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getTrackStrip: mocks.getTrackStrip,
}));

vi.mock('../../../useCases/assignToasterPatternGroove', () => ({
    assignToasterPatternGroove: mocks.assignToasterPatternGroove,
}));

import { registerToasterDevice, toasterStore } from '../../../stores/toasterStore';
import { ToasterPanel } from '../ToasterPanel';

const DEVICE_ID = 'toaster-mute-1';

/**
 * The mute button is what a user reaches for to silence a pad mid-take, and the
 * only thing that silences anything is the DSP: `ToasterEngine::note_on`
 * (`crates/daw-dsp/src/toaster/engine.rs`) returns before allocating a voice when
 * the pad's `muted` flag is set, and that flag is only ever raised by a
 * `set_pad_param(pad, "muted", …)` write.
 *
 * So this spec asserts on the engine control surface rather than on `pad.muted`
 * in the store. The store field was already being written while the pad kept
 * sounding — a store-level assertion is exactly the assertion that passed on the
 * dead control.
 */
describe('Toaster pad mute reaches the engine', () => {
    let rafCallbacks: FrameRequestCallback[];
    let requestAnimationFrameSpy: MockInstance<typeof requestAnimationFrame>;
    let setPadParam: ReturnType<typeof vi.fn<(pad: number, name: string, value: number) => void>>;

    function flushFrame(): void {
        const callbacks = rafCallbacks;
        rafCallbacks = [];
        for (const callback of callbacks) {
            callback(0);
        }
    }

    beforeEach(() => {
        vi.clearAllMocks();
        toasterStore.set({});
        rafCallbacks = [];
        requestAnimationFrameSpy = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        mocks.assignToasterPatternGroove.mockResolvedValue();
        mocks.resolveEligibleDeviceWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 'track-1',
            deviceId: DEVICE_ID,
        });
        setPadParam = vi.fn<(pad: number, name: string, value: number) => void>();
        mocks.getTrackStrip.mockReturnValue({
            deviceNodes: [{ deviceId: DEVICE_ID, toasterControls: { ready: true, setPadParam } }],
        });
        registerToasterDevice(DEVICE_ID);
    });

    afterEach(() => {
        requestAnimationFrameSpy.mockRestore();
        toasterStore.set({});
    });

    function clickMute(padIndex: number): void {
        const muteButtons = screen.getAllByRole('button', { name: 'M' });
        const button = muteButtons[padIndex];
        if (!button) {
            throw new Error(`expected a mute button for pad ${padIndex}`);
        }
        fireEvent.click(button);
        flushFrame();
    }

    it('posts muted=1 to the engine when the pad is muted from the mixer', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickMute(2);

        expect(setPadParam).toHaveBeenCalledWith(2, 'muted', 1);
    });

    it('posts muted=0 to the engine when the same pad is un-muted again', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickMute(2);
        setPadParam.mockClear();
        clickMute(2);

        expect(setPadParam).toHaveBeenCalledWith(2, 'muted', 0);
    });

    it('mutes only the pad that was clicked', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickMute(2);

        const mutedPads = setPadParam.mock.calls.filter(([, name]) => name === 'muted').map(([pad]) => pad);
        expect(mutedPads).toEqual([2]);
    });

    it('keeps the store flag a boolean so the persisted kit chunk still reads it', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickMute(2);

        expect(toasterStore.value?.[DEVICE_ID]?.kit.pads[2]?.muted).toBe(true);
    });
});
