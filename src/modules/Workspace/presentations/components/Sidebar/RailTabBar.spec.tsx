import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RailTabBar } from './RailTabBar';

describe('RailTabBar', () => {
    it('should render tabs and call onChange', () => {
        const onChange = vi.fn();
        render(
            <RailTabBar
                activeId="a"
                items={[
                    { id: 'a', label: 'Alpha' },
                    { id: 'b', label: 'Beta' },
                ]}
                onChange={onChange}
            />
        );
        expect(screen.getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Beta' }));
        expect(onChange).toHaveBeenCalledWith('b');
    });
});
