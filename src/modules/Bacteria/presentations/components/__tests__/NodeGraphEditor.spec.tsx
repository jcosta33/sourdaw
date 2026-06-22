import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/BacteriaPatch';
import { NodeGraphEditor } from '../NodeGraphEditor';

describe('NodeGraphEditor', () => {
    it('should render', () => {
        const { container } = render(
            <NodeGraphEditor
                width={320}
                height={200}
                bandCount={2}
                bands={DEFAULT_PATCH.bands.slice(0, 2)}
                globalRouting="serial"
                crossoverFreqs={[500, 2000]}
            />
        );
        expect(container.querySelector('svg')).toBeTruthy();
    });
});
