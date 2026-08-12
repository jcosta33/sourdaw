import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type FermenterMacroTarget } from '../../../models/FermenterPatch';
import { MacroMatrixEditor } from '../MacroMatrixEditor';

// editableParams[0] (first param with no `step`) is `oscLevel`:
//   { id: 'oscLevel', min: 0, max: 1, default: 0.8, scaling: undefined }
// createTarget('oscLevel') therefore yields:
//   center = 0.8, depth = (1-0)/2 = 0.5, min = 0, max = 1, curve = 'linear'
const OSC_LEVEL_TARGET: FermenterMacroTarget = {
    target: 'oscLevel',
    center: 0.8,
    depth: 0.5,
    min: 0,
    max: 1,
    curve: 'linear',
};

// filterCutoff has scaling: 'log' → curve 'exponential'.
const FILTER_CUTOFF_EXPONENTIAL = { target: 'filterCutoff', curve: 'exponential' };

function lastEmitted(onChange: ReturnType<typeof vi.fn>) {
    const calls = onChange.mock.calls;
    return calls[calls.length - 1] as [number, Array<{ targets: unknown[] }>];
}

describe('MacroMatrixEditor', () => {
    describe('rendering', () => {
        it('renders the selected macro mapping targets', () => {
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={vi.fn()} />);

            expect(screen.getByText('Matrix')).toBeInTheDocument();
            expect(screen.getByLabelText('Macro')).toHaveValue('0');
            expect(screen.getByLabelText('Target 1')).toHaveValue('filterCutoff');
        });

        it('falls back to default mappings when a legacy patch has none', () => {
            render(<MacroMatrixEditor mappings={undefined} onChange={vi.fn()} />);
            expect(screen.getByLabelText('Target 1')).toHaveValue('filterCutoff');
        });

        it('switches the visible targets when the macro selector changes', () => {
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={vi.fn()} />);
            // Macro 0 = 'Brightness' → filterCutoff; Macro 1 = 'Motion' → lfoFilterAmount.
            fireEvent.change(screen.getByLabelText('Macro'), { target: { value: '1' } });
            expect(screen.getByLabelText('Target 1')).toHaveValue('lfoFilterAmount');
        });
    });

    describe('adding targets', () => {
        it('adds a target derived from the first continuous param (oscLevel) and emits it', () => {
            const onChange = vi.fn();
            // Start with a macro that has no targets so the added one is Target 1.
            render(<MacroMatrixEditor mappings={[{ targets: [] }]} onChange={onChange} />);

            fireEvent.click(screen.getByText('Add target'));

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[0]!.targets[0]).toMatchObject(OSC_LEVEL_TARGET);
        });

        it('disables the add button once three targets exist', () => {
            render(
                <MacroMatrixEditor
                    mappings={[
                        {
                            targets: [
                                { ...OSC_LEVEL_TARGET, target: 'oscLevel' },
                                { ...OSC_LEVEL_TARGET, target: 'oscFine' },
                                { ...OSC_LEVEL_TARGET, target: 'oscDrift' },
                            ],
                        },
                    ]}
                    onChange={vi.fn()}
                />
            );
            expect(screen.getByText('Add target')).toBeDisabled();
        });

        it('does not emit when adding to a macro already at the three-target cap', () => {
            const onChange = vi.fn();
            render(
                <MacroMatrixEditor
                    mappings={[
                        {
                            targets: [{ ...OSC_LEVEL_TARGET }, { ...OSC_LEVEL_TARGET }, { ...OSC_LEVEL_TARGET }],
                        },
                    ]}
                    onChange={onChange}
                />
            );
            fireEvent.click(screen.getByText('Add target'));
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    describe('removing targets', () => {
        it('removes the target at the clicked index and leaves the others intact', () => {
            const onChange = vi.fn();
            // Macro 3 ('Dirt') has two targets: distDrive, distMix.
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByLabelText('Macro'), { target: { value: '3' } });

            fireEvent.click(screen.getAllByText('Clear')[0]!);

            const [, emitted] = lastEmitted(onChange);
            // First target (distDrive) removed; distMix remains.
            expect(emitted[3]!.targets).toHaveLength(1);
            expect(emitted[3]!.targets[0]).toMatchObject({ target: 'distMix' });
        });
    });

    describe('editing target fields', () => {
        it('emits an updated center when the Center field changes', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            const centerInput = screen.getByDisplayValue('6090');
            fireEvent.change(centerInput, { target: { value: '8000' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[0]!.targets[0]).toMatchObject({ center: 8000 });
        });

        it('emits an updated depth when the Depth field changes', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            const depthInput = screen.getByDisplayValue('5910');
            fireEvent.change(depthInput, { target: { value: '4000' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[0]!.targets[0]).toMatchObject({ depth: 4000 });
        });

        it('emits an updated min when the Min field changes', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByDisplayValue('180'), { target: { value: '200' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[0]!.targets[0]).toMatchObject({ min: 200 });
        });

        it('emits an updated max when the Max field changes', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByDisplayValue('12000'), { target: { value: '16000' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[0]!.targets[0]).toMatchObject({ max: 16000 });
        });

        it('coerces a non-numeric input to 0 via Number() rather than NaN', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByDisplayValue('6090'), { target: { value: '' } });

            const [, emitted] = lastEmitted(onChange);
            // Number('') === 0
            expect(emitted[0]!.targets[0]).toMatchObject({ center: 0 });
        });
    });

    describe('curve selection', () => {
        it('switches a linear target to exponential via the curve select', () => {
            const onChange = vi.fn();
            // Macro 1 (lfoFilterAmount) is linear by default.
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByLabelText('Macro'), { target: { value: '1' } });

            // The curve select is the last <select> inside the target card.
            const selects = document.querySelectorAll('select');
            const curveSelect = selects[selects.length - 1] as HTMLSelectElement;
            fireEvent.change(curveSelect, { target: { value: 'exponential' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[1]!.targets[0]).toMatchObject({ curve: 'exponential' });
        });

        it('keeps a linear curve when selecting any non-exponential value', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            fireEvent.change(screen.getByLabelText('Macro'), { target: { value: '1' } });

            const selects = document.querySelectorAll('select');
            const curveSelect = selects[selects.length - 1] as HTMLSelectElement;
            // Any value other than 'exponential' normalizes back to 'linear'.
            fireEvent.change(curveSelect, { target: { value: 'bogus' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[1]!.targets[0]).toMatchObject({ curve: 'linear' });
        });
    });

    describe('target param selection', () => {
        it('offers continuous fine tune as a macro destination', () => {
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={vi.fn()} />);

            expect(screen.getByRole('option', { name: 'Fine' })).toHaveValue('oscFine');
        });

        it('derives an exponential curve when selecting a log-scaled param (filterCutoff)', () => {
            const onChange = vi.fn();
            render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);
            // Macro 1 default target is lfoFilterAmount (linear). Switch to filterCutoff.
            fireEvent.change(screen.getByLabelText('Macro'), { target: { value: '1' } });
            fireEvent.change(screen.getByLabelText('Target 1'), { target: { value: 'filterCutoff' } });

            const [, emitted] = lastEmitted(onChange);
            expect(emitted[1]!.targets[0]).toMatchObject(FILTER_CUTOFF_EXPONENTIAL);
        });
    });
});
