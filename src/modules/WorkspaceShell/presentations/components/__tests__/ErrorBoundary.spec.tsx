import { type ReactElement } from 'react';

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ErrorBoundary } from '../ErrorBoundary';

let shouldThrow = true;

const MaybeThrow = (): ReactElement => {
    if (shouldThrow) {
        throw new Error('unit-test failure');
    }
    return <span>recovered</span>;
};

describe('ErrorBoundary', () => {
    beforeEach(() => {
        shouldThrow = true;
        vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should render children when there is no error', () => {
        render(
            <ErrorBoundary>
                <span>ok</span>
            </ErrorBoundary>
        );
        expect(screen.getByText('ok')).toBeInTheDocument();
    });

    it('should render fallback and recover on Try Again when child stops throwing', () => {
        render(
            <ErrorBoundary>
                <MaybeThrow />
            </ErrorBoundary>
        );
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
        expect(screen.getByText('unit-test failure')).toBeInTheDocument();
        shouldThrow = false;
        fireEvent.click(screen.getByRole('button', { name: 'Try Again' }));
        expect(screen.getByText('recovered')).toBeInTheDocument();
    });

    // The boundary wraps every device panel inside a height-constrained container.
    // A viewport-tall fallback there clips Try Again / Reload App out of the panel.
    it('sizes the fallback to the container, not the viewport, in the inline variant', () => {
        render(
            <div style={{ height: '300px' }}>
                <ErrorBoundary variant="inline">
                    <MaybeThrow />
                </ErrorBoundary>
            </div>
        );

        const fallback = screen.getByText('Something went wrong').parentElement;
        expect(fallback?.style.height).toBe('100%');
        expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reload App' })).toBeInTheDocument();
    });

    it('sizes the fallback to the viewport by default', () => {
        render(
            <ErrorBoundary>
                <MaybeThrow />
            </ErrorBoundary>
        );

        expect(screen.getByText('Something went wrong').parentElement?.style.height).toBe('100vh');
    });
});
