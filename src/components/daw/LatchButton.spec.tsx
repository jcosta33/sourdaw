import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LatchButton } from './LatchButton';

describe('LatchButton', () => {
    it('should reflect active state on data-active', () => {
        render(<LatchButton active>Solo</LatchButton>);
        expect(screen.getByRole('button', { name: 'Solo' })).toHaveAttribute('data-active', 'true');
    });

    it('should invoke onClick', () => {
        const onClick = vi.fn();
        render(
            <LatchButton active={false} onClick={onClick}>
                Tap
            </LatchButton>
        );
        fireEvent.click(screen.getByRole('button'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });
});
