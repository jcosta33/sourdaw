import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MidiCalibrationPanel } from './MidiCalibrationPanel';
import { createDefaultMidiCalibration } from '../../models/GrandBouleMidiCalibration';

describe('MidiCalibrationPanel', () => {
    it('should render', () => {
        render(
            <MidiCalibrationPanel
                calibration={createDefaultMidiCalibration()}
                lastVelocity={null}
                onVelocityCurveExponentChange={vi.fn()}
                onVelocityFloorChange={vi.fn()}
                onVelocityCeilingChange={vi.fn()}
                onCcSmoothingMsChange={vi.fn()}
                onSustainThresholdChange={vi.fn()}
                onAfterTouchSensitivityChange={vi.fn()}
                onReset={vi.fn()}
            />
        );
        expect(screen.getByText(/midi calibration/i)).toBeInTheDocument();
    });
});
