import { describe, it, expect, vi, beforeEach } from 'vitest';

import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

import { setA4Reference } from '../setA4Reference';

vi.mock('#/modules/Arrangement/stores', () => ({
    persistDeviceParam: vi.fn(),
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

/**
 * The tuner's concert-A reference has to reach the DSP, not just a panel store.
 *
 * `crates/scoring/src/tuning.rs` measures every note name and cent deviation
 * against `TuningSystem::a4_hz`, and the only thing that moves that field is
 * `ScoringInstance::set_param("a4_hz", …)` — reached from TypeScript through
 * `updateDeviceParam` → `audioEngine.updateDeviceParam` → the worklet's
 * `{ type: 'param' }` message. This use case used to write `tunerStore` and
 * stop there, which changed the "440 Hz" text under the knob and nothing the
 * ear could hear: the engine went on tuning to 440 and reported identical cents
 * for identical input.
 *
 * The two values these assertions drive between are 440 Hz (the descriptor
 * default, and what the engine holds when nobody writes) and 415 Hz (Baroque
 * pitch, a full semitone down — an A at 415 Hz reads 0 cents against a 415
 * reference and −100 cents against a 440 one).
 *
 * `'a4_hz'` is spelled out here rather than imported from the module constant
 * on purpose: the engine's `match` has a `_ => {}` arm, so a wrong id is
 * silently swallowed, and an assertion reading the same constant the code
 * writes could not tell the difference. `models/__tests__/A4Reference.spec.ts`
 * is the other end of that weld — it pins the constant to the id the
 * `native-scoring` descriptor declares.
 */
describe('setA4Reference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(resolveEligibleDeviceWriteTarget).mockImplementation((deviceId) => ({
            status: 'eligible',
            trackId: 'track-1',
            deviceId,
        }));
    });

    it('delivers the new reference to the DSP as the a4_hz parameter', () => {
        setA4Reference('dev-1', 415);

        // Addressed by the *resolved* target: the engine write needs the owning
        // track, which the caller never supplies.
        expect(updateDeviceParam).toHaveBeenCalledWith('track-1', 'dev-1', 'a4_hz', 415);
    });

    it('drives the engine parameter between the two references it is moved across', () => {
        setA4Reference('dev-1', 440);
        setA4Reference('dev-1', 415);

        expect(vi.mocked(updateDeviceParam).mock.calls.map((call) => call[3])).toEqual([440, 415]);
    });

    it('persists the reference onto the owning device so a strip rebuild replays it', () => {
        setA4Reference('dev-1', 415);

        expect(persistDeviceParam).toHaveBeenCalledWith('dev-1', 'a4_hz', 415);
    });

    it.each(['missing', 'ineligible'] as const)('writes nothing when the owning track resolves %s', (status) => {
        vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

        setA4Reference('dev-1', 415);

        expect(updateDeviceParam).not.toHaveBeenCalled();
        expect(persistDeviceParam).not.toHaveBeenCalled();
    });
});
