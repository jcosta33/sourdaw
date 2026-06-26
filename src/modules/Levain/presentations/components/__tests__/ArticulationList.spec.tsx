import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { createDefaultPatch } from '../../../models/LevainPatch';
import { ArticulationList } from '../ArticulationList';

describe('ArticulationList', () => {
    it('should render', () => {
        const patch = createDefaultPatch('violin-1');
        render(
            <ArticulationList
                articulations={patch.articulations}
                current={patch.currentArticulation}
                grid
                onSelect={vi.fn()}
            />
        );
        expect(screen.getAllByText(/^Long$/).length).toBeGreaterThan(0);
    });

    it('calls onSelect with the articulation type when its card is clicked', () => {
        const patch = createDefaultPatch('violin-1');
        // 'staccato' is enabled in the default violin patch and its name has no
        // substring collision with another articulation's name.
        const target = patch.articulations.find((a) => a.type === 'staccato' && a.enabled);
        expect(target).toBeDefined();
        const onSelect = vi.fn();

        render(
            <ArticulationList
                articulations={patch.articulations}
                current={patch.currentArticulation}
                grid
                onSelect={onSelect}
            />
        );

        fireEvent.click(screen.getByRole('button', { name: /staccato/i }));

        expect(onSelect).toHaveBeenCalledTimes(1);
        expect(onSelect).toHaveBeenCalledWith('staccato');
    });
});
