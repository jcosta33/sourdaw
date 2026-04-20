import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { LegatoTuning } from '../LegatoTuning';

describe('LegatoTuning', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        const { container } = render(<LegatoTuning config={patch.legato} onChange={vi.fn()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
