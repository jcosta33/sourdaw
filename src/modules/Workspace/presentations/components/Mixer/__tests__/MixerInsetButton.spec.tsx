import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { MixerInsetButton } from '../MixerInsetButton';

describe('MixerInsetButton', () => {
    it('should render children', () => {
        render(<MixerInsetButton>Send</MixerInsetButton>);
        expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('should support accent tone', () => {
        render(
            <MixerInsetButton tone="accent" data-testid="btn">
                A
            </MixerInsetButton>
        );
        expect(screen.getByTestId('btn')).toHaveClass('border-[var(--color-accent-lavender)]/20');
    });
});
