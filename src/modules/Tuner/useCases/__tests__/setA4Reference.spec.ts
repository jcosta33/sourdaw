import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeAppAction } from '#/modules/Command/useCases';

import { setA4Reference } from '../setA4Reference';

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(() => Promise.resolve()),
}));

/**
 * The tuner's concert-A reference has to reach the DSP, not just a panel store.
 *
 * `crates/scoring/src/tuning.rs` measures every note name and cent deviation
 * against `TuningSystem::a4_hz`, and the only thing that moves that field is
 * `ScoringInstance::set_param("a4_hz", …)` — reached from TypeScript through
 * the `setDeviceParameter` action → `updateDeviceParam` →
 * `audioEngine.updateDeviceParam` → the worklet's `{ type: 'param' }` message.
 * This use case used to write `tunerStore` and stop there, which changed the
 * "440 Hz" text under the knob and nothing the ear could hear: the engine went
 * on tuning to 440 and reported identical cents for identical input.
 *
 * The reference the assertions drive to is 415 Hz (Baroque pitch, a full
 * semitone down), never 440. 440 is the descriptor default and what the engine
 * holds when nobody writes, so it is the one value at which the dead control
 * and the wired one agree — a guard that only exercised it would pass on the
 * defect. `crates/scoring/src/lib.rs::cent_readout_is_measured_against_the_a4_reference`
 * is the other end of this path: it proves the engine's readout actually moves
 * when the parameter does.
 *
 * `'a4_hz'` is spelled out here rather than imported from the module constant
 * on purpose: the engine's `match` has a `_ => {}` arm, so a wrong id is
 * silently swallowed, and an assertion reading the same constant the code
 * writes could not tell the difference. `models/__tests__/A4Reference.spec.ts`
 * is the weld at the other end — it pins the constant to the id the
 * `native-scoring` descriptor declares.
 *
 * Mutation that reds these (ADR 0015): restore the old body,
 * `mergeDeviceState(deviceId, { a4Reference: hz })`. No action is dispatched and
 * all three assertions fail.
 */
describe('setA4Reference', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delivers the new reference as a setDeviceParameter action on the a4_hz parameter', () => {
        setA4Reference('dev-1', 415);

        expect(executeAppAction).toHaveBeenCalledWith({
            type: 'setDeviceParameter',
            payload: { deviceId: 'dev-1', paramId: 'a4_hz', value: 415 },
        });
    });

    it('drives the parameter between the two references it is moved across', () => {
        setA4Reference('dev-1', 440);
        setA4Reference('dev-1', 415);

        const dispatched = vi.mocked(executeAppAction).mock.calls.map((call) => call[0]);
        expect(dispatched).toEqual([
            { type: 'setDeviceParameter', payload: { deviceId: 'dev-1', paramId: 'a4_hz', value: 440 } },
            { type: 'setDeviceParameter', payload: { deviceId: 'dev-1', paramId: 'a4_hz', value: 415 } },
        ]);
    });

    it('addresses the device the caller named, not a globally selected one', () => {
        setA4Reference('dev-2', 415);

        expect(vi.mocked(executeAppAction).mock.calls[0]?.[0]).toMatchObject({
            payload: { deviceId: 'dev-2' },
        });
    });
});
