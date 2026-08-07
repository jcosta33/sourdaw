import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import {
    type GrandBoulePerNoteValues,
    PER_NOTE_PARAM_DESCRIPTORS,
    createDefaultPerNoteValues,
} from '../../../models/GrandBoulePerNoteParams';
import { PerNoteEditor } from '../PerNoteEditor';

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({
        value,
        onChange,
        'aria-label': ariaLabel,
    }: {
        value: number;
        onChange: (v: number) => void;
        'aria-label'?: string;
    }) => (
        <input
            type="range"
            data-testid={ariaLabel ?? 'knob'}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
        />
    ),
}));

const SELECTED_KEY = 40;

const withKey = (key: number, values: GrandBoulePerNoteValues) =>
    new Map<number, GrandBoulePerNoteValues>([[key, values]]);

describe('PerNoteEditor', () => {
    it('should render', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeTruthy();
    });

    it('disables Reset when no override exists for the selected key', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });

    it('disables Reset when the map holds a functionally-default entry for the selected key', () => {
        const overrides = withKey(SELECTED_KEY, createDefaultPerNoteValues());
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={overrides} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeDisabled();
    });

    it('enables Reset when a value deviates from default for the selected key', () => {
        const overrides = withKey(SELECTED_KEY, { ...createDefaultPerNoteValues(), hammerHardness: 1.5 });
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={overrides} />);
        expect(screen.getByRole('button', { name: /reset/i })).toBeEnabled();
    });
});

describe('PerNoteEditor — callback wiring', () => {
    it('fires onReset with the selected key when Reset is clicked', () => {
        const onReset = vi.fn();
        const overrides = withKey(SELECTED_KEY, { ...createDefaultPerNoteValues(), hammerHardness: 1.5 });
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={onReset} perNoteOverrides={overrides} />);
        fireEvent.click(screen.getByRole('button', { name: /reset/i }));
        expect(onReset).toHaveBeenCalledWith(SELECTED_KEY);
    });

    it('fires onParamChange with key, param name, and value when a knob changes', () => {
        const onParamChange = vi.fn();
        render(<PerNoteEditor onParamChange={onParamChange} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        // The first param descriptor knob
        const firstDescriptor = PER_NOTE_PARAM_DESCRIPTORS[0]!;
        const knob = screen.getAllByRole('slider')[0]!;
        fireEvent.change(knob, { target: { value: '0.75' } });
        expect(onParamChange).toHaveBeenCalledWith(SELECTED_KEY, firstDescriptor.key, 0.75);
    });
});

describe('PerNoteEditor — value display', () => {
    it('shows the computed value readout for each parameter', () => {
        const overrides = withKey(SELECTED_KEY, { ...createDefaultPerNoteValues(), hammerHardness: 0.42 });
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={overrides} />);
        // The hammerHardness value 0.42 should appear as "0.42"
        expect(screen.getByText(/0\.42/)).toBeTruthy();
    });

    it('renders a label for each parameter descriptor', () => {
        render(<PerNoteEditor onParamChange={vi.fn()} onReset={vi.fn()} perNoteOverrides={new Map()} />);
        for (const descriptor of PER_NOTE_PARAM_DESCRIPTORS) {
            expect(screen.getByText(descriptor.label)).toBeTruthy();
        }
    });
});
