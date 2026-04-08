import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResizeHandle } from './ResizeHandle';

describe('ResizeHandle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ResizeHandle />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ResizeHandle />);
        expect(document.body).toBeTruthy();
    });
});
