import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ProcessorParams } from '../ProcessorParams';

import type { ProcessorType } from '../../../models/ProcessorCatalog';

function renderFor(type: ProcessorType, overrides: Record<string, unknown> = {}) {
    const onSetParam = vi.fn();
    const onCommand = vi.fn();
    const utils = render(
        <ProcessorParams
            processorId="p1"
            processorType={type}
            onSetParam={onSetParam}
            onCommand={onCommand}
            {...overrides}
        />
    );
    return { onSetParam, onCommand, ...utils };
}

/**
 * The Sel component renders a <select> whose accessible name is a sibling span
 * (not an associated <label>), so getByRole('combobox', {name}) won't match.
 * Find the label span by text, walk up to its shared container, and grab the
 * select within it.
 */
function findSelectByLabelText(label: string): HTMLSelectElement {
    // Selector labels render as <span> siblings of the <select>; restrict the
    // text search to spans so option text (e.g. 'Curve' as a Mode option) can't
    // collide with a selector label of the same name.
    const labelEl = screen.getByText(label, { selector: 'span' });
    const container = labelEl.parentElement;
    if (!container) {
        throw new Error(`no container for label ${label}`);
    }
    const select = container.querySelector('select');
    if (!select) {
        throw new Error(`no select sibling of label ${label}`);
    }
    return select;
}

/** Assert a labeled <select> exists, then change it and assert the callback arg. */
function selectChange(label: string, optionText: string): void {
    const select = findSelectByLabelText(label);
    const options = Array.from(select.options).map((o) => o.textContent);
    expect(options).toContain(optionText);
    fireEvent.change(select, { target: { value: String(options.indexOf(optionText)) } });
}

function selectOptionTexts(label: string): string[] {
    return Array.from(findSelectByLabelText(label).options).map((o) => o.textContent);
}

