import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

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
            [1, 'gap-1'],
            [2, 'gap-2'],
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
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            render(
                <Row data-testid="row" id="test-id" title="Test Title" aria-label="Test Label">
                    Content
                </Row>
            );
            const element = screen.getByTestId('row');
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('aria-label', 'Test Label');
        });
    });
});
