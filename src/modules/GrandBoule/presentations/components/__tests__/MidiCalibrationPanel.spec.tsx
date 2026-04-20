import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultMidiCalibration } from '../../../models/GrandBouleMidiCalibration';
import { MidiCalibrationPanel } from '../MidiCalibrationPanel';

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
