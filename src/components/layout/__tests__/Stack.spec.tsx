import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Stack } from '../Stack';

describe('Stack', () => {
    it('should render with default flex column, gap, alignment, and justification classes', () => {
        render(<Stack data-testid="stack">Content</Stack>);
        const element = screen.getByTestId('stack');
        expect(element).toHaveClass('flex', 'flex-col', 'min-h-0', 'gap-0', 'items-stretch', 'justify-start');
    });

    it('should render children', () => {
        render(
            <Stack>
                <div data-testid="child">Child Content</div>
            </Stack>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    describe('gap prop', () => {
        it.each([
            [0, 'gap-0'],
            [0.5, 'gap-0.5'],
            [1, 'gap-1'],
            [1.5, 'gap-1.5'],
            [2, 'gap-2'],
            [2.5, 'gap-2.5'],
            [3, 'gap-3'],
            [4, 'gap-4'],
            [6, 'gap-6'],
            [8, 'gap-8'],
        ] as const)('should apply gap-%i class', (gap, expectedClass) => {
            render(
                <Stack gap={gap} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });
    });

    describe('align prop', () => {
        it.each([
            ['start', 'items-start'],
            ['center', 'items-center'],
            ['end', 'items-end'],
            ['stretch', 'items-stretch'],
        ] as const)('should apply %s alignment', (align, expectedClass) => {
            render(
                <Stack align={align} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });

        it('should default to stretch alignment', () => {
            render(<Stack data-testid="stack">Content</Stack>);
            expect(screen.getByTestId('stack')).toHaveClass('items-stretch');
        });
    });

    describe('justify prop', () => {
        it.each([
            ['start', 'justify-start'],
            ['center', 'justify-center'],
            ['end', 'justify-end'],
            ['between', 'justify-between'],
        ] as const)('should apply %s justification', (justify, expectedClass) => {
            render(
                <Stack justify={justify} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });
    });

    describe('grow prop', () => {
        it('should apply flex-1 when true', () => {
            render(
                <Stack grow data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass('flex-1');
        });

        it('should not apply flex-1 when false', () => {
            render(
                <Stack grow={false} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).not.toHaveClass('flex-1');
        });
    });

    describe('shrink prop', () => {
        it('should not apply shrink-0 when shrink is true (default)', () => {
            render(<Stack data-testid="stack">Content</Stack>);
            expect(screen.getByTestId('stack')).not.toHaveClass('shrink-0');
        });

        it('should apply shrink-0 when shrink is false', () => {
            render(
                <Stack shrink={false} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass('shrink-0');
        });
    });

    describe('wrap prop', () => {
        it('should apply flex-wrap when true', () => {
            render(
                <Stack wrap data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveClass('flex-wrap');
        });
    });

    describe('as prop', () => {
        it.each([
            ['div', 'DIV'],
            ['section', 'SECTION'],
            ['article', 'ARTICLE'],
            ['aside', 'ASIDE'],
            ['header', 'HEADER'],
            ['footer', 'FOOTER'],
            ['main', 'MAIN'],
            ['nav', 'NAV'],
        ] as const)('should render as %s element', (as, expectedTag) => {
            render(
                <Stack<typeof as> as={as} data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack').tagName).toBe(expectedTag);
        });

        it('should default to div', () => {
            render(<Stack data-testid="stack">Content</Stack>);
            expect(screen.getByTestId('stack').tagName).toBe('DIV');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(
                <Stack ref={ref} data-testid="stack">
                    Content
                </Stack>
            );
            expect(ref.current).toBe(screen.getByTestId('stack'));
        });

        it('should match a selected polymorphic element', () => {
            const ref = createRef<HTMLElement>();
            render(
                <Stack as="section" ref={ref} data-testid="stack">
                    Content
                </Stack>
            );
            expect(ref.current).toBe(screen.getByTestId('stack'));
            expect(ref.current?.tagName).toBe('SECTION');
        });
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(
                <Stack className="custom-class" data-testid="stack">
                    Content
                </Stack>
            );
            const element = screen.getByTestId('stack');
            expect(element).toHaveClass('flex', 'flex-col', 'custom-class');
        });

        it('should give conflicting caller utilities precedence', () => {
            render(
                <Stack className="flex-row min-h-full gap-8 items-center justify-end" data-testid="stack">
                    Content
                </Stack>
            );
            const element = screen.getByTestId('stack');
            expect(element).toHaveClass('flex-row', 'min-h-full', 'gap-8', 'items-center', 'justify-end');
            expect(element).not.toHaveClass('flex-col', 'min-h-0', 'gap-0', 'items-stretch', 'justify-start');
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            const onClick = vi.fn();
            render(
                <Stack
                    data-testid="stack"
                    data-proof="native"
                    id="test-id"
                    title="Test Title"
                    aria-label="Test Label"
                    style={{ color: 'rgb(1, 2, 3)' }}
                    onClick={onClick}
                >
                    Content
                </Stack>
            );
            const element = screen.getByTestId('stack');
            fireEvent.click(element);
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('aria-label', 'Test Label');
            expect(element).toHaveAttribute('data-proof', 'native');
            expect(element).toHaveStyle({ color: 'rgb(1, 2, 3)' });
            expect(onClick).toHaveBeenCalledOnce();
        });

        it('should preserve element-specific attributes', () => {
            render(
                <Stack as="button" type="button" disabled data-testid="stack">
                    Content
                </Stack>
            );
            expect(screen.getByTestId('stack')).toHaveAttribute('type', 'button');
            expect(screen.getByTestId('stack')).toBeDisabled();
        });
    });

    it('should render children exactly once in their original order', () => {
        render(
            <Stack data-testid="stack">
                <span>First</span>
                <span>Second</span>
                <span>Third</span>
            </Stack>
        );
        expect(Array.from(screen.getByTestId('stack').children, (child) => child.textContent)).toEqual([
            'First',
            'Second',
            'Third',
        ]);
    });
});
