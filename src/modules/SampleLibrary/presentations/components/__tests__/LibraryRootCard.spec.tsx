import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LibraryRootCard } from '../LibraryRootCard';

describe('LibraryRootCard', () => {
    it('should render', () => {
        const root = {
            id: 'r1',
            name: 'My Drive',
            provider: 'browser' as const,
            rootRef: 'key',
            connectedAt: Date.now(),
            status: 'ready' as const,
            fileCount: 10,
            settings: { recursive: true },
        };
        render(
            <LibraryRootCard
                root={root}
                isActive
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByText('My Drive')).toBeInTheDocument();
    });
});
