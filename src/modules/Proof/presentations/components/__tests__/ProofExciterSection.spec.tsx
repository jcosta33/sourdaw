import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch, type ProofPatchEdit } from '../../../models/ProofPatch';
import { ProofExciterSection } from '../ProofExciterSection';

function patch(overrides: Partial<ProofPatch> = {}): ProofPatch {
    return { ...DEFAULT_PATCH, ...overrides };
}

function enabledBands(): ProofPatch['excBands'] {
    return [
        { type: 0, drive: 0.2, blend: 0.3, enabled: true },
        { type: 1, drive: 0.4, blend: 0.5, enabled: false },
        { type: 2, drive: 0.6, blend: 0.7, enabled: true },
        { type: 3, drive: 0.8, blend: 0.9, enabled: false },
    ];
}

describe('ProofExciterSection', () => {
    it('should render', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/harmonic exciter/i)).toBeInTheDocument();
    });

    it('names each repeated exciter control with its band identity', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'Exciter Sub drive',
            'Exciter Sub blend',
            'Exciter Low-Mid drive',
            'Exciter Low-Mid blend',
            'Exciter Hi-Mid drive',
            'Exciter Hi-Mid blend',
            'Exciter High drive',
            'Exciter High blend',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names the module and every band enable toggle with pressed state', () => {
        render(<ProofExciterSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Exciter module' })).toHaveAttribute(
            'aria-pressed',
            String(!DEFAULT_PATCH.excBypassed)
        );
        const bandButtons = screen.getAllByRole('button', { name: /exciter band$/i });
        expect(bandButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'Sub exciter band',
            'Low-Mid exciter band',
            'Hi-Mid exciter band',
            'High exciter band',
        ]);
        expect(bandButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(
            DEFAULT_PATCH.excBands.map((band) => String(band.enabled))
        );
    });
});

describe('ProofExciterSection — module bypass toggle', () => {
    it('shows ON label when not bypassed, OFF when bypassed', () => {
        const { rerender } = render(
            <ProofExciterSection patch={patch({ excBypassed: false })} gestureOwner={0} onPatchChange={vi.fn()} />
        );
        expect(screen.getByRole('button', { name: 'Exciter module' }).textContent).toContain('ON');

        rerender(<ProofExciterSection patch={patch({ excBypassed: true })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'Exciter module' }).textContent).toContain('OFF');
    });

    it('fires onPatchChange with inverted excBypassed on click', () => {
        const onPatchChange = vi.fn();
        render(
            <ProofExciterSection patch={patch({ excBypassed: false })} gestureOwner={0} onPatchChange={onPatchChange} />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Exciter module' }));
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('excBypassed');
        expect(edit.value).toBe(true);
        expect(edit.isTransient).toBe(false);
    });
});

describe('ProofExciterSection — per-band enable toggle', () => {
    it('shows ON for enabled bands and OFF for disabled bands', () => {
        render(
            <ProofExciterSection patch={patch({ excBands: enabledBands() })} gestureOwner={0} onPatchChange={vi.fn()} />
        );
        const bandButtons = screen.getAllByRole('button', { name: /exciter band$/i });
        expect(bandButtons[0]?.textContent).toContain('ON');
        expect(bandButtons[1]?.textContent).toContain('OFF');
        expect(bandButtons[2]?.textContent).toContain('ON');
        expect(bandButtons[3]?.textContent).toContain('OFF');
    });

    it('fires updateBand with inverted enabled state and preserves other bands immutably', () => {
        const bands = enabledBands();
        const onPatchChange = vi.fn();
        render(
            <ProofExciterSection patch={patch({ excBands: bands })} gestureOwner={0} onPatchChange={onPatchChange} />
        );
        // Click the second band (Low-Mid, currently enabled: false → true)
        fireEvent.click(screen.getAllByRole('button', { name: /exciter band$/i })[1]!);
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('excBands');
        const newBands = edit.value as ProofPatch['excBands'];
        // Only band 1 changed
        expect(newBands[1]?.enabled).toBe(true);
        // Other bands untouched
        expect(newBands[0]?.enabled).toBe(true);
        expect(newBands[2]?.enabled).toBe(true);
        expect(newBands[3]?.enabled).toBe(false);
        // changedParams identifies the targeted band and field
        if (!('changedParams' in edit)) {
            throw new Error('Expected changedParams on excBands edit');
        }
        expect(edit.changedParams).toEqual([{ bandIndex: 1, field: 'enabled' }]);
    });
});

describe('ProofExciterSection — saturation type select', () => {
    it('renders all four saturation type options per band', () => {
        render(
            <ProofExciterSection patch={patch({ excBands: enabledBands() })} gestureOwner={0} onPatchChange={vi.fn()} />
        );
        const selects = screen.getAllByRole('combobox');
        expect(selects).toHaveLength(4);
        // First band's select has Tape/Tube/Transistor/Warm
        const options = selects[0]?.querySelectorAll('option');
        expect(Array.from(options ?? []).map((o) => o.textContent)).toEqual(['Tape', 'Tube', 'Transistor', 'Warm']);
    });

    it('fires updateBand with parsed type index when a new saturation type is chosen', () => {
        const bands = enabledBands();
        const onPatchChange = vi.fn();
        render(
            <ProofExciterSection patch={patch({ excBands: bands })} gestureOwner={0} onPatchChange={onPatchChange} />
        );
        const selects = screen.getAllByRole('combobox');
        // Change the third band (Hi-Mid) to Transistor (index 2)
        fireEvent.change(selects[2]!, { target: { value: '2' } });
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('excBands');
        const newBands = edit.value as ProofPatch['excBands'];
        expect(newBands[2]?.type).toBe(2);
        // Other bands retain their original types
        expect(newBands[0]?.type).toBe(0);
        expect(newBands[1]?.type).toBe(1);
        expect(newBands[3]?.type).toBe(3);
        if (!('changedParams' in edit)) {
            throw new Error('Expected changedParams on excBands edit');
        }
        expect(edit.changedParams).toEqual([{ bandIndex: 2, field: 'type' }]);
    });
});
