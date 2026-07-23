import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH, type ProofPatch, type ProofPatchEdit } from '../../../models/ProofPatch';
import { ProofLimiterSection } from '../ProofLimiterSection';

// Knob values that differ from each control's own defaultValue (-1 / 100 / 5),
// so a double-click reset produces an observable committed edit.
const OFF_DEFAULT_PATCH: ProofPatch = {
    ...DEFAULT_PATCH,
    limCeiling: -3,
    limRelease: 200,
    limLookahead: 8,
};

describe('ProofLimiterSection', () => {
    it('should render', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );
        expect(screen.getByText(/limiter/i)).toBeInTheDocument();
    });

    it('gives each limiter control a meaningful accessible name', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        const names = screen.getAllByRole('slider').map((control) => control.getAttribute('aria-label'));

        expect(names).toEqual(['Limiter ceiling', 'Limiter release', 'Limiter lookahead']);
        expect(new Set(names).size).toBe(names.length);
    });

    it('gives the module bypass toggle a contextual name and pressed state', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        expect(screen.getByRole('button', { name: 'Limiter module' })).toHaveAttribute(
            'aria-pressed',
            String(!DEFAULT_PATCH.limBypassed)
        );
    });

    it('commits the inverted bypass flag when the module toggle is clicked', () => {
        const onPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: 'Limiter module' }));

        expect(onPatchChange).toHaveBeenCalledWith({
            key: 'limBypassed',
            value: !DEFAULT_PATCH.limBypassed,
            isTransient: false,
        });
    });

    it('routes each knob reset to its own patch key as a committed edit', () => {
        const onPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
        render(
            <ProofLimiterSection
                patch={OFF_DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );

        const [ceiling, release, lookahead] = screen.getAllByRole('slider');
        fireEvent.doubleClick(ceiling!);
        fireEvent.doubleClick(release!);
        fireEvent.doubleClick(lookahead!);

        expect(onPatchChange.mock.calls.map(([edit]) => edit)).toEqual([
            { key: 'limCeiling', value: -1, isTransient: false },
            { key: 'limRelease', value: 100, isTransient: false },
            { key: 'limLookahead', value: 5, isTransient: false },
        ]);
    });

    it('maps the dither-mode selection to its enum value', () => {
        const onPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );

        const [ditherMode] = screen.getAllByRole('combobox');
        fireEvent.change(ditherMode!, { target: { value: '2' } });

        expect(onPatchChange).toHaveBeenCalledWith({
            key: 'ditherMode',
            value: 'noise_shaped',
            isTransient: false,
        });
    });

    it('commits the chosen dither bit depth as a number', () => {
        const onPatchChange = vi.fn<(edit: ProofPatchEdit) => void>();
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.5}
                gestureOwner={0}
                onPatchChange={onPatchChange}
            />
        );

        const bits = screen.getAllByRole('combobox')[1]!;
        fireEvent.change(bits, { target: { value: '24' } });

        expect(onPatchChange).toHaveBeenCalledWith({
            key: 'ditherBits',
            value: 24,
            isTransient: false,
        });
    });

    it('shows the gain-reduction readout and an honest -infinity true-peak when the signal is silent', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={-4.2}
                truePeakDb={-150}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        expect(screen.getByText('-4.2 dB')).toBeInTheDocument();
        expect(screen.getByText('-∞')).toBeInTheDocument();
    });

    it('flags an over-ceiling true peak numerically rather than as -infinity', () => {
        render(
            <ProofLimiterSection
                patch={DEFAULT_PATCH}
                limiterGrDb={0}
                truePeakDb={-0.3}
                gestureOwner={0}
                onPatchChange={vi.fn()}
            />
        );

        expect(screen.getByText('-0.3 dBTP')).toBeInTheDocument();
        expect(screen.queryByText('-∞')).not.toBeInTheDocument();
    });
});
