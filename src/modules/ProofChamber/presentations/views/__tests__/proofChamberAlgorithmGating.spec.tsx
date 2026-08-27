import { render, fireEvent, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeAppAction } from '#/modules/Command/useCases';
import { NATIVE_DSP_ENGINE_GAPS, findNativeDspEngineGapParam } from '#/utils/nativeDspEngineGaps';

import { chamberEngineIdForAlgorithm } from '../../../models/ProofChamberAlgorithmGating';
import {
    DEFAULT_PARAMS,
    PARAM_MAP,
    type ProofChamberAlgorithm,
    type ProofChamberEngineState,
} from '../../../models/ProofChamberState';
import { hydrateChamberStateFromProject } from '../../../useCases/proofChamber/hydrateChamberStateFromProject';
import { ProofChamberPanel } from '../ProofChamberPanel';

/**
 * The Dutch Oven's panel used to render every control on every algorithm, so on
 * the 35 `(engine, parameter)` pairs `NATIVE_DSP_ENGINE_GAPS` records the knob
 * turned, the automation lane recorded and persisted, and the DSP never heard
 * it.
 *
 * The population under test is **read out of that table**, not enumerated here.
 * A hand-written list of "controls that should be disabled" would drift the day
 * a gap closed, and drift silently — which is the defect class this whole
 * census exists to catch. What this file *does* enumerate is the rendering
 * fact the table cannot know: which on-screen control carries which parameter.
 * That map is asserted total against `PARAM_MAP`, so a parameter that gains a
 * control, or a control that changes its label, reds here.
 *
 * Both directions matter and both are asserted. A fix that disabled everything
 * would satisfy "dead parameters are not interactive" and fail "live parameters
 * are interactive" — and the plate, which has no gaps at all, is the algorithm
 * that catches it.
 */

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => {
        if (typeof defaultValue === 'object' && defaultValue !== null && 'instances' in defaultValue) {
            return MOCKED_CHAMBER_STORE_STATE;
        }
        return defaultValue;
    }),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(() => Promise.resolve({ status: 'committed', actions: [] })),
    // The real one returns `{ groupId, groupLabel }`; a mock returning a bare
    // string would destructure to `undefined` and make any assertion about the
    // undo grouping a statement about the mock.
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
/**
 * The Decay EQ overlay is a canvas, and a canvas has no addressable control for
 * a role query to find — so it is replaced by six ordinary buttons, one per
 * band, carrying whatever `disabled` the panel handed down.
 *
 * The stub deliberately does **not** refuse the callback when it is disabled.
 * The real component does (`DecayEqOverlay.spec.tsx` covers that), and a stub
 * that also refused would make the "refuses writes from dead controls"
 * assertion below a statement about the stub. What is under test here is the
 * panel: it has to gate the write itself, so a child that forgot to check
 * cannot put a value the engine drops into project truth.
 */
vi.mock('../../components/DecayEqOverlay', () => ({
    DecayEqOverlay: ({
        multipliers,
        onChange,
        disabled,
    }: {
        multipliers: number[];
        onChange: (band: number, multiplier: number) => void;
        disabled?: boolean;
    }) => (
        <div>
            {multipliers.map((multiplier, band) => (
                <button
                    key={band}
                    type="button"
                    aria-label={DECAY_EQ_CONTROL_NAMES[band]}
                    aria-disabled={disabled === true ? 'true' : undefined}
                    onClick={() => onChange(band, multiplier + 1)}
                />
            ))}
        </div>
    ),
}));

/** The accessible names the stub above gives the six band nodes. */
const DECAY_EQ_CONTROL_NAMES = [
    'Decay EQ LF',
    'Decay EQ LM',
    'Decay EQ Mid',
    'Decay EQ UM',
    'Decay EQ HF',
    'Decay EQ Air',
];

const DEVICE_ID = 'test-device';
let MOCKED_CHAMBER_STORE_STATE = { activeInstanceId: DEVICE_ID, instances: {} };

/**
 * How each advertised parameter appears on screen.
 *
 * `role` decides how the control is addressed and how it is driven: a knob is
 * `RotaryKnob`'s `role="slider"` div, driven by End/Home (which always land on
 * a bound, unlike an arrow step that a bipolar snap can swallow); a switch or a
 * curve selector is a chip button, driven by a click.
 *
 * `algorithm` is absent on purpose — it is the selector itself, never a gated
 * control — and `space` is a preset tile with no engine parameter behind it.
 */
type PanelControl = {
    readonly role: 'slider' | 'button';
    readonly name: string;
};

