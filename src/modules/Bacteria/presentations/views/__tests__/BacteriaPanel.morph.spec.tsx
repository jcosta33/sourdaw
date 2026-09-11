import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { type BacteriaState } from '../../../stores/bacteriaStore';
import { BacteriaPanel } from '../BacteriaPanel';

/**
 * The morph pad's panel wiring: a pad drag reports one (x, y) position into
 * the morph use case, and each corner's capture chip captures into its own
 * corner index. Both are use-case calls from the panel — the component never
 * writes the store or the engine directly.
 */

const applyBacteriaMorphWithAudio = vi.fn();
const captureBacteriaSnapshot = vi.fn();

vi.mock('../../../useCases/bacteriaParamBridge/applyBacteriaMorph', () => ({
    applyBacteriaMorphWithAudio: (...args: unknown[]) => applyBacteriaMorphWithAudio(...args),
}));
vi.mock('../../../useCases/bacteriaParamBridge/captureBacteriaSnapshot', () => ({
    captureBacteriaSnapshot: (...args: unknown[]) => captureBacteriaSnapshot(...args),
}));

// The real pad measures its box; the gesture under test is the wiring, so a
// stub that reports one position stands in for it.
vi.mock('../../components/XYMorphPad', () => ({
    XYMorphPad: ({ onChange }: { onChange: (x: number, y: number) => void }) => (
        <button type="button" data-morph-pad onClick={() => onChange(0.25, 0.75)}>
            morph pad
        </button>
    ),
}));

vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ onChange }: { onChange: (v: number) => void }) => (
        <button type="button" data-knob onClick={() => onChange(0.4242)}>
            knob
        </button>
    ),
}));

let stateForTest: BacteriaState;
vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ 'dev-1': stateForTest }),
}));

function makeState(): BacteriaState {
    const patch: BacteriaPatch = { ...DEFAULT_PATCH, bands: DEFAULT_PATCH.bands.map((band) => ({ ...band })) };
    return {
        patch,
        inputDb: -100,
        outputDb: -100,
        bandLevels: [0, 0, 0, 0, 0, 0],
        latency: 0,
        activeBand: 0,
        uiLevel: 1,
        activeModule: 'distortion',
    };
}

describe('BacteriaPanel morph wiring', () => {
    beforeEach(() => {
        applyBacteriaMorphWithAudio.mockClear();
        captureBacteriaSnapshot.mockClear();
    });

    it('routes a pad gesture to the morph use case as one (x, y) position', () => {
        stateForTest = makeState();
        render(<BacteriaPanel deviceId="dev-1" />);

        fireEvent.click(screen.getByText('morph pad'));

        expect(applyBacteriaMorphWithAudio).toHaveBeenCalledWith('dev-1', 0.25, 0.75);
        expect(captureBacteriaSnapshot).not.toHaveBeenCalled();
    });

    it('routes each corner capture chip to its own corner index', () => {
        stateForTest = makeState();
        render(<BacteriaPanel deviceId="dev-1" />);

        fireEvent.click(screen.getByRole('button', { name: 'Capture snapshot A' }));
        expect(captureBacteriaSnapshot).toHaveBeenLastCalledWith('dev-1', 0);

        fireEvent.click(screen.getByRole('button', { name: 'Capture snapshot D' }));
        expect(captureBacteriaSnapshot).toHaveBeenLastCalledWith('dev-1', 3);
        expect(applyBacteriaMorphWithAudio).not.toHaveBeenCalled();
    });
});
