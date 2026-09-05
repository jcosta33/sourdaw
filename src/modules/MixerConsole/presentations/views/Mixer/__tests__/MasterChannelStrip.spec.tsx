import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { FADER_MAX_GAIN, formatGainDb } from '#/utils/audioLevelLaw';

import { MasterChannelStrip } from '../MasterChannelStrip';

// Mock hooks
const storeMocks = vi.hoisted(() => ({
    useStore: vi.fn<() => { masterGain: number }>(() => ({
        masterGain: 80,
    })),
    // What `restoreEngineFromProjectTruth` reads directly off `transportStore.value`
    // — deliberately a separate knob from `useStore`'s mock return above, so a
    // test can diverge them: the hook drives what the strip *displays*, this
    // drives what project truth *is* by the time a settled dispatch resolves.
    transportStoreValue: { masterGain: 80 } as { masterGain: number } | undefined,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: storeMocks.useStore,
}));

vi.mock('#/modules/Transport/stores', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Transport/stores')>()),
    transportStore: {
        get value() {
            return storeMocks.transportStoreValue;
        },
    },
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
        storeMocks.transportStoreValue = { masterGain: 80 };
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

        // The settle dispatches through the app action rather than writing
        // the use case with the raw target value (50) directly. The one call
        // that does land on `setMasterGain` is the post-settle engine
        // restore back to project truth — still 80, since the store mock
        // never moved — not the fader's released gesture value.
        const { setMasterGain } = await import('#/modules/Transport/useCases');
        expect(setMasterGain).toHaveBeenCalledTimes(1);
        expect(setMasterGain).toHaveBeenCalledWith(80, true);
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
        // A dispatch that resolves on its own microtask (the prior version of
        // this test) cannot tell "gesture cleared before the dispatch" from
        // "gesture cleared in `finally`" apart, because both land before the
        // next assertion runs. Holding the promise open lets the test observe
        // the display *while the commit is still in flight*.
        let resolveDispatch: (() => void) | undefined;
        commandMocks.executeUserAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveDispatch = resolve;
                })
        );

        const { rerender } = render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        const { setMasterGain } = await import('#/modules/Transport/useCases');

        // The transient sample uses a different value from the settle below:
        // firing `change` twice with an identical string is a same-value
        // no-op for a controlled input's native value tracker, so the second
        // event would never reach `onChange` at all.
        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.5' } });

        // Flushed inside `act` so the settled dispatch — chained onto
        // `pendingCommit` — has actually reached `executeUserAppAction` by
        // the time the assertions below run, rather than sitting queued as
        // an unflushed microtask.
        fader.removeAttribute('data-transient');
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.6' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.6, expectedPercent: 80 },
        });

        // While the dispatch is still in flight, the engine's last word is
        // still the transient sample fired above — moving
        // `restoreEngineFromProjectTruth()` ahead of the `await` would fire
        // it here, before the dispatch has actually landed.
        expect(setMasterGain).toHaveBeenLastCalledWith(50, true);

        // The store never moved (still 80), yet the fader and dB readout must
        // keep showing the gesture's 0.6 while the dispatch is still pending
        // — clearing `gestureGain` ahead of the dispatch would snap them back
        // to project truth before the commit has actually landed.
        expect(screen.getByTestId('fader')).toHaveValue('0.6');
        expect(screen.getByTestId('level-value')).toHaveTextContent(`${formatGainDb(0.6)} dB`);

        await act(async () => {
            resolveDispatch?.();
            await Promise.resolve();
        });

        expect(screen.getByTestId('fader')).toHaveValue('0.8');
        // Only once the dispatch has landed does the engine's last word
        // become the restored project truth (80), not the released gesture
        // sample (60).
        expect(setMasterGain).toHaveBeenLastCalledWith(80, true);

        // With the gesture actually cleared, a later store change is what the
        // same fader instance now reads — a `gestureGain` never cleared would
        // keep showing the stale 0.8 forever regardless of what the store says.
        storeMocks.useStore.mockReturnValue({ masterGain: 60 });
        rerender(<MasterChannelStrip widthClass="w-36" />);
        expect(screen.getByTestId('fader')).toHaveValue('0.6');
    });

    it('keeps a newer gesture as the display and engine owner when an earlier settle lands late behind a barrier', async () => {
        let resolveDispatchA: (() => void) | undefined;
        commandMocks.executeUserAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveDispatchA = resolve;
                })
        );

        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        const { setMasterGain } = await import('#/modules/Transport/useCases');

        // Gesture A releases at 0.65 — its settled dispatch (A) stays
        // pending, standing in for the Automerge snapshot transaction a
        // persistence barrier is holding open.
        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.65' } });
        fader.removeAttribute('data-transient');
        // A distinct string with the same parsed value as the transient
        // sample above — releasing exactly where the drag left off — since
        // firing `change` twice with an identical string is a same-value
        // no-op for the input's native value tracker. Flushed inside `act`
        // so dispatch A — chained onto `pendingCommit` — has actually
        // reached `executeUserAppAction` before the next assertion runs.
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.6500' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(1);

        // The pointer is grabbed again before A lands: this transient sample
        // opens a new gesture, which must own the display and the engine
        // from here on, not A's stale commit whenever it resolves.
        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.3' } });

        expect(setMasterGain).toHaveBeenLastCalledWith(30, true);
        expect(screen.getByTestId('fader')).toHaveValue('0.3');

        // A lands: the store settles at 65 (what A's dispatch committed),
        // but gesture B is still open and must keep owning the display and
        // the engine — dropping the token comparison snaps the fader back to
        // 0.65 here instead.
        storeMocks.useStore.mockReturnValue({ masterGain: 65 });
        storeMocks.transportStoreValue = { masterGain: 65 };
        await act(async () => {
            resolveDispatchA?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(screen.getByTestId('fader')).toHaveValue('0.3');
        expect(screen.getByTestId('level-value')).toHaveTextContent(`${formatGainDb(0.3)} dB`);
        // A's late-landing continuation re-asserts gesture B's own live
        // sample on the engine — not A's restored project truth (65).
        expect(setMasterGain).toHaveBeenLastCalledWith(30, true);

        // Settle B: its dispatch reads `expectedPercent` off the store as it
        // now stands (65, what A's commit landed), not the value that was
        // current when gesture B began.
        fader.removeAttribute('data-transient');
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.30' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenLastCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.3, expectedPercent: 65 },
        });
    });

    it('serialises settled dispatches so a later gesture always commits after an earlier one has landed', async () => {
        let resolveDispatchA: (() => void) | undefined;
        commandMocks.executeUserAppAction.mockImplementationOnce(
            () =>
                new Promise<void>((resolve) => {
                    resolveDispatchA = resolve;
                })
        );

        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');

        // Gesture A settles; dispatch A stays pending.
        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.5' } });
        fader.removeAttribute('data-transient');
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.55' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(1);

        // Gesture B settles while A is still pending — dispatching without
        // chaining onto `pendingCommit` would let this reach the use case
        // immediately instead of waiting for A's commit to land first, so
        // this flush must still observe only the one call.
        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.4' } });
        fader.removeAttribute('data-transient');
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.45' } });
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(1);

        // A lands, moving the store to 55 — B's now-unblocked dispatch has
        // to read `expectedPercent` off the store as it stands at that point.
        storeMocks.transportStoreValue = { masterGain: 55 };
        await act(async () => {
            resolveDispatchA?.();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(commandMocks.executeUserAppAction).toHaveBeenCalledTimes(2);
        expect(commandMocks.executeUserAppAction).toHaveBeenLastCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.45, expectedPercent: 55 },
        });
    });

    it('restores the engine from project truth once a settled dispatch resolves a conflict `executeUserAppAction` swallowed', async () => {
        render(<MasterChannelStrip widthClass="w-36" />);
        const fader = screen.getByTestId('fader');
        const { setMasterGain } = await import('#/modules/Transport/useCases');

        fader.setAttribute('data-transient', 'true');
        fireEvent.change(fader, { target: { value: '0.7' } });

        // Something else moves the master fader mid-gesture: by the time the
        // settle fires, both the display store and `transportStore.value`
        // (what `restoreEngineFromProjectTruth` actually reads) report 60.
        // `executeUserAppAction` resolving here stands in for it having
        // folded the resulting `AppActionConflictError` into a toast, which
        // is exactly the outcome that leaves only a `finally` to run.
        storeMocks.useStore.mockReturnValue({ masterGain: 60 });
        storeMocks.transportStoreValue = { masterGain: 60 };

        // A different value from the transient sample above — firing `change`
        // twice with an identical string is a same-value no-op for a
        // controlled input's native value tracker, so the settle event would
        // never reach `onChange` at all.
        fader.removeAttribute('data-transient');
        await act(async () => {
            fireEvent.change(fader, { target: { value: '0.75' } });
            await Promise.resolve();
        });

        // `expectedPercent` is read off the store at dispatch time, not
        // captured back when the gesture opened — so it names 60, the value
        // the store already holds by the time this settle's commit actually
        // reads it, not the 80 the store stood at when the drag began.
        expect(commandMocks.executeUserAppAction).toHaveBeenCalledWith({
            type: 'setMasterGain',
            payload: { gain: 0.75, expectedPercent: 60 },
        });
        // The engine's last word has to be the diverged store value (60), not
        // the released gesture sample (70) the transient half last wrote —
        // removing the restore call leaves the engine's last call at (70, true).
        expect(setMasterGain).toHaveBeenLastCalledWith(60, true);
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
