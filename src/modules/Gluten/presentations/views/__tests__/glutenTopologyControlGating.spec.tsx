import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type GlutenPatch } from '../../../models/GlutenPatch';
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
            expect(release.getAttribute('title')).toContain('Recovery');
        });

        it('refuses the Auto rel chip and says why on the control itself', () => {
            renderPanel({ topology: 'diode' });

            const autoRelease = chipFor('Auto rel');
            expect(autoRelease.getAttribute('aria-disabled')).toBe('true');
            expect(autoRelease.getAttribute('title')).toContain('Diode');
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
};

describe('every censused control is actually refused on the screen', () => {
    it.each(GLUTEN_TOPOLOGY_GAPS)('$topology', (gap) => {
        renderPanel({ topology: gap.topology });

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
});
