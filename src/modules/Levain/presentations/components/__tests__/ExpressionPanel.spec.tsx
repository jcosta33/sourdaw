import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { ExpressionPanel } from '../ExpressionPanel';

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
