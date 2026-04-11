import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { Stack } from '../Stack';

describe('Stack', () => {
    it('renders with default classes', () => {
        render(<Stack data-testid="stack">Content</Stack>);
        const element = screen.getByTestId('stack');
        expect(element).toHaveClass('flex', 'flex-col', 'min-h-0');
    });

    it('renders children', () => {
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
            [1, 'gap-1'],
            [2, 'gap-2'],
            [3, 'gap-3'],
            [4, 'gap-4'],
            [6, 'gap-6'],
            [8, 'gap-8'],
        ] as const)('applies gap-%i class', (gap, expectedClass) => {
            render(<Stack gap={gap} data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });
    });

    describe('align prop', () => {
        it.each([
            ['start', 'items-start'],
            ['center', 'items-center'],
            ['end', 'items-end'],
            ['stretch', 'items-stretch'],
        ] as const)('applies %s alignment', (align, expectedClass) => {
            render(<Stack align={align} data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });

        it('defaults to stretch alignment', () => {
            render(<Stack data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass('items-stretch');
        });
    });

    describe('justify prop', () => {
        it.each([
            ['start', 'justify-start'],
            ['center', 'justify-center'],
            ['end', 'justify-end'],
            ['between', 'justify-between'],
        ] as const)('applies %s justification', (justify, expectedClass) => {
            render(<Stack justify={justify} data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass(expectedClass);
        });
    });

    describe('grow prop', () => {
        it('applies flex-1 when true', () => {
            render(<Stack grow data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass('flex-1');
        });

        it('does not apply flex-1 when false', () => {
            render(<Stack grow={false} data-testid="stack" />);
            expect(screen.getByTestId('stack')).not.toHaveClass('flex-1');
        });
    });

    describe('shrink prop', () => {
        it('does not apply shrink-0 when true (default)', () => {
            render(<Stack data-testid="stack" />);
            expect(screen.getByTestId('stack')).not.toHaveClass('shrink-0');
        });

        it('applies shrink-0 when false', () => {
            render(<Stack shrink={false} data-testid="stack" />);
            expect(screen.getByTestId('stack')).toHaveClass('shrink-0');
        });
    });

    describe('wrap prop', () => {
        it('applies flex-wrap when true', () => {
            render(<Stack wrap data-testid="stack" />);
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
        ] as const)('renders as %s element', (as, expectedTag) => {
            render(<Stack as={as} data-testid="stack" />);
            expect(screen.getByTestId('stack').tagName).toBe(expectedTag);
        });

        it('defaults to div', () => {
            render(<Stack data-testid="stack" />);
            expect(screen.getByTestId('stack').tagName).toBe('DIV');
        });
    });

    describe('ref forwarding', () => {
        it('forwards ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(<Stack ref={ref} data-testid="stack" />);
            expect(ref.current).toBe(screen.getByTestId('stack'));
        });
    });

    describe('className merging', () => {
        it('merges custom className with default classes', () => {
            render(<Stack className="custom-class" data-testid="stack" />);
            const element = screen.getByTestId('stack');
            expect(element).toHaveClass('flex', 'flex-col', 'custom-class');
        });
    });

    describe('HTML attributes', () => {
        it('passes through arbitrary HTML attributes', () => {
            render(<Stack data-testid="stack" id="test-id" title="Test Title" aria-label="Test Label" />);
            const element = screen.getByTestId('stack');
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('aria-label', 'Test Label');
        });
    });
});
