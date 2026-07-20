import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { MasterChannelStrip } from '../MasterChannelStrip';

// Mock hooks
const storeMocks = vi.hoisted(() => ({
    useStore: vi.fn<() => { masterGain: number }>(() => ({
        masterGain: 80,
    })),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: storeMocks.useStore,
}));

// Mock useCases
vi.mock('#/modules/Transport/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/useCases')>()),
    setMasterGain: vi.fn<(gain: number) => void>(),
}));

// Mock child components
vi.mock('#/components/daw/DawChannelStripShell', () => ({
    DawChannelStripShell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
        <div data-testid="channel-strip-shell" className={className}>
            {children}
        </div>
    ),
}));

vi.mock('#/components/daw/Fader', () => ({
    Fader: ({ value, onChange }: { value: number; onChange: (val: number) => void }) => (
        <input
            type="range"
            data-testid="fader"
            value={value}
            onChange={(event) => onChange(parseFloat(event.target.value))}
        />
    ),
}));

vi.mock('../MixerLevelReadout', () => ({
    MixerLevelReadout: ({ control, value }: { control: React.ReactNode; value: React.ReactNode }) => (
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

        const { setMasterGain } = await import('#/modules/Transport/useCases');
        expect(setMasterGain).toHaveBeenCalledWith(50);
    });

    it('should display correct dB value for gain 80', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('level-value')).toHaveTextContent('0.0 dB');
    });

    it('should display -∞ when master gain is 0', () => {
        storeMocks.useStore.mockReturnValueOnce({ masterGain: 0 });

        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('level-value')).toHaveTextContent('-∞');
    });

    it('should compute a negative dB value for a below-unity gain', () => {
        storeMocks.useStore.mockReturnValueOnce({ masterGain: 40 });

        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('level-value')).toHaveTextContent('-6.0 dB');
    });

    it('should scale master gain to the 0-1 fader range', () => {
        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('fader')).toHaveValue('0.8');
    });
});
