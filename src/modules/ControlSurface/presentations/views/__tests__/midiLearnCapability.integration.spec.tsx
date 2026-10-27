import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let originalSourdawDescriptor: PropertyDescriptor | undefined;
let system: Awaited<ReturnType<typeof loadSystem>>;

async function loadSystem() {
    const [
        { getPlatformCapabilities },
        { midiLearnStore, defaultMidiLearnState },
        { MidiLearnButton },
        { MidiLearnRotaryKnob },
        { removeMapping },
        { MIDI_LEARN_TIMEOUT_MS },
        { injectDependencies },
    ] = await Promise.all([
        import('#/utils/platformCapabilities'),
        import('../../../stores/midiLearnStore'),
        import('../MidiLearnButton'),
        import('../MidiLearnRotaryKnob'),
        import('../../../useCases/midiLearn/removeMapping'),
        import('../../../useCases/midiLearn/startMidiLearn'),
        import('#/infra/di/testing/injectDependencies'),
    ]);
    return {
        getPlatformCapabilities,
        midiLearnStore,
        defaultMidiLearnState,
        MidiLearnButton,
        MidiLearnRotaryKnob,
        removeMapping,
        MIDI_LEARN_TIMEOUT_MS,
        injectDependencies,
    };
}

describe('real MIDI Learn entries against the cached platform route', () => {
    beforeEach(() => {
        originalSourdawDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
        vi.resetModules();
        vi.stubGlobal('navigator', {});
        Reflect.deleteProperty(window, 'sourdaw');
    });

    afterEach(() => {
        cleanup();
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        Reflect.deleteProperty(window, 'sourdaw');
        if (originalSourdawDescriptor) {
            Object.defineProperty(window, 'sourdaw', originalSourdawDescriptor);
        }
        vi.restoreAllMocks();
    });

    describe('when no browser or native MIDI route exists', () => {
        beforeEach(async () => {
            system = await loadSystem();
            vi.useFakeTimers();
        });

        it('refuses both real learn entries', () => {
            const {
                getPlatformCapabilities,
                midiLearnStore,
                defaultMidiLearnState,
                MidiLearnButton,
                MidiLearnRotaryKnob,
                MIDI_LEARN_TIMEOUT_MS,
            } = system;
            const capabilities = getPlatformCapabilities();
            expect(capabilities).toMatchObject({
                hasMidiInput: false,
                degradations: [{ feature: 'midi-input', reason: 'api-absent' }],
            });
            midiLearnStore.set(defaultMidiLearnState);
            render(<MidiLearnButton targetType="trackGain" trackId="track-1" />);
            const onChange = vi.fn();
            render(<MidiLearnRotaryKnob value={50} onChange={onChange} paramId="cutoff" aria-label="Cutoff" />);
            const before = structuredClone(midiLearnStore.value);
            const timerSpy = vi.spyOn(globalThis, 'setTimeout');
            const midiTimeoutCount = () =>
                timerSpy.mock.calls.filter(([, delay]) => delay === MIDI_LEARN_TIMEOUT_MS).length;
            const timersBefore = midiTimeoutCount();
            const reason = capabilities.degradations[0]?.message;
            expect(reason).toBeTruthy();
            const button = screen.getByRole('button', { name: `MIDI Learn. ${reason}` });
            const knob = screen.getByRole('slider', { name: 'Cutoff' });
            expect(knob).toHaveAttribute('title', reason);

            fireEvent.click(button);
            expect(midiLearnStore.value).toEqual(before);
            expect(midiTimeoutCount()).toBe(timersBefore);

            // A zero-detail click exercises the real button activation handler.
            fireEvent.click(button, { detail: 0 });
            expect(midiLearnStore.value).toEqual(before);
            expect(midiTimeoutCount()).toBe(timersBefore);

            fireEvent.contextMenu(knob);
            expect(midiLearnStore.value).toEqual(before);
            expect(midiTimeoutCount()).toBe(timersBefore);

            fireEvent.keyDown(knob, { key: 'ArrowUp' });
            expect(onChange).toHaveBeenCalledWith(50.5, false);

            vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() });
            expect(getPlatformCapabilities()).toBe(capabilities);
            fireEvent.click(button);
            fireEvent.contextMenu(knob);
            expect(midiLearnStore.value).toEqual(before);
            expect(midiTimeoutCount()).toBe(timersBefore);
        });

        it('keeps mapped identity and dispatches only the existing removal action', () => {
            const {
                getPlatformCapabilities,
                midiLearnStore,
                defaultMidiLearnState,
                MidiLearnButton,
                MidiLearnRotaryKnob,
                removeMapping,
                injectDependencies,
            } = system;
            const dispatch = vi.fn((_action: unknown) => Promise.resolve());
            injectDependencies(removeMapping, { executeUserAppAction: dispatch });
            const mappings = [
                {
                    id: 'gain-map',
                    channel: 1,
                    cc: 7,
                    targetType: 'trackGain' as const,
                    trackId: 'track-1',
                    minValue: 0,
                    maxValue: 1,
                },
                {
                    id: 'cutoff-map',
                    channel: 2,
                    cc: 74,
                    targetType: 'fermenterGlobalParam' as const,
                    paramId: 'cutoff',
                    minValue: 0,
                    maxValue: 100,
                },
            ];
            midiLearnStore.set({ ...defaultMidiLearnState, mappings });
            render(<MidiLearnButton targetType="trackGain" trackId="track-1" />);
            render(
                <MidiLearnRotaryKnob
                    value={50}
                    onChange={vi.fn()}
                    paramId="cutoff"
                    aria-label="Cutoff"
                    title="Frequency"
                />
            );
            const reason = getPlatformCapabilities().degradations[0]?.message;
            const button = screen.getByRole('button', { name: `MIDI CC 7 (ch 2). ${reason}` });
            const knob = screen.getByRole('slider', { name: 'Cutoff' });
            expect(button).toHaveTextContent('7');
            expect(knob).toHaveAttribute('title', `Frequency — ${reason}`);
            expect(knob.querySelector('.size-2.rounded-full')).toBeInTheDocument();
            const before = structuredClone(midiLearnStore.value);
            const timerBaseline = vi.getTimerCount();

            fireEvent.click(button);
            fireEvent.contextMenu(knob);
            expect(midiLearnStore.value).toEqual(before);
            expect(vi.getTimerCount()).toBe(timerBaseline);

            fireEvent.click(button, { altKey: true });
            fireEvent.contextMenu(knob, { altKey: true });
            expect(dispatch).toHaveBeenCalledTimes(2);
            expect(dispatch.mock.calls[0]?.[0]).toEqual({
                type: 'removeMidiMapping',
                payload: { mappingId: 'gain-map' },
            });
            expect(dispatch.mock.calls[1]?.[0]).toEqual({
                type: 'removeMidiMapping',
                payload: { mappingId: 'cutoff-map' },
            });
            expect(midiLearnStore.value).toEqual(before);
        });
    });

    describe.each(['browser', 'desktop'] as const)('with a real %s MIDI route', (route) => {
        beforeEach(async () => {
            if (route === 'browser') {
                vi.stubGlobal('navigator', { requestMIDIAccess: vi.fn() });
            } else {
                Object.defineProperty(window, 'sourdaw', { value: {}, configurable: true });
            }
            system = await loadSystem();
            vi.useFakeTimers();
        });

        it('allows both entries to arm and cancel', () => {
            const {
                getPlatformCapabilities,
                midiLearnStore,
                defaultMidiLearnState,
                MidiLearnButton,
                MidiLearnRotaryKnob,
            } = system;
            expect(getPlatformCapabilities()).toMatchObject({ hasMidiInput: true, degradations: [] });
            midiLearnStore.set(defaultMidiLearnState);
            render(<MidiLearnButton targetType="trackGain" trackId="track-1" />);
            render(<MidiLearnRotaryKnob value={50} onChange={vi.fn()} paramId="cutoff" aria-label="Cutoff" />);
            const timerBaseline = vi.getTimerCount();

            fireEvent.click(screen.getByRole('button', { name: 'MIDI Learn' }));
            expect(midiLearnStore.value).toMatchObject({
                isLearning: true,
                learningTarget: { targetType: 'trackGain', trackId: 'track-1' },
            });
            expect(screen.getByRole('button', { name: 'Listening for MIDI CC...' })).toHaveAttribute(
                'aria-pressed',
                'true'
            );
            expect(vi.getTimerCount()).toBe(timerBaseline + 1);

            fireEvent.click(screen.getByRole('button', { name: 'Listening for MIDI CC...' }));
            expect(midiLearnStore.value?.isLearning).toBe(false);
            fireEvent.contextMenu(screen.getByRole('slider', { name: 'Cutoff' }));
            expect(midiLearnStore.value).toMatchObject({
                isLearning: true,
                learningTarget: { targetType: 'fermenterGlobalParam', paramId: 'cutoff' },
            });
            expect(screen.getByRole('slider', { name: 'Cutoff' }).querySelector('.border-dashed')).toBeInTheDocument();
            fireEvent.contextMenu(screen.getByRole('slider', { name: 'Cutoff' }));
            expect(midiLearnStore.value?.isLearning).toBe(false);
        });
    });
});
