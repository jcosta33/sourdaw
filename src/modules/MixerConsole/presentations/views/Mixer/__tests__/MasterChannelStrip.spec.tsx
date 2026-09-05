import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN } from '#/utils/audioLevelLaw';

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

// `data-transient` lets a test drive the mock as either a mid-drag sample or a
// settled commit: `Fader`'s real contract is a second `onChange` argument, which
// a bare `<input onChange>` has no room to carry, so the test sets the attribute
// on the node before firing `change` and the mock reads it back off.
vi.mock('#/components/daw/Fader', () => ({
    Fader: ({
        value,
        onChange,
        max,
    }: {
        value: number;
        onChange: (val: number, isTransient?: boolean) => void;
        max?: number;
    }) => (
        <input
            type="range"
            data-testid="fader"
            data-max={max}
            value={value}
            onChange={(event) => {
                const isTransient = event.target.dataset.transient === 'true';
                onChange(parseFloat(event.target.value), isTransient);
            }}
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
        expect(setMasterGain).toHaveBeenCalledWith(50, false);
    });

    it('drives the fader from the gesture value while the drag is transient, then commits settled', async () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        const { setMasterGain } = await import('#/modules/Transport/useCases');

        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.5' } });

        expect(setMasterGain).toHaveBeenCalledWith(50, true);
        // The store mock never moves off `masterGain: 80` — the rendered fader
        // tracking the transient sample instead of 0.8 can only come from the
        // component's own gesture-local display state.
        expect(screen.getByTestId('fader')).toHaveValue('0.5');

        fader.removeAttribute('data-transient');
        fireEvent.change(fader, { target: { value: '0.55' } });

        expect(setMasterGain).toHaveBeenCalledWith(expect.closeTo(55, 5), false);
    });

    it('should display correct dB value for gain 80', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        // The real gain law (`20 * log10(linear)`), not the old hand-rolled
        // `(masterGain / 80 - 1) * 12` formula that reported "0.0 dB" here.
        // True unity is masterGain 100 (linear 1.0); 80 is about -1.9 dB.
        expect(screen.getByTestId('level-value')).toHaveTextContent('-1.9 dB');
    });

    it('should display -∞ when master gain is 0', () => {
        storeMocks.useStore.mockReturnValueOnce({ masterGain: 0 });

        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('level-value')).toHaveTextContent('-∞');
    });

    it('should display 0.0 dB at true unity (masterGain 100)', () => {
        storeMocks.useStore.mockReturnValueOnce({ masterGain: 100 });

        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('level-value')).toHaveTextContent('0.0 dB');
    });

    it('should compute a negative dB value for a below-unity gain', () => {
        storeMocks.useStore.mockReturnValueOnce({ masterGain: 40 });

        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('level-value')).toHaveTextContent('-8.0 dB');
    });

    it('should scale master gain to the 0-1 fader range', () => {
        render(<MasterChannelStrip widthClass="w-36" />);

        expect(screen.getByTestId('fader')).toHaveValue('0.8');
    });

    it('gives the master fader real travel up to the +6 dB ceiling instead of dead space above unity', () => {
        render(<MasterChannelStrip widthClass="w-36" />);

        expect(Number(screen.getByTestId('fader').getAttribute('data-max'))).toBeCloseTo(FADER_MAX_GAIN, 5);
    });
});
