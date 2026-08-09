import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useStore } from '#/infra/store/useStore';
import { executeAppAction } from '#/modules/Command/useCases';

import { DEFAULT_PARAMS, type ProofChamberEngineState } from '../../../models/ProofChamberState';
import { ProofChamberPanel } from '../ProofChamberPanel';

/**
 * Can a user get the Damp knob back to the value their Dutch Oven booted at?
 *
 * Before #1546 the answer was no, and that was the second half of the defect.
 * The engine and the descriptor shipped Dattorro's `0.0005` while the knob was
 * declared `min={0} max={0.999} step={0.001}`. `RotaryKnob.quantize` snaps every
 * keyboard and pointer write onto `min + round((raw - min) / step) * step`, and
 * `0.0005` is not on that lattice — it sits exactly halfway between two of its
 * points. So the first nudge of the control left the shipped value behind
 * permanently: nothing the user could do afterwards addressed it again.
 *
 * A value being "on the grid" is not something to check by looking at it. Float
 * multiplication does not respect decimal intuition — `300 * 0.001` is
 * `0.30000000000000004`, and it is only `Number.prototype.toPrecision(15)`
 * inside `quantize` that pulls it back to `0.3`. So every assertion here reads
 * the number back out of the real component: `aria-valuenow` for what the knob
 * renders, and the `setDeviceParameter` payload for what it sends to the
 * engine, compared with `Object.is` rather than `toBeCloseTo`.
 *
 * The other three legs of the weld are checked where they live, and none of
 * them can see this one: `declaredDefaultConsensus.spec.ts` compares the
 * descriptor, `DEFAULT_PARAMS` and the panel's declared `defaultValue`;
 * `proofChamberParamMapClosure.spec.ts` compares `DEFAULT_PARAMS` against the
 * Rust constructor literal; and `crates/proof-chamber/tests/plate_default_damping.rs`
 * measures what the engine actually renders. All four agree on `0.3`.
 */

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(() => Promise.resolve({ status: 'committed', actions: [] })),
    generateGroupId: vi.fn((label: string) => ({ groupId: 'group-test', groupLabel: label })),
}));

vi.mock('../../../stores/chamberStore', () => ({
    chamberStore: { name: 'chamberStore' },
}));
vi.mock('../../../useCases/proofChamber/registerChamberInstance', () => ({
    registerChamberInstance: vi.fn(),
}));
vi.mock('../../../useCases/proofChamber/updateChamberEngine', () => ({
    updateChamberEngine: vi.fn(),
}));
vi.mock('../../../useCases/proofChamber/hydrateChamberStateFromProject', () => ({
    hydrateChamberStateFromProject: vi.fn(),
}));
vi.mock('../../components/DecayEqOverlay', () => ({
    DecayEqOverlay: () => null,
}));

const DEVICE_ID = 'test-device';

/** The `step` the Damp knob is declared with, and the lattice every write lands on. */
const DAMP_STEP = 0.001;

/**
 * Render the panel with the Damp knob sitting at `damping`, and hand back the
 * knob element. The store is mocked, so the panel does not re-render on a
 * write — each render is one fixed starting point, which is what makes the
 * "step away and step back" walk below two separate, honest observations
 * rather than one stateful one.
 */
function renderDampKnobAt(damping: number): HTMLElement {
    const engineState: ProofChamberEngineState = { ...DEFAULT_PARAMS, algorithm: 'plate', damping };
    vi.mocked(useStore).mockReturnValue({
        activeInstanceId: DEVICE_ID,
        instances: { [DEVICE_ID]: { id: DEVICE_ID, isBypassed: false, uiLevel: 1, engineState } },
    });
    render(<ProofChamberPanel deviceId={DEVICE_ID} />);
    const knobs = screen.getAllByRole('slider', { name: 'Damp' });
    expect(knobs).toHaveLength(1);
    return knobs[0]!;
}

/** Every value the panel sent to the engine for `damping`, in order. */
function dampingWrites(): number[] {
    return vi
        .mocked(executeAppAction)
        .mock.calls.filter(([action]) => action.type === 'setDeviceParameter' && action.payload.paramId === 'damping')
        .map(([action]) => {
            if (action.type !== 'setDeviceParameter') {
                throw new Error('filtered call is not a setDeviceParameter action');
            }
            return action.payload.value;
        });
}

