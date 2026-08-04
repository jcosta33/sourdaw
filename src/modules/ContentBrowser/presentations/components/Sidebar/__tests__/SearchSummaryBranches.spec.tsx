import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SearchSummary } from '../SearchSummary';

describe('SearchSummary — pluralization', () => {
    it('renders "1 result" for singular', () => {
        render(<SearchSummary count={1} query="kick" />);
        expect(screen.getByText(/1 result for "kick"/i)).toBeInTheDocument();
    });

    it('renders "2 results" for plural', () => {
        render(<SearchSummary count={2} query="snare" />);
        expect(screen.getByText(/2 results for "snare"/i)).toBeInTheDocument();
    });

    it('renders "0 results" for zero', () => {
        render(<SearchSummary count={0} query="empty" />);
        expect(screen.getByText(/0 results for "empty"/i)).toBeInTheDocument();
    });
});

describe('SearchSummary — query text', () => {
    it('renders the query in quotes', () => {
        render(<SearchSummary count={1} query="bass" />);
        expect(screen.getByText(/"bass"/i)).toBeInTheDocument();
    });
});
