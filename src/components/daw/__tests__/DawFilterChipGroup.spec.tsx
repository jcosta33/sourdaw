import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DawFilterChipGroup } from '../DawFilterChipGroup';

const OPTIONS = [
    { value: 'a', label: 'Alpha', activeClassName: 'is-active-alpha' },
    { value: 'b', label: 'Beta' },
    { value: 'c', label: 'Gamma' },
] as const;

const Harness = ({ onChange }: { onChange?: (value: string) => void }) => {
    const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
    return (
        <DawFilterChipGroup
            label="Letters"
            options={OPTIONS}
            value={value}
            onValueChange={(next) => {
                setValue(next);
                onChange?.(next);
            }}
        />
    );
};

describe('DawFilterChipGroup', () => {
    it('exposes a named radio group with exactly the selected chip checked', () => {
        render(<Harness />);

        expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
        expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'false');
        expect(screen.getByRole('radio', { name: 'Alpha' }).className).toContain('is-active-alpha');
    });

    it('keeps only the selected chip in the tab order', () => {
        render(<Harness />);

        expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('tabindex', '0');
        expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('tabindex', '-1');
    });

    it('selects a chip on click', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        fireEvent.click(screen.getByRole('radio', { name: 'Gamma' }));

        expect(onChange).toHaveBeenCalledExactlyOnceWith('c');
        expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');
    });

    it('moves selection and focus with the arrow keys and wraps at the ends', () => {
        render(<Harness />);
        const group = screen.getByRole('radiogroup');

        fireEvent.keyDown(group, { key: 'ArrowRight' });
        expect(screen.getByRole('radio', { name: 'Beta' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Beta' })).toHaveFocus();

        fireEvent.keyDown(group, { key: 'ArrowLeft' });
        fireEvent.keyDown(group, { key: 'ArrowLeft' });
        expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');
        expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveFocus();
    });

    it('jumps to the first and last chip with Home and End', () => {
        render(<Harness />);
        const group = screen.getByRole('radiogroup');

        fireEvent.keyDown(group, { key: 'End' });
        expect(screen.getByRole('radio', { name: 'Gamma' })).toHaveAttribute('aria-checked', 'true');

        fireEvent.keyDown(group, { key: 'Home' });
        expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true');
    });

    it('ignores unrelated keys', () => {
        const onChange = vi.fn();
        render(<Harness onChange={onChange} />);

        fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'x' });

        expect(onChange).not.toHaveBeenCalled();
    });
});