describe('the Dutch Oven Damp knob can return to the value it ships at', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        cleanup();
    });

    it('renders the shipped default as its current value', () => {
        const knob = renderDampKnobAt(DEFAULT_PARAMS.damping);
        expect(Object.is(Number(knob.getAttribute('aria-valuenow')), 0.3)).toBe(true);
        expect(DEFAULT_PARAMS.damping).toBe(0.3);
    });

    it('displays the stored value and not the reset target', () => {
        // Which surface said what, pinned — because the first revision of
        // #1546's PR got it backwards and wrote the wrong story into a source
        // comment that outlives the PR.
        //
        // The Damp knob displays `params.damping`, which
        // `hydrateChamberStateFromProject` seeds from `Device.parameterValues`
        // on mount, through `formatValue(value, '%')` — `Math.round(v * 100)`.
        // So a device added at the old descriptor default read **0%** and
        // agreed with the engine. What disagreed with the descriptor and the
        // Rust constructor were the two *reset/default* declarations,
        // `DEFAULT_PARAMS.damping` and the knob's `defaultValue`, both 0.3.
        //
        // `Math.round` is also why the old value was invisible rather than
        // merely wrong: 0.0005 and a true zero both render "0%".
        const oldDefault = renderDampKnobAt(0.0005);
        expect(oldDefault.getAttribute('aria-valuenow')).toBe('0.0005');
        expect(oldDefault.parentElement?.textContent).toContain('0%');
        expect(oldDefault.parentElement?.textContent).not.toContain('30%');

        cleanup();
        const newDefault = renderDampKnobAt(DEFAULT_PARAMS.damping);
        expect(newDefault.getAttribute('aria-valuenow')).toBe('0.3');
        expect(newDefault.parentElement?.textContent).toContain('30%');
    });

    it('steps off the shipped default and back onto it exactly', () => {
        const knob = renderDampKnobAt(DEFAULT_PARAMS.damping);
        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        const [stepped] = dampingWrites();
        expect(stepped).toBe(DEFAULT_PARAMS.damping + DAMP_STEP);

        // Second observation: a knob sitting where the first nudge left it,
        // stepped back down. The quantiser has to land on the same bit pattern
        // the device booted with, not merely near it.
        cleanup();
        vi.clearAllMocks();
        const moved = renderDampKnobAt(stepped!);
        fireEvent.keyDown(moved, { key: 'ArrowDown' });
        const [returned] = dampingWrites();
        expect(Object.is(returned, DEFAULT_PARAMS.damping)).toBe(true);
    });

    it('cannot return to the off-grid value the device used to ship', () => {
        // The failing case, kept so the walk above is not vacuous: repeat it
        // from `0.0005` and the knob lands somewhere else entirely. This is the
        // observation that made `step={0.001}` disqualifying in #1546, and it
        // reds if anyone puts an off-grid default back.
        const offGrid = 0.0005;
        const knob = renderDampKnobAt(offGrid);
        fireEvent.keyDown(knob, { key: 'ArrowUp' });
        const [stepped] = dampingWrites();
        expect(stepped).toBe(0.002);

        cleanup();
        vi.clearAllMocks();
        const moved = renderDampKnobAt(stepped!);
        fireEvent.keyDown(moved, { key: 'ArrowDown' });
        const [returned] = dampingWrites();
        expect(returned).toBe(0.001);
        expect(returned).not.toBe(offGrid);
    });

    it('resets to the shipped default from a moved position', () => {
        // Alt-click is `RotaryKnob`'s reset. It sends `defaultValue` verbatim,
        // so this is the panel's declared reset literal arriving at the engine
        // — the leg the census reads out of the `.tsx` source, observed here as
        // a value instead.
        const knob = renderDampKnobAt(0.62);
        fireEvent.pointerDown(knob, { button: 0, altKey: true });
        const [reset] = dampingWrites();
        expect(Object.is(reset, DEFAULT_PARAMS.damping)).toBe(true);
    });
});
