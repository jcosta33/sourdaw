import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { BounceOptionsDialog } from '../BounceOptionsDialog';

const renderDialog = (
    overrides: Partial<{ onOpenChange: (open: boolean) => void; onConfirm: (options: unknown) => void }> = {}
) => {
    const onOpenChange = overrides.onOpenChange ?? vi.fn();
    const onConfirm = overrides.onConfirm ?? vi.fn();
    render(<BounceOptionsDialog track={{ name: 'Lead Vox' }} open onOpenChange={onOpenChange} onConfirm={onConfirm} />);
    return { onOpenChange, onConfirm };
};

describe('BounceOptionsDialog', () => {
    it('renders the track name in the title', () => {
        renderDialog();

        expect(screen.getByText('Bounce Lead Vox')).toBeInTheDocument();
    });

    it('defaults to inserts and automation included, sends excluded', () => {
        renderDialog();

        expect(screen.getByRole('checkbox', { name: /Include Inserts/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Include Automation/ })).toBeChecked();
        expect(screen.getByRole('checkbox', { name: /Include Sends/ })).not.toBeChecked();
    });

    it('defaults to the New Track destination card being active', () => {
        renderDialog();

        expect(screen.getByRole('button', { name: /New Track/ })).toHaveClass('border-white/18');
        expect(screen.getByRole('button', { name: /Replace/ })).not.toHaveClass('border-white/18');
    });

    it('switches destination to Replace when that card is clicked', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: /Replace/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ destination: 'replace' }));
    });

    it('toggles include-sends when its checkbox is clicked', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('checkbox', { name: /Include Sends/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ includeSends: true }));
    });

    it('unchecks include-inserts when its checkbox is clicked', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('checkbox', { name: /Include Inserts/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ includeInserts: false }));
    });

    it('changes normalization mode via the select', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.change(screen.getByDisplayValue('Peak Protection'), { target: { value: 'full' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ normalization: 'full' }));
    });

    it('changes tail handling via the select', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.change(screen.getByDisplayValue('Auto (Detect)'), { target: { value: 'manual' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ tailHandling: 'manual' }));
    });

    it('confirms with the full default option set and closes the dialog', () => {
        const onOpenChange = vi.fn();
        const onConfirm = vi.fn();
        renderDialog({ onOpenChange, onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith({
            includeInserts: true,
            includeSends: false,
            includeAutomation: true,
            normalization: 'protection',
            tailHandling: 'auto',
            destination: 'new-track',
        });
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('closes without confirming when Cancel is clicked', () => {
        const onOpenChange = vi.fn();
        const onConfirm = vi.fn();
        renderDialog({ onOpenChange, onConfirm });

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

        expect(onOpenChange).toHaveBeenCalledWith(false);
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it('toggles include-automation when its checkbox is clicked', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('checkbox', { name: /Include Automation/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ includeAutomation: false }));
    });

    it('switches destination back to New Track after selecting Replace', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.click(screen.getByRole('button', { name: /Replace/ }));
        fireEvent.click(screen.getByRole('button', { name: /New Track/ }));
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ destination: 'new-track' }));
    });

    it('ignores invalid normalization values (guards against unknown select options)', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        // Fire a change with a value that doesn't match any valid option.
        fireEvent.change(screen.getByDisplayValue('Peak Protection'), { target: { value: 'bogus' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        // The normalization stays at the default 'protection' because the guard rejected 'bogus'.
        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ normalization: 'protection' }));
    });

    it('ignores invalid tail-handling values (guards against unknown select options)', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.change(screen.getByDisplayValue('Auto (Detect)'), { target: { value: 'bogus' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ tailHandling: 'auto' }));
    });

    it('switches normalization to off', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.change(screen.getByDisplayValue('Peak Protection'), { target: { value: 'off' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ normalization: 'off' }));
    });

    it('switches tail handling to off', () => {
        const onConfirm = vi.fn();
        renderDialog({ onConfirm });

        fireEvent.change(screen.getByDisplayValue('Auto (Detect)'), { target: { value: 'off' } });
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));

        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ tailHandling: 'off' }));
    });
});