describe('ProcessorParams', () => {
    it('binds controls to stored params, falling back to compiled defaults', () => {
        renderFor('arpeggiator', { params: { mode: 2, rate_denom: 16, gate: 1.2 } });

        // The select is controlled by the stored param, not the literal 0.
        expect(findSelectByLabelText('Mode').value).toBe('2');
        expect(findSelectByLabelText('Mode').selectedOptions[0]?.textContent).toBe('Up-Down');

        // Knobs expose the stored value through the slider role.
        expect(screen.getByRole('slider', { name: 'Rate' })).toHaveAttribute('aria-valuenow', '16');
        expect(screen.getByRole('slider', { name: 'Gate' })).toHaveAttribute('aria-valuenow', '1.2');
        // swing has no stored value: the compiled default 0 shows through.
        expect(screen.getByRole('slider', { name: 'Swing' })).toHaveAttribute('aria-valuenow', '0');
    });

    it('renders the arpeggiator controls and routes mode changes', () => {
        const { onSetParam } = renderFor('arpeggiator');
        expect(screen.getByText('Mode')).toBeInTheDocument();
        // 8 modes; changing to 'Chord' (index 6) routes through onSetParam.
        selectChange('Mode', 'Chord');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'mode', 6);
    });

    it('renders all eight arpeggiator mode options in order', () => {
        renderFor('arpeggiator');
        expect(selectOptionTexts('Mode')).toEqual([
            'Up',
            'Down',
            'Up-Down',
            'Down-Up',
            'Random',
            'Order',
            'Chord',
            'Pattern',
        ]);
    });

    it('routes Chord Memory Learn and Clear All through the command callback', () => {
        const { onSetParam, onCommand } = renderFor('chordMemory');

        screen.getByRole('button', { name: 'Learn' }).click();
        screen.getByRole('button', { name: 'Clear All' }).click();

        expect(onCommand).toHaveBeenNthCalledWith(1, 'p1', 'learn');
        expect(onCommand).toHaveBeenNthCalledWith(2, 'p1', 'clear');
        expect(onSetParam).not.toHaveBeenCalled();
    });

    it('awaits a promise-returning command callback without throwing', () => {
        const onCommand = vi.fn(() => Promise.resolve());
        render(
            <ProcessorParams
                processorId="cm-2"
                processorType="chordMemory"
                onSetParam={vi.fn()}
                onCommand={onCommand}
            />
        );
        screen.getByRole('button', { name: 'Learn' }).click();
        expect(onCommand).toHaveBeenCalledWith('cm-2', 'learn');
    });

    it('swallows a rejecting command promise (no unhandled rejection)', () => {
        const onCommand = vi.fn(() => Promise.reject(new Error('boom')));
        render(
            <ProcessorParams
                processorId="cm-3"
                processorType="chordMemory"
                onSetParam={vi.fn()}
                onCommand={onCommand}
            />
        );
        screen.getByRole('button', { name: 'Clear All' }).click();
        expect(onCommand).toHaveBeenCalledWith('cm-3', 'clear');
    });

    it('renders the chord generator controls and routes chord_type changes', () => {
        const { onSetParam } = renderFor('chord');
        selectChange('Chord', 'Maj7');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'chord_type', 7);
    });

    it('renders the scale quantizer controls and routes root/scale/remap changes', () => {
        const { onSetParam } = renderFor('scale');
        selectChange('Root', 'G');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'root', 7);
        selectChange('Scale', 'Blues');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'scale', 10);
        selectChange('Remap', 'Up');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'remap_mode', 1);
    });

    it('renders all 14 scale options in the scale selector', () => {
        renderFor('scale');
        expect(selectOptionTexts('Scale')).toHaveLength(14);
    });

    it('renders the harmonizer controls and routes voice enable toggles', () => {
        const { onSetParam } = renderFor('harmonizer');
        selectChange('V2', 'On');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'voice1_enabled', 1);
    });

    it('renders the repeater controls', () => {
        renderFor('repeater');
        expect(screen.getByText('Repeats')).toBeInTheDocument();
        expect(screen.getByText('Decay')).toBeInTheDocument();
        expect(screen.getByText('Pitch')).toBeInTheDocument();
    });

    it('renders the velocity processor controls and routes mode/curve changes', () => {
        const { onSetParam } = renderFor('velocity');
        selectChange('Mode', 'Curve');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'mode', 4);
        selectChange('Curve', 'Hard');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'curve', 2);
    });

    it('renders the humanizer controls and lists all five feel presets', () => {
        renderFor('humanizer');
        expect(selectOptionTexts('Feel')).toEqual(['Tight', 'Loose', 'Drunk', 'Rushed', 'Laid Back']);
    });

    it('renders the note filter controls and routes the invert toggle', () => {
        const { onSetParam } = renderFor('filter');
        selectChange('Invert', 'On');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'invert', 1);
    });

    it('renders the transposer controls', () => {
        renderFor('transposer');
        expect(screen.getByText('Semi')).toBeInTheDocument();
        expect(screen.getByText('Oct')).toBeInTheDocument();
        expect(screen.getByText('Random')).toBeInTheDocument();
    });

    it('renders the CC generator controls and routes shape changes', () => {
        const { onSetParam } = renderFor('ccGenerator');
        selectChange('Shape', 'Saw↓');
        expect(onSetParam).toHaveBeenCalledWith('p1', 'shape', 4);
    });

    it('renders the euclidean generator controls', () => {
        renderFor('euclidean');
        expect(screen.getByText('Hits')).toBeInTheDocument();
        expect(screen.getByText('Steps')).toBeInTheDocument();
        expect(screen.getByText('Rotate')).toBeInTheDocument();
    });

    it('renders the markov controls and the hold-notes hint', () => {
        renderFor('markov');
        expect(screen.getByText('Rate')).toBeInTheDocument();
        expect(screen.getByText('Hold notes to set states')).toBeInTheDocument();
    });

    it('renders the mutation engine controls', () => {
        renderFor('mutation');
        expect(screen.getByText('Depth')).toBeInTheDocument();
        expect(screen.getByText('Rate')).toBeInTheDocument();
    });

    it('renders MIDI-owned groove templates and routes selection through the assignment callback', () => {
        const onSetParam = vi.fn();
        const onSetGrooveTemplate = vi.fn();
        render(
            <ProcessorParams
                processorId="groove-1"
                processorType="groove"
                onSetParam={onSetParam}
                onCommand={vi.fn()}
                grooveTemplates={[
                    { id: 'groove-straight', name: 'Straight' },
                    { id: 'pocket-1', name: 'Pocket' },
                ]}
                selectedGrooveTemplateId="groove-straight"
                grooveAmount={0.75}
                onSetGrooveTemplate={onSetGrooveTemplate}
            />
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Groove template' }), {
            target: { value: 'pocket-1' },
        });

        const amountSlider = screen.getByRole('slider', { name: 'Amount' });
        fireEvent.pointerDown(amountSlider, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(amountSlider, { pointerId: 1, clientY: 80 });

        // Every move commits: K drops the transient flag so the controlled
        // knob tracks the drag through the store (transient writes only
        // apply an audio projection and would leave the knob frozen).
        expect(onSetParam).toHaveBeenCalledWith('groove-1', 'amount', expect.any(Number));

        fireEvent.pointerUp(amountSlider, { pointerId: 1 });

        expect(onSetParam).toHaveBeenLastCalledWith('groove-1', 'amount', expect.any(Number));
        expect(onSetGrooveTemplate).toHaveBeenCalledWith('groove-1', 'pocket-1');
        expect(onSetParam).not.toHaveBeenCalledWith('groove-1', 'template', expect.any(Number));
    });

    it('swallows a rejecting groove-template assignment promise', () => {
        const onSetGrooveTemplate = vi.fn(() => Promise.reject(new Error('nope')));
        render(
            <ProcessorParams
                processorId="groove-2"
                processorType="groove"
                onSetParam={vi.fn()}
                onCommand={vi.fn()}
                grooveTemplates={[{ id: 't1', name: 'T1' }]}
                selectedGrooveTemplateId="t1"
                onSetGrooveTemplate={onSetGrooveTemplate}
            />
        );
        fireEvent.change(screen.getByRole('combobox', { name: 'Groove template' }), { target: { value: 't1' } });
        expect(onSetGrooveTemplate).toHaveBeenCalledWith('groove-2', 't1');
    });

    it('returns null for an unknown processor type', () => {
        const { container } = renderFor('unknown' as ProcessorType);
        expect(container.firstChild).toBeNull();
    });

    it('drives a knob via keyboard and routes the changed value through onSetParam', () => {
        // The real RotaryKnob is role=slider, keyboard-driven. ArrowUp changes
        // the value and forwards it through onChange, which the ProcessorParams
        // K component routes to onSetParam as a committed (store-bound) write.
        const { onSetParam } = renderFor('transposer');
        const slider = screen.getByRole('slider', { name: 'Semi' });
        fireEvent.keyDown(slider, { key: 'ArrowUp' });
        expect(onSetParam).toHaveBeenCalledWith('p1', 'semitones', expect.any(Number));
        expect(onSetParam.mock.calls[0]?.[1]).toBe('semitones');
    });
});
