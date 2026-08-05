import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch, type ProofPatchEdit } from '../../../models/ProofPatch';
import { ProofEqSection } from '../ProofEqSection';

function patch(overrides: Partial<ProofPatch> = {}): ProofPatch {
    return { ...DEFAULT_PATCH, ...overrides };
}

describe('ProofEqSection', () => {
    it('should render', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('EQ').length).toBeGreaterThan(0);
    });

    it('gives every EQ band control a distinct accessible name', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'EQ band 1 high pass',
            'EQ band 2 low shelf',
            'EQ band 3 peak',
            'EQ band 4 peak',
            'EQ band 5 peak',
            'EQ band 6 peak',
            'EQ band 7 high shelf',
            'EQ band 8 low pass',
            'EQ Low Cut frequency',
            'EQ Low Cut gain',
            'EQ Low Cut Q',
            'EQ Low Shelf frequency',
            'EQ Low Shelf gain',
            'EQ Low Shelf Q',
            'EQ Low-Mid frequency',
            'EQ Low-Mid gain',
            'EQ Low-Mid Q',
            'EQ Mid frequency',
            'EQ Mid gain',
            'EQ Mid Q',
            'EQ High-Mid frequency',
            'EQ High-Mid gain',
            'EQ High-Mid Q',
            'EQ High frequency',
            'EQ High gain',
            'EQ High Q',
            'EQ High Shelf frequency',
            'EQ High Shelf gain',
            'EQ High Shelf Q',
            'EQ High Cut frequency',
            'EQ High Cut gain',
            'EQ High Cut Q',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names the module toggle and every band enable button while exposing pressed state', () => {
        render(<ProofEqSection patch={DEFAULT_PATCH} gestureOwner={0} onPatchChange={vi.fn()} />);

        const moduleToggle = screen.getByRole('button', { name: 'EQ module' });
        expect(moduleToggle).toHaveAttribute('aria-pressed', String(!DEFAULT_PATCH.eqBypassed));

        const bandButtons = screen.getAllByRole('button', { name: /EQ .* band$/ });
        expect(bandButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
            'EQ Low Cut band',
            'EQ Low Shelf band',
            'EQ Low-Mid band',
            'EQ Mid band',
            'EQ High-Mid band',
            'EQ High band',
            'EQ High Shelf band',
            'EQ High Cut band',
        ]);
        expect(bandButtons.map((button) => button.getAttribute('aria-pressed'))).toEqual(
            DEFAULT_PATCH.eqBands.map((band) => String(band.enabled))
        );
    });
});

