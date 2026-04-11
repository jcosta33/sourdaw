import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DawSideRail } from '../DawSideRail';

describe('DawSideRail', () => {
    it('should render children', () => {
        render(<DawSideRail>nav</DawSideRail>);
        expect(screen.getByText('nav')).toBeInTheDocument();
    });
});
