import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/FermenterPatch';
import { MacroMatrixEditor } from '../MacroMatrixEditor';

describe('MacroMatrixEditor', () => {
    it('renders the selected macro mapping targets', () => {
        render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={vi.fn()} />);

        expect(screen.getByText('Matrix')).toBeInTheDocument();
        expect(screen.getByLabelText('Macro')).toHaveValue('0');
        expect(screen.getByLabelText('Target 1')).toHaveValue('filterCutoff');
    });

    it('emits edited target assignments', () => {
        const onChange = vi.fn();
        render(<MacroMatrixEditor mappings={DEFAULT_PATCH.macroMappings} onChange={onChange} />);

        fireEvent.change(screen.getByLabelText('Target 1'), { target: { value: 'reverbMix' } });

        expect(onChange).toHaveBeenCalledWith(
            0,
            expect.arrayContaining([
                {
                    targets: [
                        expect.objectContaining({
                            target: 'reverbMix',
                            min: 0,
                            max: 1,
                        }),
                    ],
                },
            ])
        );
    });

    it('falls back to default mappings when a legacy patch has none', () => {
        render(<MacroMatrixEditor mappings={undefined} onChange={vi.fn()} />);

        expect(screen.getByLabelText('Target 1')).toHaveValue('filterCutoff');
    });
});