describe('ProofEqSection — module bypass toggle', () => {
    it('shows ON when not bypassed and OFF when bypassed', () => {
        const { rerender } = render(
            <ProofEqSection patch={patch({ eqBypassed: false })} gestureOwner={0} onPatchChange={vi.fn()} />
        );
        expect(screen.getByRole('button', { name: 'EQ module' }).textContent).toContain('ON');

        rerender(<ProofEqSection patch={patch({ eqBypassed: true })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByRole('button', { name: 'EQ module' }).textContent).toContain('OFF');
    });

    it('fires onPatchChange with inverted eqBypassed on click', () => {
        const onPatchChange = vi.fn();
        render(<ProofEqSection patch={patch({ eqBypassed: false })} gestureOwner={0} onPatchChange={onPatchChange} />);
        fireEvent.click(screen.getByRole('button', { name: 'EQ module' }));
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('eqBypassed');
        expect(edit.value).toBe(true);
        expect(edit.isTransient).toBe(false);
    });
});

describe('ProofEqSection — band enable toggle', () => {
    it('fires updatePatch with inverted enabled state and preserves other bands immutably', () => {
        const onPatchChange = vi.fn();
        render(<ProofEqSection patch={patch()} gestureOwner={0} onPatchChange={onPatchChange} />);
        // Click the second band enable button (Low Shelf)
        const bandButtons = screen.getAllByRole('button', { name: /EQ .* band$/ });
        const originalEnabled = DEFAULT_PATCH.eqBands[1]!.enabled;
        fireEvent.click(bandButtons[1]!);
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('eqBands');
        const newBands = edit.value as ProofPatch['eqBands'];
        expect(newBands[1]?.enabled).toBe(!originalEnabled);
        // Other bands untouched
        for (let i = 0; i < DEFAULT_PATCH.eqBands.length; i++) {
            if (i !== 1) {
                expect(newBands[i]?.enabled).toBe(DEFAULT_PATCH.eqBands[i]!.enabled);
            }
        }
        if (!('changedParams' in edit)) {
            throw new Error('Expected changedParams on eqBands edit');
        }
        expect(edit.changedParams).toEqual([{ bandIndex: 1, field: 'enabled' }]);
    });
});

describe('ProofEqSection — frequency formatting', () => {
    it('renders sub-1000 Hz frequencies as plain numbers', () => {
        const bands = [...DEFAULT_PATCH.eqBands];
        bands[2] = { ...bands[2]!, freq: 250 };
        render(<ProofEqSection patch={patch({ eqBands: bands })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('250').length).toBeGreaterThan(0);
    });

    it('renders >=1000 Hz frequencies as kilohertz with one decimal', () => {
        const bands = [...DEFAULT_PATCH.eqBands];
        bands[2] = { ...bands[2]!, freq: 2500 };
        render(<ProofEqSection patch={patch({ eqBands: bands })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('2.5k').length).toBeGreaterThan(0);
    });
});

describe('ProofEqSection — gain formatting', () => {
    it('prepends + sign for positive gain', () => {
        const bands = [...DEFAULT_PATCH.eqBands];
        bands[2] = { ...bands[2]!, gain: 3.5 };
        render(<ProofEqSection patch={patch({ eqBands: bands })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('+3.5').length).toBeGreaterThan(0);
    });

    it('omits + sign for zero or negative gain', () => {
        const bands = [...DEFAULT_PATCH.eqBands];
        bands[2] = { ...bands[2]!, gain: 0 };
        bands[3] = { ...bands[3]!, gain: -2.5 };
        render(<ProofEqSection patch={patch({ eqBands: bands })} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getAllByText('0.0').length).toBeGreaterThan(0);
        expect(screen.getAllByText('-2.5').length).toBeGreaterThan(0);
    });
});

describe('ProofEqSection — band type select', () => {
    it('renders all five band type options per band', () => {
        render(<ProofEqSection patch={patch()} gestureOwner={0} onPatchChange={vi.fn()} />);
        const selects = screen.getAllByRole('combobox');
        // 8 bands × 2 selects (type + channel) = 16 total
        expect(selects.length).toBe(16);
        // First select is band 0's type selector
        const firstTypeSelect = selects[0];
        const options = firstTypeSelect?.querySelectorAll('option');
        expect(Array.from(options ?? []).map((o) => o.textContent)).toEqual([
            'Peak',
            'Lo Shelf',
            'Hi Shelf',
            'HP',
            'LP',
        ]);
    });

    it('fires updatePatch with parsed type index when a new band type is chosen', () => {
        const onPatchChange = vi.fn();
        render(<ProofEqSection patch={patch()} gestureOwner={0} onPatchChange={onPatchChange} />);
        const selects = screen.getAllByRole('combobox');
        // Change band 2's type select to index 2 (Hi Shelf)
        fireEvent.change(selects[4]!, { target: { value: '2' } });
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('eqBands');
        const newBands = edit.value as ProofPatch['eqBands'];
        expect(newBands[2]?.type).toBe(2);
        // Other bands retain their original types
        for (let i = 0; i < DEFAULT_PATCH.eqBands.length; i++) {
            if (i !== 2) {
                expect(newBands[i]?.type).toBe(DEFAULT_PATCH.eqBands[i]!.type);
            }
        }
    });
});

describe('ProofEqSection — channel mode select', () => {
    it('fires updatePatch with parsed channel index when channel mode is changed', () => {
        const onPatchChange = vi.fn();
        render(<ProofEqSection patch={patch()} gestureOwner={0} onPatchChange={onPatchChange} />);
        const selects = screen.getAllByRole('combobox');
        // Band 1's channel select is the 2nd select in that band (index 1 in the band, overall index 3)
        fireEvent.change(selects[3]!, { target: { value: '2' } });
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        const newBands = edit.value as ProofPatch['eqBands'];
        expect(newBands[1]?.channel).toBe(2);
    });
});
