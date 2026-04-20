import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPattern } from '../../../models/ArpPattern';
import { StepPatternEditor } from '../StepPatternEditor';

describe('StepPatternEditor', () => {
    it('should render', () => {
        const steps = createDefaultPattern(4);
        render(<StepPatternEditor steps={steps} currentStep={0} onStepChange={vi.fn()} onLengthChange={vi.fn()} />);
        expect(screen.getByText(/steps: 4/i)).toBeInTheDocument();
    });
});
