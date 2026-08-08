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

const DEVICE_ID = 'toaster-solo-1';

/**
 * The S button was diverted into a store-only write for as long as the engine had
 * no `soloed` arm to send it to. `Pad::set_param` has one now and
 * `ToasterEngine::note_on` resolves solo across the pad set, so the panel has to
 * stop diverting it.
 *
 * The assertion is on the engine control surface, not on `pad.soloed` in the
 * store: the store field was being written the whole time the button did nothing,
 * so a store-level assertion is the one that passed on the dead control.
 */
describe('Toaster pad solo reaches the engine', () => {
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

    function clickSolo(padIndex: number): void {
        const soloButtons = screen.getAllByRole('button', { name: 'S' });
        const button = soloButtons[padIndex];
        if (!button) {
            throw new Error(`expected a solo button for pad ${padIndex}`);
        }
        fireEvent.click(button);
        flushFrame();
    }

    it('posts soloed=1 to the engine when the pad is soloed from the mixer', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickSolo(4);

        expect(setPadParam).toHaveBeenCalledWith(4, 'soloed', 1);
    });

    /**
     * Un-soloing is the half that matters most: the engine gates every pad that
     * is not soloed, so a panel that could raise the flag but never lower it
     * would leave the whole device silent except one pad, with the button
     * drawn unlit.
     */
    it('posts soloed=0 to the engine when the same pad is un-soloed again', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickSolo(4);
        setPadParam.mockClear();
        clickSolo(4);

        expect(setPadParam).toHaveBeenCalledWith(4, 'soloed', 0);
    });

    it('solos only the pad that was clicked', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickSolo(4);

        const soloedPads = setPadParam.mock.calls.filter(([, name]) => name === 'soloed').map(([pad]) => pad);
        expect(soloedPads).toEqual([4]);
    });

    it('keeps the store flag a boolean so the persisted kit chunk still reads it', () => {
        render(<ToasterPanel deviceId={DEVICE_ID} />);

        clickSolo(4);

        expect(toasterStore.value?.[DEVICE_ID]?.kit.pads[4]?.soloed).toBe(true);
    });
});
