import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch, type GlutenTopology } from '../../../models/GlutenPatch';
import { GLUTEN_TOPOLOGY_GAPS } from '../../../models/GlutenTopologyGating';
import { type GlutenState } from '../../../stores/glutenStore';
import { setGlutenParamWithAudio } from '../../../useCases/glutenParamBridge/setGlutenParamWithAudio';
import { GlutenPanel } from '../GlutenPanel';

/**
 * The panel must not offer a control the topology it is running cannot hear.
 *
 * `GlutenEngine::set_param` forwards every name it does not handle itself to
 * all four topology structs at once, and each one drops what it has no arm for
 * through `_ => {}`. So a name reaching the engine says nothing about whether
 * the *active* topology heard it: on Diode, `release` and `auto_release` land
 * in `DiodeCompressor::set_param`'s catch-all, and the release coefficient is
 * recomputed from the Recovery position instead. The panel rendered a live
 * 25–5000 ms Release knob and a live Auto-rel chip directly above a caption
 * saying release times are fixed.
 *
 * `crates/daw-dsp/tests/gluten_topology_param_reach.rs` is the other half of
 * this: it renders the crate at two `release` values on each topology and
 * measures the output, so the census these gates read is a measurement rather
 * than a reading of the Rust.
 *
 * ## Why the controls are located structurally rather than by role name
 *
 * Every knob on this panel draws its visible label as a sibling `div`, so
 * before this change `RotaryKnob` fell back to naming all eighteen of them
 * "Parameter control". Locating by accessible name would therefore have made
 * this file's first run fail on the *name*, not on the gate, and a
 * reproduction has to fail for the reason it is about. The names are fixed
 * here too and guarded separately below, at which point both locators work;
 * this one stays structural so the two failures never merge.
 */

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => MOCKED_INSTANCES),
}));

vi.mock('../../../useCases/glutenParamBridge/setGlutenParamWithAudio', () => ({
    setGlutenParamWithAudio: vi.fn(),
}));

const setParam = vi.mocked(setGlutenParamWithAudio);

const DEVICE_ID = 'gluten-gating-device';

let MOCKED_INSTANCES: Record<string, GlutenState> = {};

function renderPanel(patch: Partial<GlutenPatch>): void {
    MOCKED_INSTANCES = {
        [DEVICE_ID]: { patch: { ...DEFAULT_PATCH, ...patch }, uiLevel: 2 },
    };
    render(<GlutenPanel deviceId={DEVICE_ID} />);
}

/**
 * The `role="slider"` element belonging to the knob whose printed label is
 * `label`.
 *
 * Walks up from the leaf that prints the label to the cell that also holds the
 * knob. No class name is read: the house rule forbids asserting on styling
 * hooks, and a class-based locator would also survive the very refactor that
 * would break this.
 */
function knobFor(label: string): HTMLElement {
    const leaf = [...document.querySelectorAll('div')].find(
        (node) => node.children.length === 0 && node.textContent === label
    );
    if (leaf === undefined) {
        throw new Error(`No knob labelled "${label}" is rendered.`);
    }

    const cell = leaf.parentElement?.parentElement;
    const slider = cell?.querySelector('[role="slider"]');
    if (!(slider instanceof HTMLElement)) {
        throw new Error(`The knob labelled "${label}" has no slider element.`);
    }
    return slider;
}

/** The chip button whose visible text is `label`. */
function chipFor(label: string): HTMLElement {
    return screen.getByRole('button', { name: label });
}

