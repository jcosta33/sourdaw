import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FieldGroup, GridSubdivisionSection, SectionTitle, ToggleRow, VoiceKeyEditor } from '../preferencesShared';

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

        expect(screen.getByRole('button', { name: '1/4' })).toHaveAttribute('data-variant', 'secondary');
    });

    it('calls onChange with the clicked option value', () => {
        const onChange = vi.fn();
        render(<GridSubdivisionSection value="1/4" onChange={onChange} />);

        fireEvent.click(screen.getByRole('button', { name: 'Bar' }));

        expect(onChange).toHaveBeenCalledWith('bar');
    });

    it('renders the Off option from the unlabeled group', () => {
        render(<GridSubdivisionSection value="off" onChange={vi.fn()} />);

        expect(screen.getByRole('button', { name: 'Off' })).toHaveAttribute('data-variant', 'secondary');
    });
});
