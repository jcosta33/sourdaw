import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

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
            render(
                <Grid cols={cols} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should default to 1 column', () => {
            render(<Grid data-testid="grid">Content</Grid>);
            expect(screen.getByTestId('grid')).toHaveClass('grid-cols-1');
        });
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
                <Grid gap={gap} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should not apply gap class when undefined', () => {
            render(<Grid data-testid="grid">Content</Grid>);
            const classes = screen.getByTestId('grid').className;
            expect(classes).not.toMatch(/gap-/);
        });
    });

    describe('gapX prop', () => {
        it.each([
            [0, 'gap-x-0'],
            [0.5, 'gap-x-0.5'],
            [1, 'gap-x-1'],
            [1.5, 'gap-x-1.5'],
            [2, 'gap-x-2'],
            [2.5, 'gap-x-2.5'],
            [3, 'gap-x-3'],
            [4, 'gap-x-4'],
            [6, 'gap-x-6'],
            [8, 'gap-x-8'],
        ] as const)('should apply gap-x-%i class', (gapX, expectedClass) => {
            render(
                <Grid gapX={gapX} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });
    });

    describe('gapY prop', () => {
        it.each([
            [0, 'gap-y-0'],
            [0.5, 'gap-y-0.5'],
            [1, 'gap-y-1'],
            [1.5, 'gap-y-1.5'],
            [2, 'gap-y-2'],
            [2.5, 'gap-y-2.5'],
            [3, 'gap-y-3'],
            [4, 'gap-y-4'],
            [6, 'gap-y-6'],
            [8, 'gap-y-8'],
        ] as const)('should apply gap-y-%i class', (gapY, expectedClass) => {
            render(
                <Grid gapY={gapY} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });
    });

    describe('flow prop', () => {
        it.each([
            ['row', 'grid-flow-row'],
            ['col', 'grid-flow-col'],
        ] as const)('should apply grid-flow-%s class', (flow, expectedClass) => {
            render(
                <Grid flow={flow} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid')).toHaveClass(expectedClass);
        });

        it('should not apply flow class when undefined', () => {
            render(<Grid data-testid="grid">Content</Grid>);
            const classes = screen.getByTestId('grid').className;
            expect(classes).not.toMatch(/grid-flow-/);
        });
    });

    describe('as prop', () => {
        it.each([
            ['div', 'DIV'],
            ['section', 'SECTION'],
        ] as const)('should render as %s element', (as, expectedTag) => {
            render(
                <Grid<typeof as> as={as} data-testid="grid">
                    Content
                </Grid>
            );
            expect(screen.getByTestId('grid').tagName).toBe(expectedTag);
        });

        it('should default to div', () => {
            render(<Grid data-testid="grid">Content</Grid>);
            expect(screen.getByTestId('grid').tagName).toBe('DIV');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(
                <Grid ref={ref} data-testid="grid">
                    Content
                </Grid>
            );
            expect(ref.current).toBe(screen.getByTestId('grid'));
        });

        it('should match a selected polymorphic element', () => {
            const ref = createRef<HTMLOListElement>();
            render(
                <Grid as="ol" ref={ref} data-testid="grid">
                    <li>Content</li>
                </Grid>
            );
            expect(ref.current).toBe(screen.getByTestId('grid'));
            expect(ref.current?.tagName).toBe('OL');
        });
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(
                <Grid className="custom-class" data-testid="grid">
                    Content
                </Grid>
            );
            const element = screen.getByTestId('grid');
            expect(element).toHaveClass('grid', 'grid-cols-1', 'custom-class');
        });

        it('should give a complex caller column utility precedence', () => {
            render(
                <Grid className="grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" data-testid="grid">
                    Content
                </Grid>
            );
            const element = screen.getByTestId('grid');
            expect(element).toHaveClass('grid', 'grid-cols-[minmax(0,2fr)_minmax(0,1fr)]');
            expect(element).not.toHaveClass('grid-cols-1');
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            const onClick = vi.fn();
            render(
                <Grid
                    data-testid="grid"
                    data-proof="native"
                    id="test-id"
                    title="Test Title"
                    aria-label="Test Label"
                    style={{ color: 'rgb(1, 2, 3)' }}
                    onClick={onClick}
                >
                    Content
                </Grid>
            );
            const element = screen.getByTestId('grid');
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
            <Grid data-testid="grid">
                <span>First</span>
                <span>Second</span>
                <span>Third</span>
            </Grid>
        );
        expect(Array.from(screen.getByTestId('grid').children, (child) => child.textContent)).toEqual([
            'First',
            'Second',
            'Third',
        ]);
    });
});
