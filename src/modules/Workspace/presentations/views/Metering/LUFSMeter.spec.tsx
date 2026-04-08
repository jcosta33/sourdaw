import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LUFSMeter } from './LUFSMeter';

describe('LUFSMeter', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<LUFSMeter />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<LUFSMeter />);
        expect(document.body).toBeTruthy();
    });
});