describe('Gluten topology control gating', () => {
    beforeEach(() => {
        setParam.mockClear();
    });

    describe('the refusal is behaviour, not decoration', () => {
        // `aria-disabled` announces a state; it does not stop a click. The chip
        // has to refuse the write itself, or a greyed Auto rel would still
        // toggle project truth and record automation for a parameter the
        // engine drops.
        it('does not write when a refused chip is clicked', () => {
            renderPanel({ topology: 'diode' });

            fireEvent.click(chipFor('Auto rel'));

            expect(setParam).not.toHaveBeenCalled();
        });

        it('writes when the same chip is live', () => {
            renderPanel({ topology: 'vca' });

            fireEvent.click(chipFor('Auto rel'));

            // The default patch has Auto rel on, so the click turns it off.
            expect(setParam).toHaveBeenCalledWith('gluten-gating-device', 'autoRelease', false);
        });

        it('does not write when a refused OS chip is clicked', () => {
            renderPanel({ topology: 'vca' });

            fireEvent.click(chipFor('4×'));

            expect(setParam).not.toHaveBeenCalled();
        });
    });

    describe('Diode', () => {
        it('refuses the Release knob and says why on the control itself', () => {
            renderPanel({ topology: 'diode' });

            const release = knobFor('Release');
            expect(release.getAttribute('aria-disabled')).toBe('true');
            expect(release.getAttribute('title') ?? '').toContain('Recovery');
        });

        it('refuses the Auto rel chip and says why on the control itself', () => {
            renderPanel({ topology: 'diode' });

            const autoRelease = chipFor('Auto rel');
            expect(autoRelease.getAttribute('aria-disabled')).toBe('true');
            expect(autoRelease.getAttribute('title') ?? '').toContain('Diode');
        });

        it('leaves Attack live, because the diode bridge does read it', () => {
            renderPanel({ topology: 'diode' });

            const attack = knobFor('Attack');
            expect(attack.getAttribute('aria-disabled')).toBeNull();
            expect(attack.getAttribute('title')).toBeNull();
        });
    });

    describe('VCA', () => {
        it('leaves Release and Auto rel live, because the VCA reads both', () => {
            renderPanel({ topology: 'vca' });

            expect(knobFor('Release').getAttribute('aria-disabled')).toBeNull();
            expect(chipFor('Auto rel').getAttribute('aria-disabled')).toBeNull();
        });
    });

    it('names every knob after its printed label', () => {
        renderPanel({ topology: 'diode' });

        expect(screen.getByRole('slider', { name: 'Release' })).toBe(knobFor('Release'));
        expect(screen.getByRole('slider', { name: 'Attack' })).toBe(knobFor('Attack'));
    });
});

/**
 * Where every control that carries a census row is drawn, and how it is found.
 *
 * The census weld (`glutenTopologyGating.spec.ts`) proves the table matches the
 * Rust; the gate's unit tests prove the table becomes the right answer. Neither
 * proves the answer reaches the screen — a control whose `gate` prop was never
 * passed would satisfy both and stay fully interactive. So the sweep below
 * renders the real panel on all four topologies and reads the DOM.
 *
 * `oversampling` is three chips rather than one control; all three are asserted,
 * because gating two of them would be indistinguishable from gating none.
 */
const CONTROL_LOCATORS: Record<string, () => HTMLElement[]> = {
    ratio: () => [knobFor('Ratio')],
    knee: () => [knobFor('Knee')],
    attack: () => [knobFor('Attack')],
    release: () => [knobFor('Release')],
    range: () => [knobFor('Range')],
    autoRelease: () => [chipFor('Auto rel')],
    oversampling: () => [chipFor('1×'), chipFor('2×'), chipFor('4×')],
    scHpfFreq: () => [knobFor('SC HPF')],
    scLpfFreq: () => [knobFor('SC LPF')],
    scEqFreq: () => [knobFor('SC EQ')],
    scEqGain: () => [knobFor('EQ Gain')],
    scEqQ: () => [knobFor('EQ Q')],
    scHpfEnabled: () => [chipFor('HPF')],
    scLpfEnabled: () => [chipFor('LPF')],
    scEqEnabled: () => [chipFor('SC EQ')],
    extSidechain: () => [chipFor('Ext SC')],
    thrust: () => [chipFor('Thrust off'), chipFor('Thrust med'), chipFor('Thrust loud')],
};

/**
 * A patch that has no *patch-state* gap active, so this sweep measures only the
 * topology census.
 *
 * `scEqGain` leaves 0 dB because a flat bell makes SC EQ and EQ Q inert for a
 * reason that has nothing to do with the topology, and `blendTopology` is moved
 * off Opto because it defaults there and would make Stage 2 inert the moment
 * this sweep reached the Opto row. Both of those are asserted on their own,
 * below.
 */
function patchWithNoOverrides(topology: GlutenTopology): Partial<GlutenPatch> {
    return {
        topology,
        scEqGain: 6,
        blendAmount: 0,
        blendTopology: topology === 'vca' ? 'opto' : 'vca',
    };
}

