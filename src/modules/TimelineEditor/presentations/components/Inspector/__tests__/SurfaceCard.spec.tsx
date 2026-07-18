import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { SurfaceCard } from '../SurfaceCard';

describe('SurfaceCard', () => {
    it('should render children', () => {
        render(<SurfaceCard>Card body</SurfaceCard>);
        expect(screen.getByText('Card body')).toBeInTheDocument();
    });
});
