import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { PreviewButton } from '../PreviewButton';

describe('PreviewButton', () => {
    it('should call onPlay when idle', () => {
        const onPlay = vi.fn();
        const onStop = vi.fn();
        render(<PreviewButton isPlaying={false} itemName="Kick" onPlay={onPlay} onStop={onStop} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview Kick' }));
        expect(onPlay).toHaveBeenCalledTimes(1);
        expect(onStop).not.toHaveBeenCalled();
    });

    it('should call onStop when playing', () => {
        const onPlay = vi.fn();
        const onStop = vi.fn();
        render(<PreviewButton isPlaying itemName="Kick" onPlay={onPlay} onStop={onStop} />);
        fireEvent.click(screen.getByRole('button', { name: 'Stop previewing Kick' }));
        expect(onStop).toHaveBeenCalledTimes(1);
        expect(onPlay).not.toHaveBeenCalled();
    });

    it('gives each row a distinct name that carries its own item name', () => {
        render(
            <>
                <PreviewButton isPlaying={false} itemName="Kick" onPlay={vi.fn()} onStop={vi.fn()} />
                <PreviewButton isPlaying={false} itemName="Snare" onPlay={vi.fn()} onStop={vi.fn()} />
            </>
        );
        expect(screen.getByRole('button', { name: 'Preview Kick' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Preview Snare' })).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Preview sound' })).toBeNull();
    });
});
