import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { IrBrowser } from '../IrBrowser';

describe('IrBrowser', () => {
    it('should render', () => {
        render(<IrBrowser onIrLoaded={vi.fn()} />);
        expect(screen.getByText(/drop wav/i)).toBeInTheDocument();
    });
});
