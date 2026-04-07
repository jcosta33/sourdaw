import { type ReactElement } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

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
});
