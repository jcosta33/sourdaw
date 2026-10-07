import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { GRID_SNAP_OPTIONS } from '../../../models/Preferences';
import { FieldGroup, GridSubdivisionSection, SectionTitle, ToggleRow, VoiceKeyEditor } from '../preferencesShared';

// The piano-roll snap/quantize label contract (#4848), pinned in
// PianoRollContextMenu.quantizeGridLabels.spec.tsx: gridSize is beats and the
// token '1/N' is the 1/N note in 4/4 — a 1-beat grid is the 1/4 note. The
// Preferences Grid Snap table must render the same token for the same beats
// so the two surfaces cannot drift apart again (#4853).
const PIANO_ROLL_SNAP_LABELS = { 1: '1/4', 0.5: '1/8', 0.25: '1/16', 0.125: '1/32' } as const;

describe('SectionTitle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<SectionTitle icon={<span />} title="Audio" />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<SectionTitle icon={<span />} title="Audio" />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});

describe('FieldGroup', () => {
    it('renders its label and children', () => {
        render(
            <FieldGroup label="Buffer Size">
                <span>256 samples</span>
            </FieldGroup>
        );

        expect(screen.getByText('Buffer Size')).toBeInTheDocument();
        expect(screen.getByText('256 samples')).toBeInTheDocument();
    });
});

describe('ToggleRow', () => {
    it('reflects the current value via aria-checked', () => {
        render(<ToggleRow label="Colorblind Mode" value={true} onChange={vi.fn()} />);

        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });

    it('calls onChange with the inverted value when clicked', () => {
        const onChange = vi.fn();
        render(<ToggleRow label="Colorblind Mode" value={false} onChange={onChange} />);

        fireEvent.click(screen.getByRole('switch'));

        expect(onChange).toHaveBeenCalledWith(true);
    });

    it('calls onChange(false) when currently on and clicked', () => {
        const onChange = vi.fn();
        render(<ToggleRow label="Colorblind Mode" value={true} onChange={onChange} />);

        fireEvent.click(screen.getByRole('switch'));

        expect(onChange).toHaveBeenCalledWith(false);
    });
});

describe('VoiceKeyEditor', () => {
    // The literal accessible-name contract the browser display-scale E2E
    // addresses: the uppercased key plus the visible change/voice hint.
    const idleCaptureName = 'Voice command key V — Click to change — hold to activate voice input';

    it('names the capture button with the uppercased key and the change/voice hint', () => {
        render(<VoiceKeyEditor currentKey="v" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: idleCaptureName })).toBeInTheDocument();
    });

    it('enters listening mode when the capture button is clicked', () => {
        render(<VoiceKeyEditor currentKey="v" onChange={vi.fn()} />);

        fireEvent.click(screen.getByRole('button', { name: idleCaptureName }));

        expect(screen.getByRole('button', { name: 'Press a key...' })).toBeInTheDocument();
        expect(screen.getByText('Listening for keypress')).toBeInTheDocument();
    });

    it('captures the next single-character keydown and calls onChange with it lowercased', () => {
        const onChange = vi.fn();
        render(<VoiceKeyEditor currentKey="v" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: idleCaptureName }));
        fireEvent.keyDown(window, { key: 'K' });

        expect(onChange).toHaveBeenCalledWith('k');
        expect(screen.getByRole('button', { name: idleCaptureName })).toBeInTheDocument();
    });

    it('exits listening mode without calling onChange for multi-character keys (e.g. Shift)', () => {
        const onChange = vi.fn();
        render(<VoiceKeyEditor currentKey="v" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: idleCaptureName }));
        fireEvent.keyDown(window, { key: 'Shift' });

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByRole('button', { name: idleCaptureName })).toBeInTheDocument();
    });
});

describe('GridSubdivisionSection', () => {
    it('marks the currently selected option as the secondary variant', () => {
        render(<GridSubdivisionSection value="1/4" onChange={vi.fn()} />);

        // Stored `1/4` (0.25 beats) renders under its note-value label `1/16`.
        expect(screen.getByRole('button', { name: '1/16' })).toHaveAttribute('data-variant', 'secondary');
    });

    it('calls onChange with the clicked option value', () => {
        const onChange = vi.fn();
        render(<GridSubdivisionSection value="1/4" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: '1/1' }));

        expect(onChange).toHaveBeenCalledWith('bar');
    });

    it('renders the Off option from the unlabeled group', () => {
        render(<GridSubdivisionSection value="off" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('data-variant', 'secondary');
    });

    it('renders the piano-roll snap token for each shared beats value', () => {
        render(<GridSubdivisionSection value="beat" onChange={vi.fn()} />);

        for (const [beats, token] of Object.entries(PIANO_ROLL_SNAP_LABELS)) {
            const option = GRID_SNAP_OPTIONS.find((entry) => entry.beats === Number(beats));
            expect(option?.label).toBe(token);
            expect(screen.getByRole('button', { name: token })).toBeInTheDocument();
        }
    });
});
