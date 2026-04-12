import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { Divider } from '../Divider';

describe('Divider', () => {
    it('should have correct ARIA attributes', () => {
        render(<Divider data-testid="divider" />);
        const element = screen.getByTestId('divider');
        expect(element).toHaveAttribute('role', 'separator');
        expect(element).toHaveAttribute('aria-orientation', 'horizontal');
    });

    describe('axis prop', () => {
        it('should default to horizontal (x) with correct classes', () => {
            render(<Divider data-testid="divider" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveClass('h-px', 'w-full');
            expect(element).toHaveAttribute('aria-orientation', 'horizontal');
        });

        it('axis="x" creates horizontal divider', () => {
            render(<Divider axis="x" data-testid="divider" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveClass('h-px', 'w-full');
            expect(element).toHaveAttribute('aria-orientation', 'horizontal');
        });

        it('should create vertical divider when axis is y', () => {
            render(<Divider axis="y" data-testid="divider" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveClass('w-px', 'h-full');
            expect(element).toHaveAttribute('aria-orientation', 'vertical');
        });
    });

    describe('tone prop', () => {
        it.each([
            ['subtle', 'bg-border/20'],
            ['default', 'bg-border/40'],
            ['strong', 'bg-border/60'],
        ] as const)('should apply tone "%s" with class %s', (tone, expectedClass) => {
            render(<Divider tone={tone} data-testid="divider" />);
            expect(screen.getByTestId('divider')).toHaveClass(expectedClass);
        });

        it('should default to default tone', () => {
            render(<Divider data-testid="divider" />);
            expect(screen.getByTestId('divider')).toHaveClass('bg-border/40');
        });
    });

    describe('spacing prop', () => {
        describe('horizontal axis (x)', () => {
            it.each([
                [0, 'mx-0'],
                [2, 'mx-2'],
                [3, 'mx-3'],
                [4, 'mx-4'],
            ] as const)('should apply spacing %i with class %s', (spacing, expectedClass) => {
                render(<Divider axis="x" spacing={spacing} data-testid="divider" />);
                expect(screen.getByTestId('divider')).toHaveClass(expectedClass);
            });
        });

        describe('vertical axis (y)', () => {
            it.each([
                [0, 'my-0'],
                [2, 'my-2'],
                [3, 'my-3'],
                [4, 'my-4'],
            ] as const)('should apply spacing %i with class %s', (spacing, expectedClass) => {
                render(<Divider axis="y" spacing={spacing} data-testid="divider" />);
                expect(screen.getByTestId('divider')).toHaveClass(expectedClass);
            });
        });

        it('should default to no spacing', () => {
            render(<Divider data-testid="divider" />);
            expect(screen.getByTestId('divider')).toHaveClass('mx-0');
        });
    });

    it('should always have shrink-0 class', () => {
        render(<Divider data-testid="divider" />);
        expect(screen.getByTestId('divider')).toHaveClass('shrink-0');
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(<Divider className="custom-class" data-testid="divider" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveClass('shrink-0', 'h-px', 'bg-border/40', 'custom-class');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(<Divider ref={ref} data-testid="divider" />);
            expect(ref.current).toBe(screen.getByTestId('divider'));
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            render(<Divider data-testid="divider" id="test-id" title="Test Title" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
        });
    });
});
