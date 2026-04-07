import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SearchSummary } from './SearchSummary';

describe('SearchSummary', () => {
    it('should pluralize results copy', () => {
        render(<SearchSummary count={3} query="pad" />);
        expect(screen.getByText('3 results for "pad"')).toBeInTheDocument();
    });

    it('should use singular for one result', () => {
        render(<SearchSummary count={1} query="bass" />);
        expect(screen.getByText('1 result for "bass"')).toBeInTheDocument();
    });
});
