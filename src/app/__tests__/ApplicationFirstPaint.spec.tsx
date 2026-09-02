import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ApplicationFirstPaint } from '../ApplicationFirstPaint';

describe('ApplicationFirstPaint', () => {
    it('exposes the app-shell marker at viewport size before the full application loads', () => {
        render(<ApplicationFirstPaint />);

        const shell = screen.getByTestId('app-shell');
        expect(shell).toHaveClass('h-screen', 'w-screen', 'overflow-hidden', 'bg-surface-app');
    });
});
