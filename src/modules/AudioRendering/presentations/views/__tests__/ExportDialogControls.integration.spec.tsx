import { useState } from 'react';

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ExportDialog } from '../ExportDialog';

const exportSettingsKey = 'sourdaw:export-settings';

describe('ExportDialog controls', () => {
    beforeEach(() => {
        localStorage.removeItem(exportSettingsKey);
    });

    afterEach(() => {
        localStorage.removeItem(exportSettingsKey);
    });

    it('renders mixdown, stems, and render-to-clip modes with one selected at a time', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const mixdown = screen.getByTestId('export-mode-mixdown');
        const stems = screen.getByTestId('export-mode-stems');
        const renderToClip = screen.getByRole('button', { name: /^Render to clip/ });

        expect(mixdown).toBeVisible();
        expect(stems).toBeVisible();
        expect(renderToClip).toBeVisible();
        expect(mixdown).not.toHaveAttribute('data-variant', 'outline');
        expect(stems).toHaveAttribute('data-variant', 'outline');
        expect(renderToClip).toHaveAttribute('data-variant', 'outline');

        fireEvent.click(stems);

        expect(stems).not.toHaveAttribute('data-variant', 'outline');
        expect(mixdown).toHaveAttribute('data-variant', 'outline');
        expect(renderToClip).toHaveAttribute('data-variant', 'outline');

        fireEvent.click(renderToClip);

        expect(renderToClip).not.toHaveAttribute('data-variant', 'outline');
        expect(mixdown).toHaveAttribute('data-variant', 'outline');
        expect(stems).toHaveAttribute('data-variant', 'outline');
        expect(screen.getByTestId('export-start')).toHaveTextContent('Render to clip');
    });

    it('shows the whole-project render range selected by default', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const range = screen.getByRole('radiogroup', { name: 'Render range' });
        expect(range).toBeVisible();
        expect(within(range).getByRole('radio', { name: 'Whole project' })).toBeChecked();
    });

    it('shows loop and marquee ranges disabled when their real stores have no range', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const range = screen.getByRole('radiogroup', { name: 'Render range' });
        const loopRegion = within(range).getByRole('radio', { name: 'Loop region (set a loop first)' });
        const marquee = within(range).getByRole('radio', { name: 'Marquee selection (none)' });

        expect(loopRegion).toBeVisible();
        expect(loopRegion).toBeDisabled();
        expect(marquee).toBeVisible();
        expect(marquee).toBeDisabled();
    });

    it('shows WAV as the selected default and enables the default Export mixdown button', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const wav = screen.getByTestId('export-format-wav');
        const start = screen.getByTestId('export-start');

        expect(wav).toHaveAttribute('aria-checked', 'true');
        expect(start).toHaveTextContent('Export mixdown');
        expect(start).toBeEnabled();
    });

    it('shows WAV, MP3, and FLAC format controls with their labels', () => {
        render(<ExportDialog open onClose={() => {}} />);

        expect(screen.getByTestId('export-format-wav')).toBeVisible();
        expect(screen.getByTestId('export-format-mp3')).toBeVisible();
        expect(screen.getByTestId('export-format-flac')).toBeVisible();
        expect(screen.getByTestId('export-format-wav')).toHaveTextContent('WAV');
        expect(screen.getByTestId('export-format-flac')).toHaveTextContent('FLAC');
    });

    it('toggles the FLAC format checkbox on and off', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const flac = screen.getByTestId('export-format-flac');
        expect(flac).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(flac);
        expect(flac).toHaveAttribute('aria-checked', 'true');

        fireEvent.click(flac);
        expect(flac).toHaveAttribute('aria-checked', 'false');
    });

    it('allows WAV and MP3 formats to be selected simultaneously', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const wav = screen.getByTestId('export-format-wav');
        const mp3 = screen.getByTestId('export-format-mp3');
        expect(wav).toHaveAttribute('aria-checked', 'true');
        expect(mp3).toHaveAttribute('aria-checked', 'false');

        fireEvent.click(mp3);

        expect(wav).toHaveAttribute('aria-checked', 'true');
        expect(mp3).toHaveAttribute('aria-checked', 'true');
    });

    it('shows the auto-detected blank tail and enables the manual value when disabled', () => {
        render(<ExportDialog open onClose={() => {}} />);

        const tail = screen.getByLabelText('Tail seconds');
        const autoDetect = screen.getByLabelText('Auto-detect');

        expect(tail).toBeVisible();
        expect(tail).toBeDisabled();
        expect(tail).toHaveValue(null);
        expect(autoDetect).toBeVisible();
        expect(autoDetect).toBeChecked();

        fireEvent.click(autoDetect);

        expect(tail).toBeEnabled();
        expect(tail).toHaveValue(2);

        fireEvent.change(tail, { target: { value: '5' } });
        expect(tail).toHaveValue(5);
    });

    it('closes the rendered dialog when Cancel is clicked', async () => {
        const ControlledDialog = () => {
            const [open, setOpen] = useState(true);
            return <ExportDialog open={open} onClose={() => setOpen(false)} />;
        };
        render(<ControlledDialog />);

        expect(screen.getByRole('dialog', { name: 'Export audio' })).toBeVisible();
        fireEvent.click(screen.getByTestId('export-cancel'));

        await waitFor(() => {
            expect(screen.queryByRole('dialog', { name: 'Export audio' })).not.toBeInTheDocument();
        });
    });
});
