import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { NodeGraphEditor } from './NodeGraphEditor';
import { DEFAULT_PATCH } from '../../models/BacteriaPatch';

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
                onRoutingChange={vi.fn()}
            />
        );
        expect(container.querySelector('svg')).toBeTruthy();
    });
});
