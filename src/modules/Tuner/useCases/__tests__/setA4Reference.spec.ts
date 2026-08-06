import { describe, it, expect, vi, beforeEach } from 'vitest';

import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { executeAppAction } from '#/modules/Command/useCases';

import { setA4Reference } from '../setA4Reference';

vi.mock('#/modules/Arrangement/stores', () => ({
    resolveEligibleDeviceWriteTarget: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(() => Promise.resolve()),
}));

/**
 * The tuner's concert-A reference has to reach the DSP, not just a panel store.
 *
 * `crates/scoring/src/tuning.rs` measures every note name and cent deviation
 * against `TuningSystem::a4_hz`, and the only thing that moves that field is
 * `ScoringInstance::set_param("a4_hz", …)` — reached from TypeScript through
 * `updateDeviceParam` → `audioEngine.updateDeviceParam` → the worklet's
 * `{ type: 'param' }` message. This use case used to write `tunerStore` and stop
 * there, which changed the "440 Hz" text under the knob and nothing the ear
 * could hear: the engine went on tuning to 440 and reported identical cents for
 * identical input.
 *
 * The reference the assertions drive to is 415 Hz (Baroque pitch, a full
 * semitone down), never 440. 440 is the descriptor default and what the engine
 * holds when nobody writes, so it is the one value at which the dead control and
 * the wired one agree — a guard that only exercised it would pass on the defect.
 * `crates/scoring/src/lib.rs::cent_readout_is_measured_against_the_a4_reference`
 * is the other end of this path: it proves the engine's readout actually moves
 * when the parameter does.
 *
 * `'a4_hz'` is spelled out here rather than imported from the module constant on
 * purpose: the engine's `match` has a `_ => {}` arm, so a wrong id is silently
 * swallowed, and an assertion reading the same constant the code writes could
 * not tell the difference. `models/__tests__/A4Reference.spec.ts` is the weld at
 * the other end — it pins the constant to the id the `native-scoring` descriptor
 * declares.
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

    describe('committing a gesture', () => {
        /**
         * Mutation that reds these (ADR 0015): restore the old body,
         * `mergeDeviceState(deviceId, { a4Reference: hz })`. No action is
         * dispatched and both assertions fail.
         */
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
    });

    describe('previewing a gesture in flight', () => {
        /**
         * A knob drag is one edit. `RotaryKnob` fires `onChange(value, true)` on
         * every pointer-move that crosses a step, so a sweep from 440 to 415
         * crosses twenty-five of them; `executeAppAction` opens an Automerge
         * transaction and an undo entry per call and coalesces only when handed
         * an `options.groupId`. Committing each move would therefore bury the
         * user's real edits under twenty-five one-hertz undo steps.
         *
         * Mutation that reds this (ADR 0015): delete the `if (isTransient)`
         * guard from `setA4Reference` so both halves fall through to
         * `executeAppAction` — the dispatch count goes from 1 to 26.
         */
        it('opens exactly one undo entry for a drag of many moves', () => {
            const sweep = [438, 435, 431, 428, 424, 421, 418, 415];
            for (const hz of sweep) {
                setA4Reference('dev-1', hz, true);
            }
            expect(executeAppAction).not.toHaveBeenCalled();

            setA4Reference('dev-1', 415, false);

            expect(executeAppAction).toHaveBeenCalledTimes(1);
            expect(executeAppAction).toHaveBeenCalledWith({
                type: 'setDeviceParameter',
                payload: { deviceId: 'dev-1', paramId: 'a4_hz', value: 415 },
            });
        });

        /**
         * The preview is not a no-op: the point of dragging a tuner's reference
         * is hearing and seeing the cents move under your thumb, which only
         * happens if the engine is written on every step. `updateDeviceParam` is
         * the only route to `ScoringInstance::set_param('a4_hz', …)`.
         *
         * Mutation that reds this (ADR 0015): make the transient branch `return`
         * before the `updateDeviceParam` call — the engine then hears nothing
         * until release and the drag is silent.
         */
        it('writes the engine on every transient step so the readout tracks the drag', () => {
            setA4Reference('dev-1', 428, true);
            setA4Reference('dev-1', 415, true);

            expect(vi.mocked(updateDeviceParam).mock.calls).toEqual([
                ['track-1', 'dev-1', 'a4_hz', 428],
                ['track-1', 'dev-1', 'a4_hz', 415],
            ]);
        });

        it.each(['missing', 'ineligible'] as const)('previews nothing when the owning track resolves %s', (status) => {
            vi.mocked(resolveEligibleDeviceWriteTarget).mockReturnValue({ status });

            setA4Reference('dev-1', 415, true);

            expect(updateDeviceParam).not.toHaveBeenCalled();
            expect(executeAppAction).not.toHaveBeenCalled();
        });
    });
});
