import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH, type BacteriaConvolutionIr, type BacteriaPatch } from '../../../models/BacteriaPatch';
import { bacteriaStore, type BacteriaState } from '../../../stores/bacteriaStore';
import { BacteriaPanel } from '../BacteriaPanel';

/**
 * The Body module's picker: the bodies a band can convolve with, the one it
 * has, and the write a choice makes.
 */

const chooseBacteriaBodyWithAudio = vi.fn();
const setBacteriaBandParamWithAudio = vi.fn();

vi.mock('../../../useCases/bacteriaParamBridge/chooseBacteriaBodyWithAudio', () => ({
    chooseBacteriaBodyWithAudio: (...args: unknown[]) => chooseBacteriaBodyWithAudio(...args),
}));
vi.mock('../../../useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio', () => ({
    setBacteriaBandParamWithAudio: (...args: unknown[]) => setBacteriaBandParamWithAudio(...args),
}));

// The panel reads the bacteria instances and the project track state its
// hydration follows. Honour each call's own store default; the panel falls
// back to `getBacteriaState(deviceId)`, which reads the real store directly.
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: unknown) => defaultValue),
}));

function shapeStateWithBody(activeBand: number, body: BacteriaConvolutionIr): BacteriaState {
    const patch: BacteriaPatch = {
        ...DEFAULT_PATCH,
        bands: DEFAULT_PATCH.bands.map((band, index) => ({
            ...band,
            convolutionIr: index === activeBand ? body : band.convolutionIr,
        })),
    };
    return {
        patch,
        inputDb: -100,
        outputDb: -100,
        bandLevels: [0, 0, 0, 0, 0, 0],
        latency: 0,
        activeBand,
        uiLevel: 2,
        activeModule: 'convolution',
    };
}

function bodyPicker(): HTMLElement {
    return screen.getByRole('group', { name: 'Body' });
}

describe('BacteriaPanel Body picker', () => {
    afterEach(() => {
        vi.clearAllMocks();
        bacteriaStore.set({});
    });

    it('offers None and every built-in body, and marks the band’s current one', () => {
        bacteriaStore.set({ 'dev-1': shapeStateWithBody(0, 'wood') });
        render(<BacteriaPanel deviceId="dev-1" />);

        const choices = within(bodyPicker()).getAllByRole('button');
        expect(choices.map((choice) => choice.textContent)).toEqual(['None', 'Ceramic', 'Wood', 'Metal', 'Spring']);
        expect(
            choices.filter((choice) => choice.getAttribute('aria-pressed') === 'true').map((c) => c.textContent)
        ).toEqual(['Wood']);
    });

    it('shows None for a band that has never had a body chosen', () => {
        bacteriaStore.set({ 'dev-1': shapeStateWithBody(0, '') });
        render(<BacteriaPanel deviceId="dev-1" />);

        expect(within(bodyPicker()).getByRole('button', { name: 'None' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('commits a choice for the active band through the body use case', () => {
        bacteriaStore.set({ 'dev-1': shapeStateWithBody(2, '') });
        render(<BacteriaPanel deviceId="dev-1" />);

        fireEvent.click(within(bodyPicker()).getByRole('button', { name: 'Metal' }));
        fireEvent.click(within(bodyPicker()).getByRole('button', { name: 'None' }));

        expect(chooseBacteriaBodyWithAudio.mock.calls).toEqual([
            ['dev-1', 2, 'metal'],
            ['dev-1', 2, ''],
        ]);
        expect(setBacteriaBandParamWithAudio).not.toHaveBeenCalled();
    });
});
