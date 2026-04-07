import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LegatoTuning } from './LegatoTuning';
import { createDefaultPatch } from '../../models/LevainPatch';

describe('LegatoTuning', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        const { container } = render(<LegatoTuning config={patch.legato} onChange={vi.fn()} />);
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