describe('every censused control is actually refused on the screen', () => {
    it('sweeps every topology, and can locate every control it censuses', () => {
        // Two vacuity guards for the sweep below, both of which it needs and
        // neither of which it can provide for itself.
        //
        // `it.each` over an empty population registers *zero* tests and reports
        // nothing missing — emptying `GLUTEN_TOPOLOGY_GAPS` took the suite from
        // 24 to 20 passed with no diagnostic. So the population is pinned.
        expect(GLUTEN_TOPOLOGY_GAPS.map((gap) => gap.topology).sort()).toEqual(['diode', 'fet', 'opto', 'vca']);

        // And the sweep only checks rows it has a locator for, so a census row
        // whose control is missing from `CONTROL_LOCATORS` is never checked to
        // reach the DOM at all — deleting a line from that map left 24 passed.
        // Every censused parameter must be locatable.
        const locatable = new Set(Object.keys(CONTROL_LOCATORS));
        const unlocatable = [
            ...new Set(GLUTEN_TOPOLOGY_GAPS.flatMap((gap) => gap.params.map((param) => String(param.paramKey)))),
        ]
            .filter((paramKey) => !locatable.has(paramKey))
            .sort();

        expect(unlocatable).toEqual([]);
    });

    it.each(GLUTEN_TOPOLOGY_GAPS)('$topology', (gap) => {
        renderPanel(patchWithNoOverrides(gap.topology));

        const censused = new Set(gap.params.map((param) => String(param.paramKey)));
        expect(censused.size, `${gap.topology} must have at least one row to sweep`).toBeGreaterThan(0);

        for (const [paramKey, locate] of Object.entries(CONTROL_LOCATORS)) {
            const expectedInert = censused.has(paramKey);
            for (const element of locate()) {
                expect(
                    element.getAttribute('aria-disabled'),
                    `${paramKey} on ${gap.topology} (${element.getAttribute('aria-label') ?? element.textContent})`
                ).toBe(expectedInert ? 'true' : null);

                if (expectedInert) {
                    // The reason has to travel with the disabled state, on the
                    // same node — a greyed control that cannot say why is the
                    // half-fix `RotaryKnob`'s `disabled`/`title` pairing exists
                    // to prevent.
                    expect((element.getAttribute('title') ?? '').length).toBeGreaterThan(40);
                }
            }
        }
    });

    it('gives every detector control back once Stage two runs the Diode', () => {
        // The routing rows are gated per live stage, not per primary, because
        // `process_block` hands the filtered detector to whichever stage is a
        // diode. `a_diode_stage_two_gives_every_primary_a_working_sidechain`
        // measures all ten as audible in exactly this configuration.
        renderPanel({ topology: 'vca', blendTopology: 'diode', blendAmount: 0.5, scEqGain: 6 });

        for (const paramKey of DETECTOR_CONTROLS) {
            for (const element of CONTROL_LOCATORS[paramKey]!()) {
                expect(element.getAttribute('aria-disabled'), `${paramKey} with a Diode stage two`).toBeNull();
            }
        }
    });
});

/** The twelve controls the ten detector-routing names draw. */
const DETECTOR_CONTROLS = [
    'scHpfFreq',
    'scLpfFreq',
    'scEqFreq',
    'scEqGain',
    'scEqQ',
    'scHpfEnabled',
    'scLpfEnabled',
    'scEqEnabled',
    'extSidechain',
    'thrust',
] as const;

describe('a control switched off by another control says so too', () => {
    it('refuses Link under Dual mono', () => {
        renderPanel({ topology: 'diode', stereoMode: 'dual-mono', scEqGain: 6 });

        const link = knobFor('Link');
        expect(link.getAttribute('aria-disabled')).toBe('true');
        expect(link.getAttribute('title') ?? '').toContain('Choose Stereo, Mid or Side');
    });

    it('leaves Link live in an ordinary stereo mode', () => {
        renderPanel({ topology: 'diode', stereoMode: 'stereo', scEqGain: 6 });

        expect(knobFor('Link').getAttribute('aria-disabled')).toBeNull();
    });

    it('refuses Stage 2 on the Opto primary the defaults produce', () => {
        // `blendTopology` defaults to Opto, so this is one click from a fresh
        // device: the Stage-two chooser shows three chips with none of them
        // active, above a knob that does nothing.
        renderPanel({ topology: 'opto', scEqGain: 6 });

        const stageTwo = knobFor('Stage 2');
        expect(stageTwo.getAttribute('aria-disabled')).toBe('true');
        expect(stageTwo.getAttribute('title') ?? '').toContain('both are Opto');
    });

    it('refuses the SC EQ frequency and width while the bell is flat', () => {
        renderPanel({ topology: 'diode', scEqGain: 0 });

        for (const label of ['SC EQ', 'EQ Q']) {
            const knob = knobFor(label);
            expect(knob.getAttribute('aria-disabled'), label).toBe('true');
            expect(knob.getAttribute('title') ?? '', label).toContain('Set EQ Gain first');
        }

        // EQ Gain itself stays live — it is the way back.
        expect(knobFor('EQ Gain').getAttribute('aria-disabled')).toBeNull();
    });
});

