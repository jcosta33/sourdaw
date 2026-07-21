import { createRef } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { Spacer } from '../Spacer';

describe('Spacer', () => {
    it('should set aria-hidden for accessibility', () => {
        render(<Spacer size={2} data-testid="spacer" />);
        const element = screen.getByTestId('spacer');
        expect(element.tagName).toBe('DIV');
        expect(element).toHaveAttribute('aria-hidden', 'true');
    });

    describe('size prop', () => {
        it.each([
            [0, 'w-0', 'h-0'],
            [1, 'w-1', 'h-1'],
            [2, 'w-2', 'h-2'],
            [3, 'w-3', 'h-3'],
            [4, 'w-4', 'h-4'],
            [6, 'w-6', 'h-6'],
            [8, 'w-8', 'h-8'],
            [12, 'w-12', 'h-12'],
            [16, 'w-16', 'h-16'],
        ] as const)('should apply size %i with both width and height classes', (size, widthClass, heightClass) => {
            render(<Spacer size={size} data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass(widthClass, heightClass);
        });
    });

    describe('axis prop', () => {
        it('axis="x" applies only width class', () => {
            render(<Spacer size={4} axis="x" data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass('w-4');
            expect(element).not.toHaveClass('h-4');
        });

        it('should apply only height class when axis is y', () => {
            render(<Spacer size={4} axis="y" data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass('h-4');
            expect(element).not.toHaveClass('w-4');
        });

        it('should default to both axes when axis is not specified', () => {
            render(<Spacer size={4} data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass('w-4', 'h-4');
        });
    });

    describe('axis size combinations', () => {
        it.each([
            [0, 'x', 'w-0'],
            [0, 'y', 'h-0'],
            [1, 'x', 'w-1'],
            [2, 'y', 'h-2'],
            [8, 'x', 'w-8'],
            [16, 'y', 'h-16'],
        ] as const)('should apply size %i with axis "%s" and class %s', (size, axis, expectedClass) => {
            render(<Spacer size={size} axis={axis} data-testid="spacer" />);
            expect(screen.getByTestId('spacer')).toHaveClass(expectedClass);
        });
    });

    it('should always have shrink-0 class', () => {
        render(<Spacer size={2} data-testid="spacer" />);
        expect(screen.getByTestId('spacer')).toHaveClass('shrink-0');
    });

    describe('className merging', () => {
        it('should merge custom className with default classes', () => {
            render(<Spacer size={2} className="custom-class" data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass('shrink-0', 'w-2', 'h-2', 'custom-class');
        });

        it('should give conflicting caller utilities precedence', () => {
            render(<Spacer size={2} className="shrink w-10 h-10" data-testid="spacer" />);
            const element = screen.getByTestId('spacer');
            expect(element).toHaveClass('shrink', 'w-10', 'h-10');
            expect(element).not.toHaveClass('shrink-0', 'w-2', 'h-2');
        });
    });

    describe('ref forwarding', () => {
        it('should forward ref to the element', () => {
            const ref = createRef<HTMLDivElement>();
            render(<Spacer size={2} ref={ref} data-testid="spacer" />);
            expect(ref.current).toBe(screen.getByTestId('spacer'));
        });
    });

    describe('HTML attributes', () => {
        it('should pass through arbitrary HTML attributes', () => {
            const onClick = vi.fn();
            render(
                <Spacer
                    size={2}
                    data-testid="spacer"
                    data-proof="native"
                    id="test-id"
                    title="Test Title"
                    aria-hidden="false"
                    style={{ color: 'rgb(1, 2, 3)' }}
                    onClick={onClick}
                />
            );
            const element = screen.getByTestId('spacer');
            fireEvent.click(element);
            expect(element).toHaveAttribute('id', 'test-id');
            expect(element).toHaveAttribute('title', 'Test Title');
            expect(element).toHaveAttribute('data-proof', 'native');
            expect(element).toHaveAttribute('aria-hidden', 'false');
            expect(element).toHaveStyle({ color: 'rgb(1, 2, 3)' });
            expect(onClick).toHaveBeenCalledOnce();
        });
    });

    it('should render children exactly once in their original order', () => {
        render(
            <Spacer size={0} data-testid="spacer">
                <span>First</span>
                <span>Second</span>
                <span>Third</span>
            </Spacer>
        );
        expect(Array.from(screen.getByTestId('spacer').children, (child) => child.textContent)).toEqual([
            'First',
            'Second',
            'Third',
        ]);
    });
});
