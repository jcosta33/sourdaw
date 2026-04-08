import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { export function registerDeviceLayout } from './deviceLayoutRegistry';

describe('export function registerDeviceLayout', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<export function registerDeviceLayout />);
        expect(document.body).toBeTruthy();
    });
});
