import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { LibraryRootCard } from '../LibraryRootCard';

import type { LibraryRoot } from '../../../models/LibraryTypes';

function makeRoot(overrides: Partial<LibraryRoot> = {}): LibraryRoot {
    return {
        id: 'r1',
        name: 'My Drive',
        path: '/drives/my-drive',
        status: 'ready',
        fileCount: 42,
        ...overrides,
    } as LibraryRoot;
}

function renderCard(overrides: Record<string, unknown> = {}) {
    const onSelect = vi.fn();
    const onRescan = vi.fn();
    const onRemove = vi.fn();
    render(
        <LibraryRootCard
            root={makeRoot()}
            isActive={false}
            onSelect={onSelect}
            onRescan={onRescan}
            onRemove={onRemove}
            {...overrides}
        />
    );
    return { onSelect, onRescan, onRemove };
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('LibraryRootCard — status text branches', () => {
    it('shows file count when status is ready', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'ready', fileCount: 42 })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByText('42 files')).toBeInTheDocument();
    });

    it('shows "Scanning..." when status is scanning', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'scanning' })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByText('Scanning...')).toBeInTheDocument();
    });

    it('shows "Click to restore access" when status is permission_required', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'permission_required' })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByText('Click to restore access')).toBeInTheDocument();
    });

    it('shows "Offline" for unknown status', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'offline' as never })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('aria-label includes folder name and status text', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'ready', fileCount: 42 })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: /My Drive, 42 files/i })).toBeInTheDocument();
    });
});

describe('LibraryRootCard — aria-pressed', () => {
    it('aria-pressed is true when active', () => {
        render(<LibraryRootCard root={makeRoot()} isActive onSelect={vi.fn()} onRescan={vi.fn()} onRemove={vi.fn()} />);
        expect(screen.getByRole('button', { name: /Library folder My Drive, 42 files/i })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });

    it('aria-pressed is false when inactive', () => {
        render(
            <LibraryRootCard
                root={makeRoot()}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.getByRole('button', { name: /Library folder My Drive, 42 files/i })).toHaveAttribute(
            'aria-pressed',
            'false'
        );
    });
});

describe('LibraryRootCard — action buttons', () => {
    it('calls onRescan when rescan button clicked', () => {
        const { onRescan, onSelect } = renderCard();
        fireEvent.click(screen.getByRole('button', { name: /rescan/i }));
        expect(onRescan).toHaveBeenCalledTimes(1);
        // stopPropagation: card onClick must NOT fire
        expect(onSelect).not.toHaveBeenCalled();
    });

    it('calls onRemove when disconnect button clicked', () => {
        const { onRemove, onSelect } = renderCard();
        fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
        expect(onRemove).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('LibraryRootCard — permission restore button', () => {
    it('renders restore button when status is permission_required AND onRequestPermission provided', () => {
        const onRequestPermission = vi.fn();
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'permission_required' })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
                onRequestPermission={onRequestPermission}
            />
        );
        expect(screen.getByRole('button', { name: /Restore access to My Drive/i })).toBeInTheDocument();
    });

    it('does NOT render restore button when status is not permission_required', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'ready' })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
                onRequestPermission={vi.fn()}
            />
        );
        expect(screen.queryByRole('button', { name: /Restore access to My Drive/i })).toBeNull();
    });

    it('does NOT render restore button when onRequestPermission is not provided', () => {
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'permission_required' })}
                isActive={false}
                onSelect={vi.fn()}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        expect(screen.queryByRole('button', { name: /Restore access to My Drive/i })).toBeNull();
    });

    it('calls onRequestPermission when restore button clicked', () => {
        const onRequestPermission = vi.fn();
        const onSelect = vi.fn();
        render(
            <LibraryRootCard
                root={makeRoot({ status: 'permission_required' })}
                isActive={false}
                onSelect={onSelect}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
                onRequestPermission={onRequestPermission}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /Restore access to My Drive/i }));
        expect(onRequestPermission).toHaveBeenCalledTimes(1);
        expect(onSelect).not.toHaveBeenCalled();
    });
});

describe('LibraryRootCard — card click and keyboard', () => {
    it('calls onSelect when card is clicked', () => {
        const { onSelect } = renderCard();
        // Click the card itself (not a button inside it)
        fireEvent.click(screen.getByText('My Drive'));
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect on Enter key', () => {
        const onSelect = vi.fn();
        render(
            <LibraryRootCard
                root={makeRoot()}
                isActive={false}
                onSelect={onSelect}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        fireEvent.keyDown(screen.getByRole('button', { name: /Library folder My Drive, 42 files/i }), { key: 'Enter' });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });

    it('calls onSelect on Space key', () => {
        const onSelect = vi.fn();
        render(
            <LibraryRootCard
                root={makeRoot()}
                isActive={false}
                onSelect={onSelect}
                onRescan={vi.fn()}
                onRemove={vi.fn()}
            />
        );
        fireEvent.keyDown(screen.getByRole('button', { name: /Library folder My Drive, 42 files/i }), { key: ' ' });
        expect(onSelect).toHaveBeenCalledTimes(1);
    });
});
