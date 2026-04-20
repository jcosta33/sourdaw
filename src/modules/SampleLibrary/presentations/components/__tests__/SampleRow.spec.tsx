import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SampleRow } from '../SampleRow';

describe('SampleRow', () => {
    it('should render', () => {
        const sample = {
            id: 's1',
            libraryRootId: 'r1',
            relativePath: 'a.wav',
            displayName: 'a',
            ext: 'wav',
            folder: '/',
            sync: { exists: true, status: 'indexed' as const },
            format: { durationSec: 1.2 },
            tags: [],
            favorite: false,
        };
        render(
            <SampleRow
                sample={sample}
                isPlaying={false}
                onPlay={vi.fn()}
                onStop={vi.fn()}
                onToggleFavorite={vi.fn()}
                onDragStart={vi.fn()}
                onClick={vi.fn()}
            />
        );
        expect(screen.getByText('a')).toBeInTheDocument();
    });
});