describe('the Character card follows the DSP, not the selector', () => {
    it('shows the Stage-two topology’s own controls, labelled', () => {
        // A diode in stage two reads `recovery` — its only release control —
        // and the card used to render only `patch.topology`, putting it off
        // screen with no way to reach it.
        renderPanel({ topology: 'vca', blendTopology: 'diode', blendAmount: 0.5 });

        expect(chipFor('Recovery 3').getAttribute('aria-disabled')).toBeNull();
        expect(screen.getByText('Primary — VCA')).toBeTruthy();
        expect(screen.getByText('Stage two — Diode')).toBeTruthy();
    });

    it('keeps the Stage-two block mounted and refuses it while Stage 2 is at zero', () => {
        // Keyed on the *named* Stage-two topology, not on engagement. Keying it
        // on `blendAmount > 0.001` mounted and unmounted four controls and the
        // card's scroll height while the user was still dragging the Stage 2
        // knob across the threshold.
        renderPanel({ topology: 'vca', blendTopology: 'diode', blendAmount: 0 });

        const recovery = chipFor('Recovery 3');
        expect(recovery.getAttribute('aria-disabled')).toBe('true');
        expect(recovery.getAttribute('title') ?? '').toContain('Raise Stage 2 above 0%');
    });

    it('does not move a control across the engagement threshold', () => {
        // The layout claim, asserted as a claim about the layout: the same
        // controls are present on both sides of `blendAmount > 0.001`.
        renderPanel({ topology: 'vca', blendTopology: 'diode', blendAmount: 0.001 });
        const belowCount = screen.queryAllByRole('button').length;

        cleanup();
        renderPanel({ topology: 'vca', blendTopology: 'diode', blendAmount: 0.002 });

        expect(screen.queryAllByRole('button').length).toBe(belowCount);
        expect(chipFor('Recovery 3').getAttribute('aria-disabled')).toBeNull();
    });

    it('shows one unheaded block when Stage two names the primary', () => {
        // The only single-stage state, and the one `blendTopology` defaults
        // into when the primary is Opto.
        renderPanel({ topology: 'opto', blendTopology: 'opto' });

        expect(screen.queryByText('Primary — Opto')).toBeNull();
        expect(screen.queryByText('Recovery 3')).toBeNull();
    });
});

describe('the Stage-two chooser shows the state its reason names', () => {
    it('renders all four topologies and refuses the primary’s own chip', () => {
        renderPanel({ topology: 'opto', blendTopology: 'opto' });

        for (const label of ['VCA', 'FET', 'Diode']) {
            expect(chipFor(label).getAttribute('aria-disabled'), label).toBeNull();
        }
        const own = chipFor('Opto');
        expect(own.getAttribute('aria-disabled')).toBe('true');
        expect(own.getAttribute('title') ?? '').toContain('already the primary topology');
    });
});

describe('a refused control’s reason is readable without a pointer', () => {
    it('prints one line on the card naming the refused controls and the way back', () => {
        // `title` has no keyboard and no touch trigger, so it cannot be the
        // only channel. The card line is the same information on the page.
        renderPanel({ topology: 'diode', scEqGain: 6, blendTopology: 'vca' });

        // One line per card that has refused controls, so several cards carry
        // one at once — the Clamp card's is the one that names Knee.
        const lines = screen.getAllByText(/inert here/).map((node) => node.textContent);
        const clampLine = lines.find((line) => line.includes('Knee')) ?? '';

        expect(clampLine, `no card line named Knee; lines were ${JSON.stringify(lines)}`).toContain('Release');
        expect(clampLine).toContain('Select VCA');
    });

    it('leaves the card description alone when nothing in it is refused', () => {
        renderPanel({ topology: 'vca', scEqGain: 6, blendTopology: 'opto' });

        // The Clamp card is wholly live on the VCA.
        expect(screen.getByText('Threshold, ratio, and timing stay front and center.')).toBeTruthy();
    });
});
