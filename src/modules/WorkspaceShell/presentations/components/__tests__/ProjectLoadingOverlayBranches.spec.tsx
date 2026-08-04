import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../SourdawLogo', () => ({
    SourdawLogo: () => <div data-testid="sourdaw-logo" />,
}));

import { ProjectLoadingOverlay } from '../ProjectLoadingOverlay';

const QUIPS = [
    'Preheating the oven...',
    'Feeding the starter...',
    'Kneading the dough...',
    'Letting it rise...',
    'Proofing the mix...',
    'Scoring the loaf...',
    'Warming up the crust...',
    'Folding in the layers...',
    'Checking the gluten structure...',
    'Dusting with flour...',
    'Shaping the boule...',
    'Adjusting oven spring...',
    'Activating the yeast...',
    'Adding a pinch of reverb...',
    'Measuring the hydration...',
    'Building the crumb...',
    'Almost golden brown...',
    'The aroma is incredible...',
];

describe('ProjectLoadingOverlay — rendering', () => {
    it('renders the Sourdaw title', () => {
        render(<ProjectLoadingOverlay />);
        expect(screen.getByText('Sourdaw')).toBeInTheDocument();
    });

    it('renders the logo', () => {
        render(<ProjectLoadingOverlay />);
        expect(screen.getByTestId('sourdaw-logo')).toBeInTheDocument();
    });
});

describe('ProjectLoadingOverlay — quip text', () => {
    it('displays a quip from the LOADING_QUIPS pool', () => {
        render(<ProjectLoadingOverlay />);
        const quipPara = document.querySelector('p[class*="animate-in"]') ?? screen.queryByText(/...$/);
        // At least one quip from the pool should be visible
        const quipText = quipPara?.textContent ?? '';
        expect(QUIPS.some((q) => quipText.includes(q))).toBe(true);
    });
});

describe('ProjectLoadingOverlay — quip rotation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('rotates to a different quip after 2500ms', () => {
        render(<ProjectLoadingOverlay />);
        const quipPara = () => document.querySelector('p[class*="animate-in"]');
        const firstQuip = quipPara()?.textContent ?? '';

        act(() => {
            vi.advanceTimersByTime(2500);
        });

        const secondQuip = quipPara()?.textContent ?? '';
        // The quip should have changed (modulo wrap — but 18 quips means 1 step won't wrap)
        expect(secondQuip).not.toBe(firstQuip);
    });
});
