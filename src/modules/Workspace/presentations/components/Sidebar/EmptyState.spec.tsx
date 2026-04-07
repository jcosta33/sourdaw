import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
    it('should render message', () => {
        render(<EmptyState message="No items" />);
        expect(screen.getByText('No items')).toBeInTheDocument();
    });
});
