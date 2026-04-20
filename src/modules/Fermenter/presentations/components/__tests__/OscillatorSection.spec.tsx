import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { OscillatorSection } from '../OscillatorSection';

describe('OscillatorSection', () => {
    it('should render', () => {
        const p = DEFAULT_PATCH;
        render(
            <OscillatorSection
                engine={p.oscEngine}
                waveform={p.oscWaveform}
                level={p.oscLevel}
                coarse={p.oscCoarse}
                fine={p.oscFine}
                pulseWidth={p.pulseWidth}
                noiseLevel={p.noiseLevel}
                noiseColor={p.noiseColor}
                onEngineChange={vi.fn()}
                onWaveformChange={vi.fn()}
                onLevelChange={vi.fn()}
                onCoarseChange={vi.fn()}
                onFineChange={vi.fn()}
                onPulseWidthChange={vi.fn()}
                onNoiseLevelChange={vi.fn()}
                onNoiseColorChange={vi.fn()}
            />
        );
        expect(screen.getByText(/oscillator/i)).toBeInTheDocument();
    });
});
