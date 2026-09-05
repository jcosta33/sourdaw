import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';

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

const commandMocks = vi.hoisted(() => ({
    executeUserAppAction: vi.fn(() => Promise.resolve()),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: commandMocks.executeUserAppAction,
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
        // `mockReturnValue` (used below to prove a cleared `gestureGain` reads a
        // later store change) overrides the base implementation permanently —
        // `clearAllMocks` resets calls, not implementations — so every test
        // re-asserts the 80 default rather than inheriting whatever a prior
        // test last set it to.
        storeMocks.useStore.mockReturnValue({ masterGain: 80 });
        commandMocks.executeUserAppAction.mockResolvedValue(undefined);
    });

    it('should render with correct width class', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('channel-strip-shell')).toHaveClass('w-36');
    });

    it('should show "Master" label', () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByText('Master')).toBeInTheDocument();
    });

    it('dispatches the settled change through the app action instead of writing the use case directly', async () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');

        // Flushed inside `act` so the dispatch's promise — and the `finally`
        // that clears `gestureGain` once it resolves — settles before the test
        // makes its assertions, instead of updating the component afterwards.
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.5' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.5, expectedPercent: 80 },
        });

        const { setMasterGain } = await import('#/modules/Transport/useCases');
        expect(setMasterGain).not.toHaveBeenCalled();
    });

    it('drives the fader and the dB readout from the gesture value while the drag is transient', async () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        const { setMasterGain } = await import('#/modules/Transport/useCases');

        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.5' } });

        expect(setMasterGain).toHaveBeenCalledWith(50, true);
        // The store mock never moves off `masterGain: 80` — the rendered fader
        // and dB readout tracking the transient sample instead of 0.8/-1.9dB
        // can only come from the component's own gesture-local display state.
        expect(screen.getByTestId('fader')).toHaveValue('0.5');
        expect(screen.getByTestId('level-value')).toHaveTextContent(`${formatGainDb(0.5)} dB`);
    });

    it('holds the gesture value until the settled dispatch resolves, then reads the store again', async () => {
        const { rerender } = render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');

        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.6' } });

        fader.removeAttribute('data-transient');
        fireEvent.change(fader, { target: { value: '0.8' } });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.8, expectedPercent: 80 },
        });

        await waitFor(() => {
            expect(screen.getByTestId('fader')).toHaveValue('0.8');
        });

        // With the gesture actually cleared, a later store change is what the
        // same fader instance now reads — a `gestureGain` never cleared would
        // keep showing the stale 0.8 forever regardless of what the store says.
        storeMocks.useStore.mockReturnValue({ masterGain: 60 });
        rerender(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('fader')).toHaveValue('0.6');
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
