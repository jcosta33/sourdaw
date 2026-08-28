import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { mappingAmountDragState } from '../../../useCases/modulation/mappingAmountDragState';
import { ModulationMatrix } from '../ModulationMatrix';

type StoreValue = {
    modulators: Array<{
        id: string;
        name: string;
        kind: 'lfo' | 'envelope' | 'step';
        trackId: string;
        enabled: boolean;
        mappings: Array<{
            targetTrackId: string;
            targetDeviceId: string;
            targetParamId: string;
            amount: number;
        }>;
    }>;
};

type TrackRef = {
    id: string;
    name: string;
    devices: Array<{ id: string; name: string; type: string }>;
};

function makeModulatorWithMapping(amount: number): StoreValue['modulators'][number] {
    return {
        id: 'mod-1',
        name: 'LFO 1',
        kind: 'lfo',
        trackId: 'track-1',
        enabled: true,
        mappings: [{ targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'cutoff', amount }],
    };
}

function makeModulatorWithTwoMappings(amountA: number, amountB: number): StoreValue['modulators'][number] {
    return {
        id: 'mod-1',
        name: 'LFO 1',
        kind: 'lfo',
        trackId: 'track-1',
        enabled: true,
        mappings: [
            { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'cutoff', amount: amountA },
            { targetTrackId: 'track-1', targetDeviceId: 'device-1', targetParamId: 'resonance', amount: amountB },
        ],
    };
}

function makeTrack(id: string, name: string): TrackRef {
    return { id, name, devices: [{ id: 'device-1', name: 'Filter', type: 'mock-plugin' }] };
}

function currentAmount(paramId = 'cutoff'): number | undefined {
    return mocks.modState.modulators[0]?.mappings.find((mapping) => mapping.targetParamId === paramId)?.amount;
}

/** Captures rAF callbacks without running them, so a test decides when a frame ends. */
function stubAnimationFrame() {
    const requestAnimationFrameMock = vi.fn((): number => 101);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    return { requestAnimationFrameMock };
}

const mocks = vi.hoisted(() => {
    const modState: StoreValue = { modulators: [] };
    return {
        modState,
        trackState: { tracks: [] as TrackRef[] },
        // Real `updateMapping` runs against the fake store below; this records
        // every store write so a drag gesture can be proven to write once.
        storeSet: vi.fn<(next: StoreValue) => void>(),
        pushUndoEntry: vi.fn<(label: string, undoFn: () => void, redoFn: () => void) => void>(),
        addModulator: vi.fn<(modulator: unknown) => string>(),
    };
});

vi.mock('#/infra/store/useStore', () => ({
    useStore: (store: { __id?: string }, defaultValue: unknown) => {
        if (store.__id === 'modulation') {
            return mocks.modState;
        }
        if (store.__id === 'track') {
            return mocks.trackState;
        }
        return defaultValue;
    },
}));

vi.mock('../../../stores/modulationStore', () => ({
    modulationStore: {
        __id: 'modulation',
        get value(): StoreValue {
            return mocks.modState;
        },
        set(next: StoreValue) {
            mocks.storeSet(next);
            mocks.modState = next;
        },
    },
}));

vi.mock('#/modules/Arrangement/stores', () => ({
    trackStore: { __id: 'track' },
    defaultTrackState: { tracks: [], selectedTrackId: null },
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    getPluginById: () => ({
        parameters: [
            { id: 'cutoff', name: 'Cutoff', automatable: true, minValue: 0, maxValue: 1 },
            { id: 'resonance', name: 'Resonance', automatable: true, minValue: 0, maxValue: 1 },
        ],
    }),
}));

vi.mock('#/modules/Command/useCases', () => ({
    pushUndoEntry: mocks.pushUndoEntry,
}));

