import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { StepSequencerEditor } from './StepSequencerEditor';

describe('StepSequencerEditor', () => {
    it('should render', () => {
        const { container } = render(
            <StepSequencerEditor
                width={200}
                height={48}
                steps={Array.from({ length: 8 }, () => 0.5)}
                numSteps={8}
                onStepsChange={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
