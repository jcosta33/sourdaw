import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { DawTransportCluster } from './DawTransportCluster';

describe('DawTransportCluster', () => {
    it('should apply well tone classes', () => {
        const { container } = render(<DawTransportCluster tone="well">t</DawTransportCluster>);
        expect(container.firstChild).toHaveClass('daw-readout-well');
    });
});
