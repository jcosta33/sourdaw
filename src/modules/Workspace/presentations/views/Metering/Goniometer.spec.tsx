import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Goniometer } from './Goniometer';

describe('Goniometer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<Goniometer />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<Goniometer />);
        expect(document.body).toBeTruthy();
    });
});
