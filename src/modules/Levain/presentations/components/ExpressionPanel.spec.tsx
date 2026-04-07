import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ExpressionPanel } from './ExpressionPanel';
import { createDefaultPatch } from '../../models/LevainPatch';

describe('ExpressionPanel', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        const { container } = render(
            <ExpressionPanel
                expression={patch.expression}
                legato={patch.legato}
                onChangeExp={vi.fn()}
                onChangeLeg={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
