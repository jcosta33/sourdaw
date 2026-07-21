import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Row } from '../Row';

describe('Row', () => {
    it('should render with default flex row, gap, alignment, and justification classes', () => {
        render(<Row data-testid="row">Content</Row>);
        const element = screen.getByTestId('row');
        expect(element).toHaveClass('flex', 'flex-row', 'min-w-0', 'gap-0', 'items-center', 'justify-start');
    });

    it('should render children', () => {
        render(
            <Row>
                <span data-testid="child">Child</span>
            </Row>
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
                <Row gap={gap} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass(expectedClass);
        });
    });

    describe('align prop', () => {
        it.each([
            ['start', 'items-start'],
            ['center', 'items-center'],
            ['end', 'items-end'],
            ['stretch', 'items-stretch'],
            ['baseline', 'items-baseline'],
        ] as const)('should apply %s alignment', (align, expectedClass) => {
            render(
                <Row align={align} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass(expectedClass);
        });

        it('should default to center alignment', () => {
            render(<Row data-testid="row">Content</Row>);
            expect(screen.getByTestId('row')).toHaveClass('items-center');
        });
    });

    describe('justify prop', () => {
        it.each([
            ['start', 'justify-start'],
            ['center', 'justify-center'],
            ['end', 'justify-end'],
            ['between', 'justify-between'],
            ['around', 'justify-around'],
            ['evenly', 'justify-evenly'],
        ] as const)('should apply %s justification', (justify, expectedClass) => {
            render(
                <Row justify={justify} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass(expectedClass);
        });
    });

    describe('grow prop', () => {
        it('should apply flex-1 when true', () => {
            render(
                <Row grow data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass('flex-1');
        });

        it('should not apply flex-1 when false', () => {
            render(
                <Row grow={false} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).not.toHaveClass('flex-1');
        });
    });

    describe('shrink prop', () => {
        it('should not apply shrink-0 when shrink is true (default)', () => {
            render(<Row data-testid="row">Content</Row>);
            expect(screen.getByTestId('row')).not.toHaveClass('shrink-0');
        });

        it('should apply shrink-0 when shrink is false', () => {
            render(
                <Row shrink={false} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass('shrink-0');
        });
    });

    describe('wrap prop', () => {
        it('should apply flex-wrap when true', () => {
            render(
                <Row wrap data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).toHaveClass('flex-wrap');
        });

        it('should not apply flex-wrap when false', () => {
            render(
                <Row wrap={false} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row')).not.toHaveClass('flex-wrap');
        });
    });

    describe('as prop', () => {
        it.each([
            ['div', 'DIV'],
            ['span', 'SPAN'],
        ] as const)('should render as %s element', (as, expectedTag) => {
            render(
                <Row<typeof as> as={as} data-testid="row">
                    Content
                </Row>
            );
            expect(screen.getByTestId('row').tagName).toBe(expectedTag);
        });

        it('should default to div', () => {
            render(<Row data-testid="row">Content</Row>);
            expect(screen.getByTestId('row').tagName).toBe('DIV');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(
                <Row ref={ref} data-testid="row">
                    Content
                </Row>
            );
            expect(ref.current).toBe(screen.getByTestId('row'));
        });

        it('should match a selected polymorphic element', () => {
            const ref = createRef<HTMLUListElement>();
            render(
                <Row as="ul" ref={ref} data-testid="row">
                    <li>Content</li>
                </Row>
            );
            expect(ref.current).toBe(screen.getByTestId('row'));
            expect(ref.current?.tagName).toBe('UL');
        });
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(
                <Row className="custom-class" data-testid="row">
                    Content
                </Row>
            );
            const element = screen.getByTestId('row');
            expect(element).toHaveClass('flex', 'items-center', 'custom-class');
        });

        it('should give conflicting caller utilities precedence', () => {
            render(
                <Row className="flex-col min-w-full gap-8 items-end justify-between" data-testid="row">
                    Content
                </Row>
            );
            const element = screen.getByTestId('row');
            expect(element).toHaveClass('flex-col', 'min-w-full', 'gap-8', 'items-end', 'justify-between');
            expect(element).not.toHaveClass('flex-row', 'min-w-0', 'gap-0', 'items-center', 'justify-start');
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            const onClick = vi.fn();
            render(
                <Row
                    data-testid="row"
                    data-proof="native"
                    id="test-id"
                    title="Test Title"
                    aria-label="Test Label"
                    style={{ color: 'rgb(1, 2, 3)' }}
                    onClick={onClick}
                >
                    Content
                </Row>
            );
            const element = screen.getByTestId('row');
            fireEvent.click(element);
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('aria-label', 'Test Label');
            expect(element).toHaveAttribute('data-proof', 'native');
            expect(element).toHaveStyle({ color: 'rgb(1, 2, 3)' });
            expect(onClick).toHaveBeenCalledOnce();
        });
    });

    it('should render children exactly once in their original order', () => {
        render(
            <Row data-testid="row">
                <span>First</span>
                <span>Second</span>
                <span>Third</span>
            </Row>
        );
        expect(Array.from(screen.getByTestId('row').children, (child) => child.textContent)).toEqual([
            'First',
            'Second',
            'Third',
        ]);
    });
});