const PANEL_CONTROLS: Readonly<Record<string, PanelControl>> = {
    mix: { role: 'slider', name: 'Mix' },
    decay: { role: 'slider', name: 'Decay' },
    damping: { role: 'slider', name: 'Damp' },
    predelay: { role: 'slider', name: 'Pre' },
    size: { role: 'slider', name: 'Size' },
    mod_rate: { role: 'slider', name: 'Rate' },
    mod_depth: { role: 'slider', name: 'Depth' },
    diffusion: { role: 'slider', name: 'Diffuse' },
    high_cut: { role: 'slider', name: 'Hi Cut' },
    low_cut: { role: 'slider', name: 'Lo Cut' },
    width: { role: 'slider', name: 'Width' },
    freeze: { role: 'button', name: 'Freeze' },
    shimmer: { role: 'button', name: 'Shimmer' },
    shimmer_amount: { role: 'slider', name: 'Amount' },
    shimmer_pitch: { role: 'slider', name: 'Pitch' },
    gravity: { role: 'slider', name: 'Gravity' },
    saturation: { role: 'button', name: 'Saturation' },
    saturation_type: { role: 'button', name: 'Cheby' },
    early_late: { role: 'slider', name: 'E/L' },
    density: { role: 'slider', name: 'Density' },
    // The six Decay EQ bands, drawn by the overlay rather than by a knob — see
    // the stub above for how they become addressable here.
    decay_eq_0: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[0]! },
    decay_eq_1: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[1]! },
    decay_eq_2: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[2]! },
    decay_eq_3: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[3]! },
    decay_eq_4: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[4]! },
    decay_eq_5: { role: 'button', name: DECAY_EQ_CONTROL_NAMES[5]! },
    vintage: { role: 'slider', name: 'Vintage' },
};

const ALGORITHMS: readonly ProofChamberAlgorithm[] = ['plate', 'fdn-8', 'fdn-16', 'spring', 'reverse'];

/**
 * `shimmer` and `saturation` on, because the Amount/Pitch knobs and the curve
 * chips only render under their switch — and a project saved on the plate with
 * shimmer engaged, then switched to Reverse, is exactly the state that has to
 * behave.
 */
function renderPanel(algorithm: ProofChamberAlgorithm, overrides: Partial<ProofChamberEngineState> = {}): void {
    const engineState: ProofChamberEngineState = {
        ...DEFAULT_PARAMS,
        algorithm,
        shimmer: true,
        saturation: true,
        ...overrides,
    };
    MOCKED_CHAMBER_STORE_STATE = {
        activeInstanceId: DEVICE_ID,
        instances: { [DEVICE_ID]: { id: DEVICE_ID, isBypassed: false, uiLevel: 1, engineState } },
    };
    render(<ProofChamberPanel deviceId={DEVICE_ID} />);
    // The Decay EQ overlay is behind a view toggle that starts closed, and its
    // six bands are part of the population below. The chip is a view control,
    // not a parameter write, so opening it here changes nothing the assertions
    // measure.
    fireEvent.click(screen.getAllByRole('button', { name: 'Decay EQ' })[0]!);
}

/** Every node carrying this control, because the switches are rendered on both the rail and the deck. */
function controlsNamed({ role, name }: PanelControl): HTMLElement[] {
    return screen.getAllByRole(role, { name });
}

/** Drive the control the way a user would, and report whether a parameter write left the panel. */
function writesReachingEngine(paramId: string, control: PanelControl): number {
    for (const element of controlsNamed(control)) {
        if (control.role === 'button') {
            fireEvent.click(element);
            continue;
        }
        // End and Home both land on a bound, so at least one of them is a real
        // change whatever the current value is — an arrow step can be swallowed
        // by the bipolar detent (Gravity) or by a value already at the top of
        // its range (Density, Pitch).
        fireEvent.keyDown(element, { key: 'End' });
        fireEvent.keyDown(element, { key: 'Home' });
    }

    return vi
        .mocked(executeAppAction)
        .mock.calls.filter(([action]) => action.type === 'setDeviceParameter' && action.payload.paramId === paramId)
        .length;
}

function isGapped(algorithm: ProofChamberAlgorithm, paramId: string): boolean {
    return (
        findNativeDspEngineGapParam({
            deviceId: 'dutch-oven',
            engineId: chamberEngineIdForAlgorithm(algorithm),
            paramId,
        }) !== null
    );
}

