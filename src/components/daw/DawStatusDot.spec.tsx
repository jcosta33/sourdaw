import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawStatusDot, getDawStatusDotClassName } from './DawStatusDot';

describe('DawStatusDot', () => {
    it('should render with tone classes', () => {
        const { container } = render(<DawStatusDot tone="success" />);
        expect(container.firstChild).toHaveClass('bg-[var(--color-state-success)]');
    });

    it('should add pulse class when pulse is true', () => {
        const { container } = render(<DawStatusDot pulse />);
        expect(container.firstChild).toHaveClass('animate-pulse');
    });
});

describe('getDawStatusDotClassName', () => {
    it('should return merged class string for tone and pulse', () => {
        expect(getDawStatusDotClassName({ tone: 'cyan', pulse: true })).toContain('animate-pulse');
        expect(getDawStatusDotClassName({ tone: 'cyan', pulse: true })).toContain('bg-[var(--color-accent-cyan)]');
    });
});
