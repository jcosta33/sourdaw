import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawEffectDisclosure } from '../DawEffectDisclosure';

describe('DawEffectDisclosure', () => {
    it('offers named, accessible tiers and reports the choice without changing its own selection', () => {
        const onChange = vi.fn();
        render(<DawEffectDisclosure tier="play" onChange={onChange} />);

        expect(screen.getByRole('group', { name: 'Effect control detail' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true');
        for (const name of ['shape', 'build', 'route', 'lab']) {
            expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', 'false');
        }

        fireEvent.click(screen.getByRole('button', { name: 'route' }));
        expect(onChange).toHaveBeenCalledWith('route');
        expect(screen.getByRole('button', { name: 'play' })).toHaveAttribute('aria-pressed', 'true');
    });
});


it('can offer only Basic and Expert while leaving default effect choices intact', () => {
    const onChange = vi.fn();
    render(<DawEffectDisclosure tier="play" onChange={onChange} tone="amber"
        options={['play', 'lab']} labels={{ play: 'Basic', lab: 'Expert' }} groupLabel="Levain control detail" />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Levain control detail' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Basic' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }));
    expect(onChange).toHaveBeenCalledWith('lab');
    expect(screen.queryByRole('button', { name: 'shape' })).not.toBeInTheDocument();
});
