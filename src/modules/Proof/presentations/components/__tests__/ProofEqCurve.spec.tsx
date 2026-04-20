import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/ProofPatch';
import { ProofEqCurve } from '../ProofEqCurve';

describe('ProofEqCurve', () => {
    it('should render', () => {
        const { container } = render(
            <ProofEqCurve
                patch={DEFAULT_PATCH}
                width={200}
                height={100}
                onPatchChange={vi.fn()}
                onSendParam={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
