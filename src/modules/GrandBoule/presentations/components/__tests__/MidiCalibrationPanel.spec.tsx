import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { MidiCalibrationPanel } from '../MidiCalibrationPanel';

const HISTOGRAM_MAX_SAMPLES = 128;

const baseProps = () => ({
    calibration: createDefaultMidiCalibration(),
    onVelocityCurveExponentChange: vi.fn(),
    onVelocityFloorChange: vi.fn(),
    onVelocityCeilingChange: vi.fn(),
    onCcSmoothingMsChange: vi.fn(),
    onSustainThresholdChange: vi.fn(),
    onReset: vi.fn(),
});

describe('MidiCalibrationPanel', () => {
    it('offers exactly the five calibratable parameters, and no aftertouch control', () => {
        // Both directions on purpose: the absence claim is the point (a piano
        // has no aftertouch response to scale, and no premium piano engine
        // ships a fixed-sensitivity knob into one), but an absence assertion
        // alone stays green if the whole panel stops rendering. The five
        // present labels are the pin that keeps it honest.
        render(<MidiCalibrationPanel {...baseProps()} lastVelocity={null} />);

        for (const label of ['Curve', 'Floor', 'Ceiling', 'CC Smooth', 'Sus Thresh']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        expect(screen.queryByText(/aftertouch/i)).not.toBeInTheDocument();
        expect(screen.getAllByRole('slider')).toHaveLength(5);
    });

    it('labels each calibration knob so its slider resolves by accessible name', () => {
        render(<MidiCalibrationPanel {...baseProps()} lastVelocity={null} />);

        for (const label of ['Curve', 'Floor', 'Ceiling', 'CC Smooth', 'Sus Thresh']) {
            expect(screen.getByRole('slider', { name: label })).toBeInTheDocument();
        }
    });

    it('should render', () => {
        render(<MidiCalibrationPanel {...baseProps()} lastVelocity={null} />);
        expect(screen.getByText(/midi calibration/i)).toBeInTheDocument();
    });

    it('shows the play-to-calibrate prompt and no histogram before any input', () => {
        render(<MidiCalibrationPanel {...baseProps()} lastVelocity={null} />);
        expect(screen.getByText(/play notes to calibrate/i)).toBeInTheDocument();
        expect(screen.queryByRole('img', { name: /velocity histogram/i })).not.toBeInTheDocument();
    });

    it('labels the velocity histogram canvas for assistive tech once input arrives', () => {
        const props = baseProps();
        const { rerender } = render(<MidiCalibrationPanel {...props} lastVelocity={null} />);
        // First note-on.
        rerender(<MidiCalibrationPanel {...props} lastVelocity={90} />);

        const histogram = screen.getByRole('img', { name: /velocity histogram/i });
        expect(histogram).toBeInTheDocument();
        expect(histogram.getAttribute('aria-label')).toMatch(/last 1 note\b/);
    });

    it('caps the rolling sample window at the ring-buffer capacity', () => {
        const props = baseProps();
        const { rerender } = render(<MidiCalibrationPanel {...props} lastVelocity={null} />);

        // Feed more note-ons than the ring can hold. Each distinct value forces
        // the lastVelocity effect to push exactly once.
        for (let i = 0; i < HISTOGRAM_MAX_SAMPLES + 40; i += 1) {
            rerender(<MidiCalibrationPanel {...props} lastVelocity={(i % 126) + 1} />);
        }

        const histogram = screen.getByRole('img', { name: /velocity histogram/i });
        // The label reports the retained sample count, which must saturate at
        // the ring capacity rather than growing unbounded.
        expect(histogram.getAttribute('aria-label')).toMatch(new RegExp(`last ${HISTOGRAM_MAX_SAMPLES} notes`));
    });

    it('clears the rolling samples when reset is pressed', () => {
        const onReset = vi.fn();
        const props = { ...baseProps(), onReset };
        const { rerender } = render(<MidiCalibrationPanel {...props} lastVelocity={null} />);
        rerender(<MidiCalibrationPanel {...props} lastVelocity={70} />);
        expect(screen.getByRole('img', { name: /velocity histogram/i })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /reset defaults/i }));
        expect(onReset).toHaveBeenCalledTimes(1);
        // Histogram disappears and the prompt returns.
        expect(screen.queryByRole('img', { name: /velocity histogram/i })).not.toBeInTheDocument();
        expect(screen.getByText(/play notes to calibrate/i)).toBeInTheDocument();
    });
});
