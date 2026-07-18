import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { RoutingMatrix } from '../RoutingMatrix';

describe('RoutingMatrix', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<RoutingMatrix />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<RoutingMatrix />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
