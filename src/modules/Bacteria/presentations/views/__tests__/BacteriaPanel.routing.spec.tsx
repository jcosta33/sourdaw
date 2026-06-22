import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { type BacteriaState } from '../../../stores/bacteriaStore';
import { BacteriaPanel } from '../BacteriaPanel';

/**
 * Guard for the K-knob write-routing fix (Bacteria inventory #6).
 *
 * Before the fix, the K knob took a stringly-typed key and, when no band
 * change handler was supplied, fell back to `setGlobalParam` with the value
 * cast to `never` — so a band parameter key had no compile-time barrier
 * keeping it out of the global write path. After splitting K into a
 * discriminated global/band union, a band key can only be driven through the
 * supplied band handler and a global key only through `setGlobalParam`.
 *
 * The type system now makes the misroute a compile error (see the band knobs
 * that no longer accept a global `deviceId` write path). These tests pin the
 * runtime half of the contract: a band knob's change reaches the *band* write
 * use-case (and never the global one), and a global knob's change reaches the
 * *global* write use-case (and never the band one).
 */

const setBacteriaParamWithAudio = vi.fn();
const setBacteriaBandParamWithAudio = vi.fn();

// Mock the two param-bridge use-cases so we can observe which write path a
// knob's onChange reaches.
vi.mock('../../../useCases/bacteriaParamBridge/setBacteriaParamWithAudio', () => ({
    setBacteriaParamWithAudio: (...args: unknown[]) => setBacteriaParamWithAudio(...args),
}));
vi.mock('../../../useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio', () => ({
    setBacteriaBandParamWithAudio: (...args: unknown[]) => setBacteriaBandParamWithAudio(...args),
}));

// Mock RotaryKnob: render a button that fires the knob's onChange with a
// sentinel value when clicked, and expose min/max as data attributes so we
// can find a specific knob by its range.
const SENTINEL_VALUE = 0.4242;
vi.mock('#/components/daw/RotaryKnob', () => ({
    RotaryKnob: ({ onChange, min, max }: { onChange: (v: number) => void; min: number; max: number }) => (
        <button type="button" data-knob data-min={min} data-max={max} onClick={() => onChange(SENTINEL_VALUE)}>
            knob
        </button>
    ),
}));

// Drive the store: return a fixed state for the panel's deviceId.
let stateForTest: BacteriaState;
vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ 'dev-1': stateForTest }),
}));

function makeState(overrides: Partial<BacteriaState>): BacteriaState {
    const patch: BacteriaPatch = { ...DEFAULT_PATCH, bands: DEFAULT_PATCH.bands.map((b) => ({ ...b })) };
    return {
        patch,
        inputDb: -100,
        outputDb: -100,
        bandLevels: [0, 0, 0, 0, 0, 0],
        latency: 0,
        activeBand: 0,
        uiLevel: 1,
        activeModule: 'distortion',
        ...overrides,
    };
}

/**
 * Find the knob button rendered next to a K knob whose label matches `label`.
 *
 * K renders its label in a span carrying the distinctive `leading-none`
 * knob-label class, so we match on that span specifically — this avoids the
 * module chip buttons and metric-cell readouts that reuse the same words.
 */
function clickKnobByLabel(label: string): void {
    const labelNodes = screen.getAllByText(label).filter((node) => node.className.includes('leading-none'));
    expect(labelNodes).toHaveLength(1);
    const stack = labelNodes[0]?.parentElement;
    expect(stack).not.toBeNull();
    const knob = stack?.querySelector('[data-knob]');
    expect(knob).not.toBeNull();
    fireEvent.click(knob as HTMLElement);
}

describe('BacteriaPanel K-knob write routing', () => {
    beforeEach(() => {
        setBacteriaParamWithAudio.mockClear();
        setBacteriaBandParamWithAudio.mockClear();
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('routes a global knob (Play-mode Input) to the global write and never the band write', () => {
        stateForTest = makeState({ uiLevel: 1 });
        render(<BacteriaPanel deviceId="dev-1" />);

        clickKnobByLabel('Input');

        expect(setBacteriaParamWithAudio).toHaveBeenCalledWith('dev-1', 'inputGain', SENTINEL_VALUE);
        expect(setBacteriaBandParamWithAudio).not.toHaveBeenCalled();
    });

    it('routes a band knob (Shape-mode Drive) to the band write and never the global write', () => {
        stateForTest = makeState({ uiLevel: 2, activeBand: 0, activeModule: 'distortion' });
        render(<BacteriaPanel deviceId="dev-1" />);

        clickKnobByLabel('Drive');

        expect(setBacteriaBandParamWithAudio).toHaveBeenCalledWith('dev-1', 0, 'drive', SENTINEL_VALUE);
        expect(setBacteriaParamWithAudio).not.toHaveBeenCalled();
    });

    it('routes the band knob to the currently active band index', () => {
        stateForTest = makeState({ uiLevel: 2, activeBand: 2, activeModule: 'distortion' });
        render(<BacteriaPanel deviceId="dev-1" />);

        clickKnobByLabel('Drive');

        expect(setBacteriaBandParamWithAudio).toHaveBeenCalledWith('dev-1', 2, 'drive', SENTINEL_VALUE);
        expect(setBacteriaParamWithAudio).not.toHaveBeenCalled();
    });
});
