import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { useGlobalKeyboardShortcuts } from '#/modules/CommandInterface/presentations/views';
import { defaultProjectStoreState, projectLoadFailureStore, projectStore } from '#/modules/Project/stores';

import { OnboardingTour } from '../OnboardingTour';

const storeState = { active: true, stepIndex: 0 };

const LAYOUT_CLASS_NAMES = new Set([
    'flex',
    'flex-row',
    'min-w-0',
    'gap-0',
    'gap-2',
    'items-center',
    'justify-between',
]);

const getTourChrome = (): { header: HTMLElement; footer: HTMLElement } => {
    const header = screen.getByText('Step 1 of 10').parentElement;
    const footer = screen.getByRole('button', { name: 'Back' }).parentElement;
    if (!(header instanceof HTMLElement) || !(footer instanceof HTMLElement)) {
        throw new Error('Expected OnboardingTour header and footer chrome');
    }
    return { header, footer };
};

const getNonLayoutClasses = (element: HTMLElement): string[] =>
    [...element.classList].filter((className) => !LAYOUT_CLASS_NAMES.has(className));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => storeState),
}));

vi.mock('../../../useCases/advanceOnboardingStep', () => ({
    advanceOnboardingStep: vi.fn(),
}));

vi.mock('../../../useCases/dismissOnboardingTour', () => ({
    dismissOnboardingTour: vi.fn(),
}));

vi.mock('../../../useCases/regressOnboardingStep', () => ({
    regressOnboardingStep: vi.fn(),
}));

