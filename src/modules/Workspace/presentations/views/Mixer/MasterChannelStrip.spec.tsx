import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MasterChannelStrip } from './MasterChannelStrip';

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        masterGain: 80,
    })),
}));

// Mock useCases
vi.mock('#/modules/Transport/useCases/setMasterGain', () => ({
    setMasterGain: vi.fn(),
}));

// Mock child components
vi.mock('#/components/daw/DawChannelStripShell', () => ({
    DawChannelStripShell: ({ children, className }: any) => <div data-testid="channel-strip-shell" className={className}>{children}</div>,
}));

vi.mock('#/components/daw/Fader', () => ({
    Fader: ({ value, onChange }: any) => (
        <input
            type="range"
            data-testid="fader"
            value={value}
            onChange={(e) => onChange(parseFloat(e.target.value))}
        />
    ),
}));

vi.mock('./MixerLevelReadout', () => ({
    MixerLevelReadout: ({ control, value }: any) => (
        <div data-testid="mixer-level-readout">
            {control}
            <span data-testid="level-value">{value}</span>
        </div>
    ),
}));

describe('MasterChannelStrip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render with correct width class', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('channel-strip-shell')).toHaveClass('w-36');
    });

    it('should show "Master" label', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('should call setMasterGain on fader change', async () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        fireEvent.change(fader, { target: { value: '0.5' } });
        
        const { setMasterGain } = await import('#/modules/Transport/useCases/setMasterGain');
        expect(setMasterGain).toHaveBeenCalledWith(50);
    });

    it('should display correct dB value for gain 80', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('level-value')).toHaveTextContent('0.0 dB');
    });
});
