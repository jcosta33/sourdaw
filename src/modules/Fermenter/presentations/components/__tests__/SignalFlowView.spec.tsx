import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { SignalFlowView } from '../SignalFlowView';

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
