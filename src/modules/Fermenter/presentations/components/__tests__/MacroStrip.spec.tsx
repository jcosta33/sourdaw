import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { MacroStrip } from '../MacroStrip';

describe('MacroStrip', () => {
    it('should render', () => {
        render(<MacroStrip values={DEFAULT_PATCH.macros} onChange={vi.fn()} />);
        expect(screen.getByText('Brightness')).toBeInTheDocument();
    });
});
