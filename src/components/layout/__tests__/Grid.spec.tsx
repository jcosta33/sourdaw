import { createRef } from 'react';

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { Grid } from '../Grid';

describe('Grid', () => {
    it('should render with default grid and column classes', () => {
        render(<Grid data-testid="grid">Content</Grid>);
        const element = screen.getByTestId('grid');
        expect(element).toHaveClass('grid', 'grid-cols-1');
    });

    it('should render children', () => {
        render(
            <Grid>
                <div data-testid="child">Child Content</div>
            </Grid>
        );
        expect(screen.getByTestId('child')).toBeInTheDocument();
    });

    describe('cols prop', () => {
        it.each([
            [1, 'grid-cols-1'],
            [2, 'grid-cols-2'],
            [3, 'grid-cols-3'],
            [4, 'grid-cols-4'],
            [5, 'grid-cols-5'],
            [6, 'grid-cols-6'],
        ] as const)('should apply grid-cols-%i class', (cols, expectedClass) => {
            render(<Grid cols={cols} data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should default to 1 column', () => {
            render(<Grid data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass('grid-cols-1');
        });
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
            render(<Grid gap={gap} data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should not apply gap class when undefined', () => {
            render(<Grid data-testid="grid" />);
            const classes = screen.getByTestId('grid').className;
            expect(classes).not.toMatch(/gap-/);
        });
    });

    describe('gapX prop', () => {
        it.each([
            [0, 'gap-x-0'],
            [1, 'gap-x-1'],
            [2, 'gap-x-2'],
            [3, 'gap-x-3'],
            [4, 'gap-x-4'],
            [6, 'gap-x-6'],
            [8, 'gap-x-8'],
        ] as const)('should apply gap-x-%i class', (gapX, expectedClass) => {
            render(<Grid gapX={gapX} data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });
    });

    describe('gapY prop', () => {
        it.each([
            [0, 'gap-y-0'],
            [1, 'gap-y-1'],
            [2, 'gap-y-2'],
            [3, 'gap-y-3'],
            [4, 'gap-y-4'],
            [6, 'gap-y-6'],
            [8, 'gap-y-8'],
        ] as const)('should apply gap-y-%i class', (gapY, expectedClass) => {
            render(<Grid gapY={gapY} data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });
    });

    describe('flow prop', () => {
        it.each([
            ['row', 'grid-flow-row'],
            ['col', 'grid-flow-col'],
        ] as const)('should apply grid-flow-%s class', (flow, expectedClass) => {
            render(<Grid flow={flow} data-testid="grid" />);
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should not apply flow class when undefined', () => {
            render(<Grid data-testid="grid" />);
            const classes = screen.getByTestId('grid').className;
            expect(classes).not.toMatch(/grid-flow-/);
        });
    });

    describe('as prop', () => {
        it.each([
            ['div', 'DIV'],
            ['section', 'SECTION'],
        ] as const)('should render as %s element', (as, expectedTag) => {
            render(<Grid as={as} data-testid="grid" />);
            expect(screen.getByTestId('grid').tagName).toBe(expectedTag);
        });

        it('should default to div', () => {
            render(<Grid data-testid="grid" />);
            expect(screen.getByTestId('grid').tagName).toBe('DIV');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(<Grid ref={ref} data-testid="grid" />);
            expect(ref.current).toBe(screen.getByTestId('grid'));
        });
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(<Grid className="custom-class" data-testid="grid" />);
            const element = screen.getByTestId('grid');
            expect(element).toHaveClass('grid', 'grid-cols-1', 'custom-class');
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            render(<Grid data-testid="grid" id="test-id" title="Test Title" aria-label="Test Label" />);
            const element = screen.getByTestId('grid');
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('aria-label', 'Test Label');
        });
    });
});
