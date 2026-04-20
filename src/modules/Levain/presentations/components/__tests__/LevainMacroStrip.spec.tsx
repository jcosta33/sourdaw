import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { LevainMacroStrip } from '../LevainMacroStrip';

describe('LevainMacroStrip', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(<LevainMacroStrip macros={patch.macros} labels={patch.macroLabels} onMacroChange={vi.fn()} />);
        expect(screen.getByText(patch.macroLabels[0])).toBeInTheDocument();
    });
});