describe('the Dutch Oven panel offers only controls the live algorithm can hear', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('gives every knob an accessible name of its own', () => {
        // `RotaryKnob` falls back to "Parameter control" when it is handed no
        // label, no aria-label and no paramId — which is what every knob on
        // this panel was called, because `KnobCell` draws the label in a
        // sibling node. Guards address controls by name, so this is load
        // bearing for the rest of the file: without it, `getAllByRole('slider',
        // { name: 'Width' })` finds nothing and every assertion below is
        // vacuous.
        renderPanel('plate');

        expect(screen.queryAllByRole('slider', { name: 'Parameter control' })).toEqual([]);
        expect(screen.getAllByRole('slider', { name: 'Width' }).length).toBeGreaterThan(0);
        expect(screen.getAllByRole('slider', { name: 'E/L' }).length).toBeGreaterThan(0);
    });

    it('has a control mapped for every parameter the panel can write', () => {
        // The half of the population this file does have to enumerate. If a
        // parameter gains a control, or a control is renamed, the gating
        // assertions below would silently stop covering it — so the map is
        // asserted total against the panel's own write table instead.
        const writable = Object.values(PARAM_MAP).filter((paramId) => paramId !== 'algorithm');
        const unmapped = writable.filter((paramId) => PANEL_CONTROLS[paramId] === undefined);
        const orphaned = Object.keys(PANEL_CONTROLS).filter((paramId) => !writable.includes(paramId));

        expect(unmapped).toEqual([]);
        expect(orphaned).toEqual([]);
    });

    it('records gaps for the algorithms this file exercises', () => {
        // Presence pin (ADR 0015 rule 4). Every assertion below is derived from
        // `NATIVE_DSP_ENGINE_GAPS`, so an empty or mis-keyed table would make
        // the whole suite pass by finding nothing to disable.
        const perEngine = Object.fromEntries(
            NATIVE_DSP_ENGINE_GAPS.filter((gap) => gap.deviceId === 'dutch-oven').map((gap) => [
                gap.engineId,
                gap.params.length,
            ])
        );

        expect(perEngine).toEqual({ fdn: 9, spring: 11, reverse: 21 });
        expect(chamberEngineIdForAlgorithm('fdn-16')).toBe('fdn');
        expect(chamberEngineIdForAlgorithm('plate')).toBe('plate');
    });

    it('shows the Spring decay and damping ranges the engine can actually hear', () => {
        renderPanel('spring', { decay: 0.999, damping: 0.999 });

        const decay = screen.getByRole('slider', { name: 'Decay' });
        const damping = screen.getByRole('slider', { name: 'Damp' });
        expect(decay).toHaveAttribute('aria-valuemax', '0.95');
        expect(decay).toHaveAttribute('aria-valuenow', '0.95');
        expect(damping).toHaveAttribute('aria-valuemax', '0.99');
        expect(damping).toHaveAttribute('aria-valuenow', '0.99');
        expect(screen.getAllByText('0.950')).toHaveLength(2);
        expect(screen.getAllByText('99%')).toHaveLength(2);
    });

    it('limits Reverse decay without narrowing Plate', () => {
        renderPanel('reverse', { decay: 0.999 });
        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuemax', '0.99');

        cleanup();
        renderPanel('plate', { decay: 0.999 });
        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuemax', '0.999');
    });

    for (const algorithm of ALGORITHMS) {
        it(`marks exactly the ${algorithm} engine's dead parameters as unavailable`, () => {
            renderPanel(algorithm);

            const wrong: string[] = [];
            for (const [paramId, control] of Object.entries(PANEL_CONTROLS)) {
                const expected = isGapped(algorithm, paramId);
                for (const element of controlsNamed(control)) {
                    const actual = element.getAttribute('aria-disabled') === 'true';
                    if (actual !== expected) {
                        wrong.push(`${paramId}: aria-disabled=${actual}, gap table says ${expected}`);
                    }
                }
            }

            expect(wrong).toEqual([]);
        });

        for (const [paramId, control] of Object.entries(PANEL_CONTROLS)) {
            it(`refuses writes from the ${algorithm} engine's dead ${paramId} control and accepts it when live`, () => {
                // One panel per control keeps the write oracle independent: a
                // chip toggles, and a second copy left mounted would make
                // `getAllByRole` return the previous render's nodes too.
                cleanup();
                vi.mocked(executeAppAction).mockClear();
                renderPanel(algorithm);

                const writes = writesReachingEngine(paramId, control);
                if (isGapped(algorithm, paramId)) {
                    expect(writes).toBe(0);
                    return;
                }

                expect(writes).toBeGreaterThan(0);
            });
        }
    }

    it('leaves every control on the plate live, which is what stops a fix that disables everything', () => {
        // The plate has no rows in the gap table at all, so the correct panel
        // disables nothing here. Stated on its own because it is the assertion
        // a blanket `disabled` would fail, and it is easy to lose inside a
        // parameterised loop.
        renderPanel('plate');

        const disabled = Object.entries(PANEL_CONTROLS)
            .filter(([, control]) =>
                controlsNamed(control).some((element) => element.getAttribute('aria-disabled') === 'true')
            )
            .map(([paramId]) => paramId);

        expect(disabled).toEqual([]);
    });

    it('tells the user why a structural gap will never come back, and why an unbuilt one might', () => {
        // A greyed control with no explanation is a puzzle. The two populations
        // read differently on purpose: `width` on reverse is a category error
        // the DSP will never close, `damping` on reverse is a stage nobody has
        // written yet.
        renderPanel('reverse');

        const [width] = screen.getAllByRole('slider', { name: 'Width' });
        const [damp] = screen.getAllByRole('slider', { name: 'Damp' });

        expect(width?.getAttribute('title')).toBe(
            'Width does not apply to the Reverse algorithm. This engine writes one mono buffer and copies each ' +
                'sample to both channels, so a mid/side matrix has no side component to scale.'
        );
        expect(damp?.getAttribute('title')).toBe(
            'Damp is not implemented on the Reverse algorithm yet, so this engine ignores it.'
        );

        // Deliberately absent: any claim about what happens after an algorithm
        // change. The engine resets the device on a switch, so a sentence
        // promising the value comes back would be false — that was this
        // change's original defect and it is not repeated in softer wording.
        for (const title of [width?.getAttribute('title'), damp?.getAttribute('title')]) {
            expect(title).not.toMatch(/again|kept|automation/i);
        }
    });

    it('says nothing on a control the live algorithm can hear', () => {
        renderPanel('reverse');

        const [mix] = screen.getAllByRole('slider', { name: 'Mix' });

        expect(mix?.getAttribute('title')).toBeNull();
        expect(mix?.getAttribute('aria-disabled')).toBeNull();
    });

    it('keeps a disabled control focusable so a keyboard user can reach the reason', () => {
        // WAI-ARIA APG: the `disabled` attribute takes an element out of the
        // tab order, and a screen-reader user's primary means of discovery is
        // moving focus — so a control disabled for a reason they cannot infer
        // from context must stay reachable. `aria-disabled` conveys the state
        // without removing the node.
        renderPanel('reverse');

        const [width] = screen.getAllByRole('slider', { name: 'Width' });

        expect(width?.getAttribute('aria-disabled')).toBe('true');
        expect(width?.getAttribute('tabindex')).toBe('0');
        expect(width?.hasAttribute('disabled')).toBe(false);
    });

    it('writes the algorithm and nothing else; the engine-side replay is guarded in crates/proof-chamber/tests/algorithm_switch_parameter_retention.rs', () => {
        // The name says what this row observes, and nothing more. It asserts
        // the panel's *action payload* against a mocked `executeAppAction`;
        // deleting `replay_cached_parameters()` from `lib.rs` leaves it green,
        // so it is not a guard on engine retention and must not be read as one
        // — a title is what a reader or a coverage census scans.
        //
        // It was planted during #1519 to red when the parameter cache landed,
        // and it did not, because the cache is in Rust. Coming back to it is
        // the point: the payload shape is unchanged, and what changed is that
        // it is now the right shape.
        //
        // `ProofChamberInstance::set_param` used to construct a new engine when
        // `algorithm` arrived and replay nothing into it, so this single write
        // reset every parameter on the device — `mix` included, which no gate
        // touches. Measured plate -> reverse -> plate: bit-identical to an
        // engine nobody had ever written to.
        //
        // A panel-side replay was written to fix that and removed: sourced from
        // the store it writes stale values over project truth, and sourced from
        // project truth every action satisfies `handleSetDeviceParameter`'s
        // `isNoop` (`parameterValues[paramId] === value`) so
        // `executeAppActionBatch` skips all of them. The fix is the
        // `ProofChamberInstance` parameter cache, replayed into each newly
        // constructed engine (`crates/proof-chamber/src/lib.rs:363`), and it is
        // guarded by render delta in
        // `crates/proof-chamber/tests/algorithm_switch_parameter_retention.rs`.
        //
        // So a second write from here would be wrong, not missing: the panel
        // sends the algorithm, and the engine keeps the rest.
        renderPanel('plate');
        vi.mocked(executeAppAction).mockClear();

        const [reverseChip] = screen.getAllByRole('button', { name: 'Reverse' });
        fireEvent.click(reverseChip!);

        const written = vi
            .mocked(executeAppAction)
            .mock.calls.map(([action]) => action)
            .filter((action) => action.type === 'setDeviceParameter')
            .map((action) => (action.type === 'setDeviceParameter' ? action.payload : null));

        expect(written).toEqual([{ deviceId: DEVICE_ID, paramId: 'algorithm', value: 6 }]);
    });

    it('reads project truth back into the store on mount, so the gate opens against the saved algorithm', () => {
        // The wiring half of the reload fix. `hydrateChamberStateFromProject`
        // is tested on its own; this asserts the panel actually runs it, since
        // a correct hydration nobody calls leaves the gate trusting
        // `DEFAULT_PARAMS` and offering every reverse-dead control on a project
        // saved to Reverse.
        renderPanel('plate');

        expect(vi.mocked(hydrateChamberStateFromProject).mock.calls).toEqual([[DEVICE_ID]]);
    });
});
