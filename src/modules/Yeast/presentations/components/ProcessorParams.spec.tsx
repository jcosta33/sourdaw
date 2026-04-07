import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProcessorParams } from './ProcessorParams';

describe('ProcessorParams', () => {
    it('should render', () => {
        render(
            <ProcessorParams processorId="p1" processorType="arpeggiator" onSetParam={vi.fn()} />
        );
        expect(screen.getByText('Mode')).toBeInTheDocument();
    });
});
