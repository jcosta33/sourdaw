import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';

import { type BounceOptions } from '../../../useCases/freezeBounce/bounceTrack';
import { BounceOptionsDialog } from '../BounceOptionsDialog';

const renderWithTooltip = (ui: React.ReactElement) => render(<TooltipProvider>{ui}</TooltipProvider>);

const track = { name: 'Guitar' };

describe('BounceOptionsDialog', () => {
    it('rejects an out-of-range normalization value and keeps the prior selection', () => {
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        renderWithTooltip(<BounceOptionsDialog track={track} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
        const selects = screen.getAllByRole('combobox');
        const normalizationSelect = selects[0]!;
        // Drive the type guard's false branch with a value the <option>s never produce.
        fireEvent.change(normalizationSelect, { target: { value: 'bogus' } });
        // Confirming must carry the default 'protection', not 'bogus'.
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));
        const opts = onConfirm.mock.calls[0]![0] as BounceOptions;
        expect(opts.normalization).toBe('protection');
    });

    it('accepts a valid normalization selection', () => {
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        renderWithTooltip(<BounceOptionsDialog track={track} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[0]!, { target: { value: 'full' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));
        const opts = onConfirm.mock.calls[0]![0] as BounceOptions;
        expect(opts.normalization).toBe('full');
    });

    it('rejects an out-of-range tail-handling value and keeps the prior selection', () => {
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        renderWithTooltip(<BounceOptionsDialog track={track} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
        const selects = screen.getAllByRole('combobox');
        const tailSelect = selects[1]!;
        fireEvent.change(tailSelect, { target: { value: 'bogus' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));
        const opts = onConfirm.mock.calls[0]![0] as BounceOptions;
        expect(opts.tailHandling).toBe('auto');
    });

    it('accepts a valid tail-handling selection', () => {
        const onConfirm = vi.fn();
        const onOpenChange = vi.fn();
        renderWithTooltip(<BounceOptionsDialog track={track} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
        const selects = screen.getAllByRole('combobox');
        fireEvent.change(selects[1]!, { target: { value: 'manual' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));
        const opts = onConfirm.mock.calls[0]![0] as BounceOptions;
        expect(opts.tailHandling).toBe('manual');
    });
});
