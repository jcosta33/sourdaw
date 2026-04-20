import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SectionHeader } from '../SectionHeader';

describe('SectionHeader', () => {
    it('should render divider label', () => {
        render(<SectionHeader label="Library" />);
        expect(screen.getByText('Library')).toBeInTheDocument();
    });
});
