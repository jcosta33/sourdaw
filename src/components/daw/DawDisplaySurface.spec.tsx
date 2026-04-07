import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawDisplaySurface } from './DawDisplaySurface';

describe('DawDisplaySurface', () => {
    it('should add accent border class when accentTop', () => {
        const { container } = render(<DawDisplaySurface accentTop>readout</DawDisplaySurface>);
        expect(container.firstChild).toHaveClass('border-t-[var(--color-light-edge)]');
    });
});
