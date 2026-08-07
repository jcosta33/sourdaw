import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { type ProofChamberAlgorithm } from '../../../models/ProofChamberState';
import { SignalFlowDiagram } from '../SignalFlowDiagram';

function labelsFor(algorithm: ProofChamberAlgorithm, shimmer = false, freeze = false): string[] {
    const { container } = render(
        <SignalFlowDiagram algorithm={algorithm} shimmerEnabled={shimmer} freezeEnabled={freeze} />
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

describe('SignalFlowDiagram — shimmer and freeze conditionals', () => {
    it('does not include Shimmer node when shimmerEnabled is false', () => {
        const labels = labelsFor('plate', false, false);
        expect(labels).not.toContain('Shimmer');
    });

    it('includes Shimmer node when shimmerEnabled is true', () => {
        const labels = labelsFor('plate', true, false);
        expect(labels).toContain('Shimmer');
    });

    it('includes Input node regardless of freeze state', () => {
        const labels = labelsFor('plate', false, true);
        expect(labels).toContain('Input');
    });
});

describe('SignalFlowDiagram — FDN algorithm distinction', () => {
    it('shows FDN-8 label for fdn-8 algorithm', () => {
        const labels = labelsFor('fdn-8');
        expect(labels).toContain('FDN-8');
    });

    it('shows FDN-16 label for fdn-16 algorithm', () => {
        const labels = labelsFor('fdn-16');
        expect(labels).toContain('FDN-16');
    });

    it('does not show FDN-8 label when fdn-16 is selected', () => {
        const labels = labelsFor('fdn-16');
        expect(labels).not.toContain('FDN-8');
    });
});
