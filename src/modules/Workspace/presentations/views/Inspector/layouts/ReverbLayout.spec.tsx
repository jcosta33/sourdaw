import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import {  } from './ReverbLayout';

describe('', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(< />);
        expect(document.body).toBeTruthy();
    });
});
