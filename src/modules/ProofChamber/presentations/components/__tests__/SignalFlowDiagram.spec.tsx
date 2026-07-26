import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { type ProofChamberAlgorithm } from '../../../models/ProofChamberState';
import { SignalFlowDiagram } from '../SignalFlowDiagram';

function labelsFor(algorithm: ProofChamberAlgorithm): string[] {
    const { container } = render(
        <SignalFlowDiagram algorithm={algorithm} shimmerEnabled={false} freezeEnabled={false} />
    );
    return [...container.querySelectorAll('svg text')].map((node) => node.textContent ?? '');
}

describe('SignalFlowDiagram', () => {
    it('should render', () => {
        const { container } = render(
            <SignalFlowDiagram algorithm="plate" shimmerEnabled={false} freezeEnabled={false} />
        );
        expect(container.querySelector('svg')).toBeTruthy();
    });

    /**
     * Every algorithm the selector offers needs its own topology. The switch in
     * `getFlowForAlgorithm` falls through to an empty diagram, so an algorithm
     * added to the union without a case there renders a blank frame instead of
     * failing — which is why this asserts the stages by name.
     */
    it('draws the reverse buffer stages rather than falling through to an empty diagram', () => {
        const labels = labelsFor('reverse');

        expect(labels).toContain('Reverse Buf');
        expect(labels).toContain('Grain Flip');
        expect(labels).toContain('Hann Fade');
        expect(labels).toContain('Stereo Out');
    });

    it('gives reverse a different topology from the plate it would otherwise duplicate', () => {
        const plate = labelsFor('plate');
        const reverse = labelsFor('reverse');

        expect(reverse).not.toEqual(plate);
        expect(reverse).not.toContain('4× Diffuser');
        expect(plate).not.toContain('Reverse Buf');
    });
});
