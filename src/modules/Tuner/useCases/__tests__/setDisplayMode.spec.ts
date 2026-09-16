import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/tunerStore', () => ({
    mergeDeviceState: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

const { resolveEligibleDeviceWriteTarget } = vi.hoisted(() => ({
    resolveEligibleDeviceWriteTarget:
        vi.fn<
            (deviceId: string) => { status: 'eligible'; trackId: string; deviceId: string } | { status: 'missing' }
        >(),
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget,
}));

import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { mergeDeviceState } from '../../stores/tunerStore';
import { setDisplayMode } from '../setDisplayMode';

describe('setDisplayMode', () => {
    beforeEach(() => {
        vi.mocked(mergeDeviceState).mockClear();
        vi.mocked(updateDeviceParam).mockClear();
        resolveEligibleDeviceWriteTarget.mockReset();
        resolveEligibleDeviceWriteTarget.mockImplementation((deviceId: string) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('merges the new display mode for the given device', () => {
        // 'strobe' is a real DisplayMode member; a non-DisplayMode string would be
        // rejected by the use-case signature.
        setDisplayMode('d1', 'strobe');

        expect(mergeDeviceState).toHaveBeenCalledWith('d1', { mode: 'strobe' });
    });

    // Selecting Poly has to reach the wasm engine, not only the panel store: the
    // `poly` param gates the per-string tracker the display reads. The engine
    // write is live-only — mode is panel chrome, deliberately not a persisted
    // device parameter (see the display-mode note in models/TunerState.ts).
    it('enables the engine poly tracker, with the guitar string set, when Poly is selected', () => {
        setDisplayMode('d1', 'poly');

        // The tracker ships with no strings configured, so the instrument
        // selection must land before the enable or the tracker reports zero
        // strings forever.
        expect(vi.mocked(updateDeviceParam).mock.calls).toEqual([
            ['track-1', 'd1', 'instrument', 0],
            ['track-1', 'd1', 'poly', 1],
        ]);
    });

    it('switches the engine poly tracker off when another mode is selected', () => {
        setDisplayMode('d1', 'needle');

        expect(vi.mocked(updateDeviceParam).mock.calls).toEqual([['track-1', 'd1', 'poly', 0]]);
    });

    it('writes nothing to the engine when the device has no eligible write target', () => {
        resolveEligibleDeviceWriteTarget.mockImplementation(() => ({ status: 'missing' }));

        setDisplayMode('d1', 'poly');

        expect(updateDeviceParam).not.toHaveBeenCalled();
        // The panel preference itself still lands — the chip must reflect the
        // user's choice even while the engine is unreachable.
        expect(mergeDeviceState).toHaveBeenCalledWith('d1', { mode: 'poly' });
    });
});
