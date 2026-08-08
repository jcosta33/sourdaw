import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type VoiceStackParams } from '../../../models/CrumbsTypes';
import { CrumbsControls } from '../CrumbsControls';

type Props = React.ComponentProps<typeof CrumbsControls>;

function defaultProps(overrides: Partial<Props> = {}): Props {
    return {
        mode: 'quick',
        envelope: { attack: 0.01, hold: 0, decay: 0.3, sustain: 1, release: 0.1 },
        filterCutoff: 8000,
        filterResonance: 1,
        filterType: 'lowpass',
        masterGain: 1,
        tune: 0,
        pan: 0,
        onModeChange: vi.fn(),
        onParamChange: vi.fn(),
        ...overrides,
    };
}

describe('CrumbsControls — mode switcher', () => {
    it('renders all five mode chips with capitalized labels', () => {
        render(<CrumbsControls {...defaultProps()} />);
        for (const label of ['Quick', 'Drum', 'Slice', 'Warp', 'Record']) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
    });

    it('applies the active accent class to the selected mode and not to others', () => {
        render(<CrumbsControls {...defaultProps({ mode: 'drum' })} />);
        const drumChip = screen.getByText('Drum').closest('button')!;
        const quickChip = screen.getByText('Quick').closest('button')!;
        // Active chip gets the lavender accent class; inactive gets the muted default.
        expect(drumChip.className).toContain('accent-lavender');
        expect(quickChip.className).not.toContain('accent-lavender');
    });
});

describe('CrumbsControls — envelope readouts', () => {
    it('formats attack below 10ms in milliseconds', () => {
        render(
            <CrumbsControls
                {...defaultProps({ envelope: { attack: 0.005, hold: 0, decay: 0.3, sustain: 1, release: 0.1 } })}
            />
        );
        expect(screen.getByText('5ms')).toBeInTheDocument();
    });

    it('formats attack at or above 10ms in seconds', () => {
        render(
            <CrumbsControls
                {...defaultProps({ envelope: { attack: 0.5, hold: 0, decay: 0.3, sustain: 1, release: 0.1 } })}
            />
        );
        expect(screen.getByText('0.50s')).toBeInTheDocument();
    });

    it('formats sustain as a percentage', () => {
        render(
            <CrumbsControls
                {...defaultProps({ envelope: { attack: 0.01, hold: 0, decay: 0.3, sustain: 0.75, release: 0.1 } })}
            />
        );
        expect(screen.getByText('75%')).toBeInTheDocument();
    });

    it('formats hold in milliseconds', () => {
        render(
            <CrumbsControls
                {...defaultProps({ envelope: { attack: 0.01, hold: 0.02, decay: 0.3, sustain: 1, release: 0.1 } })}
            />
        );
        expect(screen.getByText('20ms')).toBeInTheDocument();
    });
});

describe('CrumbsControls — filter and output readouts', () => {
    it('formats cutoff above 1000Hz in kHz', () => {
        render(<CrumbsControls {...defaultProps({ filterCutoff: 8000 })} />);
        expect(screen.getByText('8.0k')).toBeInTheDocument();
    });

    it('formats cutoff below 1000Hz in Hz', () => {
        render(<CrumbsControls {...defaultProps({ filterCutoff: 500 })} />);
        expect(screen.getByText('500')).toBeInTheDocument();
    });

    it('formats gain as a percentage', () => {
        render(<CrumbsControls {...defaultProps({ masterGain: 0.8 })} />);
        expect(screen.getByText('80%')).toBeInTheDocument();
    });

    it('formats positive tune with a + sign', () => {
        render(<CrumbsControls {...defaultProps({ tune: 7 })} />);
        expect(screen.getByText('+7.0st')).toBeInTheDocument();
    });

    it('formats negative tune without a + sign', () => {
        render(<CrumbsControls {...defaultProps({ tune: -3 })} />);
        expect(screen.getByText('-3.0st')).toBeInTheDocument();
    });

    it('formats zero tune without a + sign', () => {
        render(<CrumbsControls {...defaultProps({ tune: 0 })} />);
        expect(screen.getByText('0.0st')).toBeInTheDocument();
    });
});

describe('CrumbsControls — pan readout direction', () => {
    it('shows "C" for centered pan', () => {
        render(<CrumbsControls {...defaultProps({ pan: 0 })} />);
        expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('shows "L<n>" for left pan', () => {
        render(<CrumbsControls {...defaultProps({ pan: -0.5 })} />);
        expect(screen.getByText('L50')).toBeInTheDocument();
    });

    it('shows "R<n>" for right pan', () => {
        render(<CrumbsControls {...defaultProps({ pan: 0.75 })} />);
        expect(screen.getByText('R75')).toBeInTheDocument();
    });
});

describe('CrumbsControls — voice stack', () => {
    it('does not render the voice stack section when voiceStack is absent', () => {
        render(<CrumbsControls {...defaultProps()} />);
        expect(screen.queryByText('Voice Stack')).not.toBeInTheDocument();
    });

    it('renders the voice stack knobs when voiceStack + onStackChange are provided', () => {
        const voiceStack: VoiceStackParams = { stackCount: 3, detuneSpread: 12, stackSpread: 0.5 };
        render(<CrumbsControls {...defaultProps({ voiceStack, onStackChange: vi.fn() })} />);
        expect(screen.getByText('Voice Stack')).toBeInTheDocument();
        expect(screen.getByText('3')).toBeInTheDocument();
        expect(screen.getByText('12.0¢')).toBeInTheDocument();
        expect(screen.getByText('50%')).toBeInTheDocument();
    });
});
