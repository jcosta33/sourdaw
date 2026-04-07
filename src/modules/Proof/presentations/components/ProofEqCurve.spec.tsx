import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ProofEqCurve } from './ProofEqCurve';
import { DEFAULT_PATCH } from '../../models/ProofPatch';

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