vi.mock('../../../useCases/modulation/addMapping', () => ({ addMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/addModulator', () => ({ addModulator: mocks.addModulator }));
vi.mock('../../../useCases/modulation/removeMapping', () => ({ removeMapping: vi.fn() }));
vi.mock('../../../useCases/modulation/removeModulator', () => ({ removeModulator: vi.fn() }));
vi.mock('../../../useCases/modulation/updateModulator', () => ({ updateModulator: vi.fn() }));

describe('ModulationMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.modState = { modulators: [] };
        mocks.trackState = { tracks: [] };
    });

    afterEach(() => {
        mappingAmountDragState.activeSessions.clear();
        vi.unstubAllGlobals();
    });

    it('should render without crashing', () => {
        const { container } = render(<ModulationMatrix />);
        expect(container.firstChild).not.toBeNull();
    });

    it('should render empty state when there are no modulators', () => {
        render(<ModulationMatrix />);
        expect(screen.getByText('No modulators')).toBeInTheDocument();
    });

    it('should render a card per modulator when present', () => {
        mocks.modState.modulators = [
            {
                id: 'mod-1',
                name: 'LFO 1',
                kind: 'lfo',
                trackId: 'track-1',
                enabled: true,
                mappings: [],
            },
            {
                id: 'mod-2',
                name: 'Env 1',
                kind: 'envelope',
                trackId: 'track-1',
                enabled: true,
                mappings: [],
            },
        ];
        render(<ModulationMatrix />);
        expect(screen.getByLabelText('Rename modulator mod-1')).toBeInTheDocument();
        expect(screen.getByLabelText('Rename modulator mod-2')).toBeInTheDocument();
    });

    it('should open the new modulator form on clicking New Modulator', () => {
        render(<ModulationMatrix />);
        const newButton = screen.getByRole('button', { name: /new modulator/i });
        expect(newButton).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(newButton);
        expect(newButton).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByLabelText('Modulator name')).toBeInTheDocument();
        expect(screen.getByLabelText('Modulator kind')).toBeInTheDocument();
    });

    it('should expose a region role with an accessible name', () => {
        render(<ModulationMatrix />);
        const region = screen.getByRole('region', { name: /modulation matrix/i });
        expect(region).toBeInTheDocument();
    });

    it('should coalesce an amount drag into one store write and one undo entry per gesture', () => {
        stubAnimationFrame();
        mocks.modState = { modulators: [makeModulatorWithMapping(0.2)] };
        render(<ModulationMatrix />);

        const slider = screen.getByLabelText(/Amount for /);
        fireEvent.pointerDown(slider);
        for (const value of ['0.3', '0.4', '0.5', '0.6', '0.7']) {
            fireEvent.change(slider, { target: { value } });
        }
        // Nothing is written mid-gesture: writes are coalesced per frame.
        expect(mocks.storeSet).not.toHaveBeenCalled();

        fireEvent.pointerUp(slider);

        expect(mocks.storeSet).toHaveBeenCalledTimes(1);
        expect(currentAmount()).toBe(0.7);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        const [, undo, redo] = mocks.pushUndoEntry.mock.calls[0]!;
        undo();
        expect(currentAmount()).toBe(0.2);
        redo();
        expect(currentAmount()).toBe(0.7);
    });

    it('should resync the default track selection when tracks arrive after the form opened', () => {
        const view = render(<ModulationMatrix />);
        fireEvent.click(screen.getByRole('button', { name: /new modulator/i }));

        expect(screen.getByLabelText('Modulator track scope')).toHaveValue('');
        expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

        mocks.trackState = { tracks: [makeTrack('track-1', 'Lead')] };
        view.rerender(<ModulationMatrix />);

        expect(screen.getByLabelText('Modulator track scope')).toHaveValue('track-1');
        fireEvent.click(screen.getByRole('button', { name: 'Add' }));

        expect(mocks.addModulator).toHaveBeenCalledTimes(1);
        expect(mocks.addModulator.mock.calls[0]![0]).toMatchObject({ trackId: 'track-1', kind: 'lfo' });
    });

    it('should keep a second mapping drag off the first mapping’s active session', () => {
        stubAnimationFrame();
        mocks.modState = { modulators: [makeModulatorWithTwoMappings(0.2, 0.4)] };
        mocks.trackState = { tracks: [makeTrack('track-1', 'Lead')] };
        render(<ModulationMatrix />);

        const sliderCutoff = screen.getByLabelText(/Amount for .* Cutoff$/);
        const sliderResonance = screen.getByLabelText(/Amount for .* Resonance$/);

        // Finger 1 starts dragging the cutoff slider (its session goes active).
        fireEvent.pointerDown(sliderCutoff);
        fireEvent.change(sliderCutoff, { target: { value: '0.3' } });
        // Finger 2 drags the resonance slider while cutoff's session is live.
        fireEvent.change(sliderResonance, { target: { value: '-0.5' } });

        // The resonance change committed to ITS OWN mapping synchronously…
        expect(currentAmount('resonance')).toBe(-0.5);
        // …and did not paint into the cutoff gesture: cutoff still holds its
        // own dragged amount once its own gesture ends.
        fireEvent.pointerUp(sliderCutoff);
        expect(currentAmount('cutoff')).toBe(0.3);

        // One undo entry per gesture: B's synchronous commit plus A's drag.
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(2);
    });

    it('should push the undo entry at unmount when the row disappears mid-gesture without its own pointerup', () => {
        stubAnimationFrame();
        mocks.modState = { modulators: [makeModulatorWithMapping(0.2)] };
        const view = render(<ModulationMatrix />);

        const slider = screen.getByLabelText(/Amount for /);
        fireEvent.pointerDown(slider);
        fireEvent.change(slider, { target: { value: '0.7' } });
        expect(mocks.pushUndoEntry).not.toHaveBeenCalled();

        // The row unmounts (panel closed) before any pointerup arrives.
        view.unmount();

        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);
        expect(currentAmount()).toBe(0.7);
        const [, undo] = mocks.pushUndoEntry.mock.calls[0]!;
        undo();
        expect(currentAmount()).toBe(0.2);
    });

    it('should end only the lifting pointer’s gesture when two drags run concurrently', () => {
        stubAnimationFrame();
        mocks.modState = { modulators: [makeModulatorWithTwoMappings(0.2, 0.4)] };
        mocks.trackState = { tracks: [makeTrack('track-1', 'Lead')] };
        render(<ModulationMatrix />);

        const sliderCutoff = screen.getByLabelText(/Amount for .* Cutoff$/);
        const sliderResonance = screen.getByLabelText(/Amount for .* Resonance$/);

        // Two pointers, one per mapping, both gestures live at once.
        fireEvent.pointerDown(sliderCutoff, { pointerId: 1 });
        fireEvent.change(sliderCutoff, { target: { value: '0.3' } });
        fireEvent.pointerDown(sliderResonance, { pointerId: 2 });
        fireEvent.change(sliderResonance, { target: { value: '-0.5' } });

        // Pointer 1 lifts. The window pointerup reaches BOTH watches; only
        // pointer 1's gesture may end — pointer 2's session stays live.
        fireEvent.pointerUp(sliderCutoff, { pointerId: 1 });
        expect(currentAmount('cutoff')).toBe(0.3);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        // Pointer 2's gesture still batches: its change paints, nothing commits.
        fireEvent.change(sliderResonance, { target: { value: '-0.6' } });
        expect(currentAmount('resonance')).toBe(0.4);

        fireEvent.pointerUp(sliderResonance, { pointerId: 2 });
        expect(currentAmount('resonance')).toBe(-0.6);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(2);
    });

    it('should drop the replaced gesture’s watch when a second pointer begins the same mapping', () => {
        stubAnimationFrame();
        mocks.modState = { modulators: [makeModulatorWithMapping(0.2)] };
        render(<ModulationMatrix />);

        const slider = screen.getByLabelText(/Amount for /);

        // Pointer 1 begins a gesture, then pointer 2 replaces it on the same
        // slider: the replacement commits gesture 1 and detaches its watch.
        fireEvent.pointerDown(slider, { pointerId: 1 });
        fireEvent.change(slider, { target: { value: '0.3' } });
        fireEvent.pointerDown(slider, { pointerId: 2 });
        fireEvent.change(slider, { target: { value: '0.5' } });

        // Pointer 1's stray lift must not end pointer 2's gesture: the only
        // undo entry so far is gesture 1's, committed by the replacement.
        fireEvent.pointerUp(slider, { pointerId: 1 });
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(1);

        // Pointer 2's gesture owns the session until its own lift.
        fireEvent.pointerUp(slider, { pointerId: 2 });
        expect(currentAmount()).toBe(0.5);
        expect(mocks.pushUndoEntry).toHaveBeenCalledTimes(2);
        const [, undo] = mocks.pushUndoEntry.mock.calls[1]!;
        undo();
        expect(currentAmount()).toBe(0.3);
    });
});
