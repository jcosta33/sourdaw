import { fireEvent, render, screen } from '@testing-library/react';
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

    it('should render MIDI-owned groove templates and route selection through the assignment callback', () => {
        const onSetParam = vi.fn();
        const onSetGrooveTemplate = vi.fn();
        render(
            <ProcessorParams
                processorId="groove-1"
                processorType="groove"
                onSetParam={onSetParam}
                onCommand={vi.fn()}
                grooveTemplates={[
                    { id: 'groove-straight', name: 'Straight' },
                    { id: 'pocket-1', name: 'Pocket' },
                ]}
                selectedGrooveTemplateId="groove-straight"
                grooveAmount={0.75}
                onSetGrooveTemplate={onSetGrooveTemplate}
            />
        );

        fireEvent.change(screen.getByRole('combobox', { name: 'Groove template' }), {
            target: { value: 'pocket-1' },
        });

        const amountSlider = screen.getByRole('slider', { name: 'Amount' });
        fireEvent.pointerDown(amountSlider, { button: 0, pointerId: 1, clientY: 100 });
        fireEvent.pointerMove(amountSlider, { pointerId: 1, clientY: 80 });

        expect(onSetParam).toHaveBeenCalledWith('groove-1', 'amount', expect.any(Number), true);

        fireEvent.pointerUp(amountSlider, { pointerId: 1 });

        expect(onSetParam).toHaveBeenLastCalledWith('groove-1', 'amount', expect.any(Number), false);
        expect(onSetGrooveTemplate).toHaveBeenCalledWith('groove-1', 'pocket-1');
        expect(onSetParam).not.toHaveBeenCalledWith('groove-1', 'template', expect.any(Number));
    });
});
