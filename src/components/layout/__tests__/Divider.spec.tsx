import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Divider } from '../Divider';

describe('Divider', () => {
    it('should have correct ARIA attributes', () => {
        render(<Divider data-testid="divider" />);
        const element = screen.getByTestId('divider');
        expect(element.tagName).toBe('DIV');
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

        it('should give conflicting caller utilities precedence', () => {
            render(<Divider className="shrink h-2 w-10 bg-red-500 mx-8" data-testid="divider" />);
            const element = screen.getByTestId('divider');
            expect(element).toHaveClass('shrink', 'h-2', 'w-10', 'bg-red-500', 'mx-8');
            expect(element).not.toHaveClass('shrink-0', 'h-px', 'w-full', 'bg-border/40', 'mx-0');
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
            const onClick = vi.fn();
            render(
                <Divider
                    data-testid="divider"
                    data-proof="native"
                    id="test-id"
                    title="Test Title"
                    role="presentation"
                    aria-orientation="vertical"
                    style={{ color: 'rgb(1, 2, 3)' }}
                    onClick={onClick}
                />
            );
            const element = screen.getByTestId('divider');
            fireEvent.click(element);
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('data-proof', 'native');
            expect(element).toHaveAttribute('role', 'presentation');
            expect(element).toHaveAttribute('aria-orientation', 'vertical');
            expect(element).toHaveStyle({ color: 'rgb(1, 2, 3)' });
            expect(onClick).toHaveBeenCalledOnce();
        });
    });

    it('should render children exactly once in their original order', () => {
        render(
            <Divider data-testid="divider">
                <span>First</span>
                <span>Second</span>
                <span>Third</span>
            </Divider>
        );
        expect(Array.from(screen.getByTestId('divider').children, (child) => child.textContent)).toEqual([
            'First',
            'Second',
            'Third',
        ]);
    });
});
