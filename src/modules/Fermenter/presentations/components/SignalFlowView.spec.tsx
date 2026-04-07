import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { SignalFlowView } from './SignalFlowView';
import { DEFAULT_PATCH } from '../../models/FermenterPatch';

describe('SignalFlowView', () => {
    it('should render', () => {
        const { container } = render(
            <SignalFlowView
                patch={DEFAULT_PATCH}
                numLayers={DEFAULT_PATCH.numLayers}
                activeLayer={DEFAULT_PATCH.activeLayer}
                onSelectSection={vi.fn()}
            />
        );
        expect(container.querySelector('canvas')).toBeTruthy();
    });
});
