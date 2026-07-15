import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { ProcessorParams } from '../ProcessorParams';

describe('ProcessorParams', () => {
    it('should render', () => {
        render(
            <ProcessorParams processorId="p1" processorType="arpeggiator" onSetParam={vi.fn()} onCommand={vi.fn()} />
        );
        expect(screen.getByText('Mode')).toBeInTheDocument();
    });

    it('routes Chord Memory Learn and Clear All through the command callback', () => {
        const onSetParam = vi.fn();
        const onCommand = vi.fn();
        render(
            <ProcessorParams
                processorId="cm-1"
                processorType="chordMemory"
                onSetParam={onSetParam}
                onCommand={onCommand}
            />
        );

        screen.getByRole('button', { name: 'Learn' }).click();
        screen.getByRole('button', { name: 'Clear All' }).click();

        expect(onCommand).toHaveBeenNthCalledWith(1, 'cm-1', 'learn');
        expect(onCommand).toHaveBeenNthCalledWith(2, 'cm-1', 'clear');
        expect(onSetParam).not.toHaveBeenCalled();
    });
});
