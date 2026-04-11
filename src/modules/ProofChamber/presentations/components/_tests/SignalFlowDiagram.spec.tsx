import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { SignalFlowDiagram } from '../SignalFlowDiagram';

describe('SignalFlowDiagram', () => {
    it('should render', () => {
        const { container } = render(
            <SignalFlowDiagram algorithm="plate" shimmerEnabled={false} freezeEnabled={false} />
        );
        expect(container.querySelector('svg')).toBeTruthy();
    });
});
