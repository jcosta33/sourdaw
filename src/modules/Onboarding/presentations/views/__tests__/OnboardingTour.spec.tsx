import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { OnboardingTour } from '../OnboardingTour';

const storeState = { active: true, stepIndex: 0 };

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

    it('should render nothing when onboarding is not active', () => {
        storeState.active = false;
        const { container } = render(<OnboardingTour />);
        expect(container.firstChild).toBeNull();
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
});