describe('OnboardingTour', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        storeState.active = true;
        storeState.stepIndex = 0;
    });

    it('should render the tour dialog when the onboarding flag is active', () => {
        render(<OnboardingTour />);
        const dialog = screen.getByRole('dialog', { name: /onboarding tour/i });
        expect(dialog).toBeInTheDocument();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
    });

    it('should preserve the header and footer DOM, classes, order, and initial controls', () => {
        render(<OnboardingTour />);
        const dialog = screen.getByRole('dialog', { name: 'Onboarding tour' });
        const liveRegion = screen.getByText(/This is the transport/);
        const { header, footer } = getTourChrome();

        expect(header.tagName).toBe('DIV');
        expect(footer.tagName).toBe('DIV');
        expect(getNonLayoutClasses(header)).toEqual(['px-4', 'py-3', 'border-b', 'border-white/[0.06]']);
        expect(getNonLayoutClasses(footer)).toEqual(['px-4', 'py-3', 'border-t', 'border-white/[0.06]']);
        expect([...header.children].map((child) => child.textContent.trim())).toEqual(['Step 1 of 10', 'Skip tour']);
        expect([...footer.children].map((child) => child.textContent.trim())).toEqual(['Back', 'Next']);
        expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
        expect(dialog).toContainElement(liveRegion);
        expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('should render the header through the public Row contract', () => {
        render(<OnboardingTour />);
        const { header } = getTourChrome();
        expect(header).toHaveClass('flex-row', 'min-w-0', 'gap-0', 'items-center', 'justify-between');
    });

    it('should render the footer through the public Row contract', () => {
        render(<OnboardingTour />);
        const { footer } = getTourChrome();
        expect(footer).toHaveClass('flex-row', 'min-w-0', 'gap-2', 'items-center', 'justify-between');
    });

    it('should render nothing when onboarding is not active', () => {
        storeState.active = false;
        const { container } = render(<OnboardingTour />);
        expect(container.firstChild).toBeNull();
    });

    it('uses the visible mixer anchor when responsive controls render a hidden duplicate', () => {
        storeState.stepIndex = 3;
        const hiddenAnchor = document.createElement('button');
        hiddenAnchor.dataset.onboarding = 'mixer-button';
        hiddenAnchor.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
        const visibleAnchor = document.createElement('button');
        visibleAnchor.dataset.onboarding = 'mixer-button';
        visibleAnchor.getBoundingClientRect = () => new DOMRect(96, 16, 24, 24);
        document.body.append(hiddenAnchor, visibleAnchor);

        try {
            render(<OnboardingTour />);

            const spotlight = document.querySelector('rect[stroke="var(--color-accent-orange)"]');
            expect(spotlight).toHaveAttribute('x', '88');
            expect(spotlight).toHaveAttribute('width', '40');
        } finally {
            hiddenAnchor.remove();
            visibleAnchor.remove();
        }
    });

    it('should advance on ArrowRight', async () => {
        render(<OnboardingTour />);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        const { advanceOnboardingStep } = await import('../../../useCases/advanceOnboardingStep');
        expect(advanceOnboardingStep).toHaveBeenCalled();
    });

    it('should regress on ArrowLeft', async () => {
        render(<OnboardingTour />);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        const { regressOnboardingStep } = await import('../../../useCases/regressOnboardingStep');
        expect(regressOnboardingStep).toHaveBeenCalled();
    });

    it('should dismiss on Escape', async () => {
        render(<OnboardingTour />);
        fireEvent.keyDown(window, { key: 'Escape' });
        const { dismissOnboardingTour } = await import('../../../useCases/dismissOnboardingTour');
        expect(dismissOnboardingTour).toHaveBeenCalled();
    });

    it('should invoke the footer navigation controls', async () => {
        storeState.stepIndex = 1;
        render(<OnboardingTour />);

        fireEvent.click(screen.getByRole('button', { name: 'Back' }));
        fireEvent.click(screen.getByRole('button', { name: 'Next' }));

        const { regressOnboardingStep } = await import('../../../useCases/regressOnboardingStep');
        const { advanceOnboardingStep } = await import('../../../useCases/advanceOnboardingStep');
        expect(regressOnboardingStep).toHaveBeenCalledOnce();
        expect(advanceOnboardingStep).toHaveBeenCalledWith({ totalSteps: 10 });
    });

    it('should expose Finish and dismiss from the final step', async () => {
        storeState.stepIndex = 9;
        render(<OnboardingTour />);

        fireEvent.click(screen.getByRole('button', { name: 'Finish' }));

        const { dismissOnboardingTour } = await import('../../../useCases/dismissOnboardingTour');
        expect(dismissOnboardingTour).toHaveBeenCalledOnce();
    });

    it('should expose step description in an aria-live region', () => {
        render(<OnboardingTour />);
        const liveRegion = screen.getByText(/This is the transport/);
        expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('should call dismissOnboardingTour when Skip tour is clicked', async () => {
        render(<OnboardingTour />);
        fireEvent.click(screen.getByRole('button', { name: /skip tour/i }));
        const { dismissOnboardingTour } = await import('../../../useCases/dismissOnboardingTour');
        expect(dismissOnboardingTour).toHaveBeenCalled();
    });

    it('moves initial focus to the dialog on open, and restores focus to previously active element on dismissal', () => {
        const triggerButton = document.createElement('button');
        triggerButton.textContent = 'Trigger';
        document.body.appendChild(triggerButton);
        triggerButton.focus();
        expect(document.activeElement).toBe(triggerButton);

        storeState.active = true;
        const { rerender } = render(<OnboardingTour />);
        const dialog = screen.getByRole('dialog', { name: /onboarding tour/i });
        expect(dialog).toHaveFocus();

        storeState.active = false;
        rerender(<OnboardingTour />);
        expect(document.activeElement).toBe(triggerButton);

        triggerButton.remove();
    });

    it('wraps focus from the last button to the first on Tab, and from first to last on Shift+Tab', () => {
        storeState.stepIndex = 1;
        render(<OnboardingTour />);

        const skipButton = screen.getByRole('button', { name: /skip tour/i });
        const nextButton = screen.getByRole('button', { name: 'Next' });

        nextButton.focus();
        expect(nextButton).toHaveFocus();

        fireEvent.keyDown(window, { key: 'Tab' });
        expect(skipButton).toHaveFocus();

        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(nextButton).toHaveFocus();
    });

    it('skips disabled buttons (like Back on step 0) during Tab traversal', () => {
        storeState.stepIndex = 0;
        render(<OnboardingTour />);

        const backButton = screen.getByRole('button', { name: 'Back' });
        const skipButton = screen.getByRole('button', { name: /skip tour/i });
        const nextButton = screen.getByRole('button', { name: 'Next' });

        expect(backButton).toBeDisabled();

        skipButton.focus();
        // Tab from skipButton skips disabled backButton and focuses nextButton
        fireEvent.keyDown(window, { key: 'Tab' });
        expect(nextButton).toHaveFocus();
        expect(backButton).not.toHaveFocus();

        // Shift+Tab from nextButton skips disabled backButton and focuses skipButton
        fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
        expect(skipButton).toHaveFocus();
        expect(backButton).not.toHaveFocus();
    });

    it('proves global shortcuts do not fire actions while focus is trapped inside the tour dialog', async () => {
        const togglePlayback = vi.fn();
        registerHandlerMap({
            togglePlayback: {
                undoable: false,
                execute: togglePlayback,
                describe: () => ({ label: 'togglePlayback' }),
            },
        });
        projectLoadFailureStore.set(null);
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
        });

        const TourWithShortcuts = () => {
            useGlobalKeyboardShortcuts();
            return <OnboardingTour />;
        };

        try {
            render(<TourWithShortcuts />);
            const dialog = screen.getByRole('dialog', { name: /onboarding tour/i });
            expect(dialog).toHaveFocus();

            // Space shortcut (togglePlayback) does not fire when focus is on dialog
            fireEvent.keyDown(dialog, { key: ' ' });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(togglePlayback).not.toHaveBeenCalled();

            // Space shortcut does not fire when focus is on a button inside the dialog
            const skipButton = screen.getByRole('button', { name: /skip tour/i });
            skipButton.focus();
            fireEvent.keyDown(skipButton, { key: ' ' });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(togglePlayback).not.toHaveBeenCalled();

            // Keydown originating outside any modal surface DOES fire the global shortcut
            const outsideTarget = document.createElement('button');
            document.body.appendChild(outsideTarget);
            fireEvent.keyDown(outsideTarget, { key: ' ' });
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(togglePlayback).toHaveBeenCalledTimes(1);
            outsideTarget.remove();
        } finally {
            clearHandlerRegistry();
        }
    });
});
