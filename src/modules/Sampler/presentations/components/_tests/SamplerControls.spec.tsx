import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SamplerControls } from '../SamplerControls';

describe('SamplerControls', () => {
    it('should render', () => {
        render(
            <SamplerControls
                mode="quick"
                envelope={{ attack: 0, hold: 0, decay: 0, sustain: 1, release: 0.1 }}
                filterCutoff={8000}
                filterResonance={1}
                filterType="lowpass"
                masterGain={1}
                tune={0}
                pan={0}
                onModeChange={vi.fn()}
                onEnvelopeChange={vi.fn()}
                onFilterChange={vi.fn()}
                onGainChange={vi.fn()}
                onTuneChange={vi.fn()}
                onPanChange={vi.fn()}
            />
        );
        expect(screen.getByText('Quick')).toBeInTheDocument();
    });
});
