import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch, type ProofPatchEdit } from '../../../models/ProofPatch';
import { ProofImagerSection } from '../ProofImagerSection';

function patch(overrides: Partial<ProofPatch> = {}): ProofPatch {
    return { ...DEFAULT_PATCH, ...overrides };
}

describe('ProofImagerSection', () => {
    it('should render', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText(/stereo imager/i)).toBeInTheDocument();
    });

    it('names each repeated imager control with its band identity', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} gestureOwner={0} onPatchChange={vi.fn()} />);

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual([
            'Imager Sub width',
            'Imager Low-Mid width',
            'Imager Hi-Mid width',
            'Imager High width',
            'Imager auto mono bass frequency',
        ]);
        expect(new Set(names).size).toBe(names.length);
    });

    it('names both imager toggles and exposes their pressed state', () => {
        render(<ProofImagerSection patch={DEFAULT_PATCH} correlation={0.5} gestureOwner={0} onPatchChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Imager module' })).toHaveAttribute(
            'aria-pressed',
            String(!DEFAULT_PATCH.imgBypassed)
        );
        expect(screen.getByRole('button', { name: 'Imager auto mono bass' })).toHaveAttribute(
            'aria-pressed',
            String(DEFAULT_PATCH.imgAutoMonoBass)
        );
    });
});

describe('ProofImagerSection — band width formatting', () => {
    it('renders "Mono" for bands with width 0 and the percentage for non-zero bands', () => {
        render(
            <ProofImagerSection
                patch={patch({ imgBandWidth: [0, 0.855, 1.0, 2.0] })}
                correlation={0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        // Sub (0) → Mono; Low-Mid (0.855 → 86%); Hi-Mid (1.0 → 100%); High (2.0 → 200%)
        expect(screen.getByText('Mono')).toBeTruthy();
        expect(screen.getByText('86%')).toBeTruthy();
        expect(screen.getByText('100%')).toBeTruthy();
        expect(screen.getByText('200%')).toBeTruthy();
    });
});

describe('ProofImagerSection — module bypass toggle', () => {
    it('shows ON label and aria-pressed true when not bypassed', () => {
        render(
            <ProofImagerSection
                patch={patch({ imgBypassed: false })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        const toggle = screen.getByRole('button', { name: 'Imager module' });
        expect(toggle).toHaveAttribute('aria-pressed', 'true');
        expect(toggle.textContent).toContain('ON');
    });

    it('shows OFF label and aria-pressed false when bypassed', () => {
        render(
            <ProofImagerSection
                patch={patch({ imgBypassed: true })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        const toggle = screen.getByRole('button', { name: 'Imager module' });
        expect(toggle).toHaveAttribute('aria-pressed', 'false');
        expect(toggle.textContent).toContain('OFF');
    });

    it('fires onPatchChange with inverted imgBypassed on click', () => {
        const onPatchChange = vi.fn();
        render(
            <ProofImagerSection
                patch={patch({ imgBypassed: false })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Imager module' }));
        expect(onPatchChange).toHaveBeenCalledTimes(1);
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('imgBypassed');
        expect(edit.value).toBe(true);
        expect(edit.isTransient).toBe(false);
    });
});

describe('ProofImagerSection — auto mono bass toggle', () => {
    it('reflects imgAutoMonoBass state in aria-pressed', () => {
        const { rerender } = render(
            <ProofImagerSection
                patch={patch({ imgAutoMonoBass: true })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: 'Imager auto mono bass' })).toHaveAttribute('aria-pressed', 'true');

        rerender(
            <ProofImagerSection
                patch={patch({ imgAutoMonoBass: false })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: 'Imager auto mono bass' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('fires onPatchChange with inverted imgAutoMonoBass on click', () => {
        const onPatchChange = vi.fn();
        render(
            <ProofImagerSection
                patch={patch({ imgAutoMonoBass: true })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: 'Imager auto mono bass' }));
        const edit = onPatchChange.mock.calls[0]?.[0] as ProofPatchEdit;
        expect(edit.key).toBe('imgAutoMonoBass');
        expect(edit.value).toBe(false);
        expect(edit.isTransient).toBe(false);
    });
});

describe('ProofImagerSection — frequency formatting', () => {
    it('renders the mono bass frequency rounded to integer Hz', () => {
        render(
            <ProofImagerSection
                patch={patch({ imgMonoBassFreq: 123.7 })}
                correlation={0}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        expect(screen.getByText('124 Hz')).toBeTruthy();
    });
});

describe('ProofImagerSection — correlation meter', () => {
    it('renders the correlation value to two decimal places', () => {
        render(<ProofImagerSection patch={patch()} correlation={0.678} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText('0.68')).toBeTruthy();
    });

    it('renders negative correlation value', () => {
        render(<ProofImagerSection patch={patch()} correlation={-0.42} gestureOwner={0} onPatchChange={vi.fn()} />);
        expect(screen.getByText('-0.42')).toBeTruthy();
    });
});
