import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { EmptyState } from '../EmptyState';

describe('EmptyState', () => {
    it('should render message', () => {
        render(<EmptyState message="No items" />);
        expect(screen.getByText('No items')).toBeTruthy();
    });

    it('renders a different message verbatim', () => {
        render(<EmptyState message="No samples found in this folder" />);
        expect(screen.getByText('No samples found in this folder')).toBeTruthy();
    });
});
