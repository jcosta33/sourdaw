import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MacroStrip } from '../MacroStrip';
import { DEFAULT_PATCH } from '../../../models/FermenterPatch';

describe('MacroStrip', () => {
    it('should render', () => {
        render(<MacroStrip values={DEFAULT_PATCH.macros} onChange={vi.fn()} />);
        expect(screen.getByText('Brightness')).toBeInTheDocument();
    });
});
