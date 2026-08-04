import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { BounceOptionsDialog } from '../BounceOptionsDialog';

function renderDialog(overrides: Record<string, unknown> = {}) {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn();
    render(
        <BounceOptionsDialog
            track={{ name: 'Kick Bus' }}
            open
            onOpenChange={onOpenChange}
            onConfirm={onConfirm}
            {...overrides}
        />
    );
    return { onOpenChange, onConfirm };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('BounceOptionsDialog — computed title', () => {
    it('renders "Bounce {track.name}" as the dialog title', () => {
        renderDialog({ track: { name: 'Drums' } });
        expect(screen.getByText('Bounce Drums')).toBeInTheDocument();
    });
});

describe('BounceOptionsDialog — destination chooser cards', () => {
    it('renders New Track and Replace options', () => {
        renderDialog();
        expect(screen.getByText('New Track')).toBeInTheDocument();
        expect(screen.getByText('Replace')).toBeInTheDocument();
    });
});

describe('BounceOptionsDialog — signal chain checkboxes', () => {
    it('renders Include Inserts, Include Sends, Include Automation labels', () => {
        renderDialog();
        expect(screen.getByText('Include Inserts')).toBeInTheDocument();
        expect(screen.getByText('Include Sends')).toBeInTheDocument();
        expect(screen.getByText('Include Automation')).toBeInTheDocument();
    });
});

describe('BounceOptionsDialog — normalization and tail handling selects', () => {
    it('renders normalization select with off/protection/full options', () => {
        renderDialog();
        expect(screen.getByText('Off')).toBeInTheDocument();
        expect(screen.getByText('Peak Protection')).toBeInTheDocument();
        expect(screen.getByText('Full Normalize')).toBeInTheDocument();
    });

    it('renders tail handling select with auto/manual/off options', () => {
        renderDialog();
        expect(screen.getByText('Auto (Detect)')).toBeInTheDocument();
        expect(screen.getByText('Fixed (5s)')).toBeInTheDocument();
        expect(screen.getByText('None (Strict)')).toBeInTheDocument();
    });
});

describe('BounceOptionsDialog — footer buttons', () => {
    it('renders Cancel and Render buttons', () => {
        renderDialog();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Render' })).toBeInTheDocument();
    });

    it('Cancel calls onOpenChange(false)', () => {
        const { onOpenChange } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it('Render calls onConfirm with default options then onOpenChange(false)', () => {
        const { onConfirm, onOpenChange } = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Render' }));
        expect(onConfirm).toHaveBeenCalledTimes(1);
        const opts = onConfirm.mock.calls[0]?.[0];
        expect(opts.includeInserts).toBe(true);
        expect(opts.includeSends).toBe(false);
        expect(opts.includeAutomation).toBe(true);
        expect(opts.normalization).toBe('protection');
        expect(opts.tailHandling).toBe('auto');
        expect(opts.destination).toBe('new-track');
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});

describe('BounceOptionsDialog — description text', () => {
    it('renders the description paragraph', () => {
        renderDialog();
        expect(screen.getByText('Render this track to a high-quality audio clip.')).toBeInTheDocument();
    });
});
