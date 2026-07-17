import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { CaptureKeyButton } from '../CaptureKeyButton';

describe('CaptureKeyButton', () => {
    it('should render children', () => {
        render(<CaptureKeyButton>Key A</CaptureKeyButton>);
        expect(screen.getByRole('button', { name: 'Key A' })).toBeInTheDocument();
    });

    it('should apply listening styles when listening', () => {
        render(
            <CaptureKeyButton listening data-testid="cap">
                Rec
            </CaptureKeyButton>
        );
        expect(screen.getByTestId('cap')).toHaveClass('animate-pulse');
    });
});
