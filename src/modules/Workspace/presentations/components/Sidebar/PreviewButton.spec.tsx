import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PreviewButton } from './PreviewButton';

describe('PreviewButton', () => {
    it('should call onPlay when idle', () => {
        const onPlay = vi.fn();
        const onStop = vi.fn();
        render(<PreviewButton isPlaying={false} onPlay={onPlay} onStop={onStop} />);
        fireEvent.click(screen.getByRole('button', { name: 'Preview sound' }));
        expect(onPlay).toHaveBeenCalledTimes(1);
        expect(onStop).not.toHaveBeenCalled();
    });

    it('should call onStop when playing', () => {
        const onPlay = vi.fn();
        const onStop = vi.fn();
        render(<PreviewButton isPlaying onPlay={onPlay} onStop={onStop} />);
        fireEvent.click(screen.getByRole('button', { name: 'Stop preview' }));
        expect(onStop).toHaveBeenCalledTimes(1);
        expect(onPlay).not.toHaveBeenCalled();
    });
});
