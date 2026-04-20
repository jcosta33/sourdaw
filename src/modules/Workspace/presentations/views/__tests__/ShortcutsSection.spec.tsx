import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ShortcutsSection } from '../ShortcutsSection';

const mocks = vi.hoisted(() => ({
    setSpy: vi.fn(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        definitions: [
            {
                id: 'transport.togglePlayback',
                label: 'Toggle Playback',
                category: 'transport',
                defaultKeys: ['Space'],
                action: { type: 'appAction', action: { type: 'togglePlayback' } },
            },
            {
                id: 'editing.undo',
                label: 'Undo',
                category: 'editing',
                defaultKeys: ['mod+z'],
                action: { type: 'callback', id: 'undo' },
            },
        ],
        customMappings: {
            'editing.undo': ['mod+z'],
        },
    })),
}));

vi.mock('#/modules/Command/stores', () => ({
    shortcutStore: {
        name: 'shortcutStore',
        value: {
            definitions: [
                {
                    id: 'transport.togglePlayback',
                    label: 'Toggle Playback',
                    category: 'transport',
                    defaultKeys: ['Space'],
                    action: { type: 'appAction', action: { type: 'togglePlayback' } },
                },
                {
                    id: 'editing.undo',
                    label: 'Undo',
                    category: 'editing',
                    defaultKeys: ['mod+z'],
                    action: { type: 'callback', id: 'undo' },
                },
            ],
            customMappings: { 'editing.undo': ['mod+z'] },
        },
        set: (next: unknown) => mocks.setSpy(next),
    },
}));

vi.mock('../../components/CaptureKeyButton', () => ({
    CaptureKeyButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
}));

vi.mock('../preferencesShared', () => ({
    SectionTitle: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

describe('ShortcutsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders category headers for every populated category', () => {
        render(<ShortcutsSection />);
        expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
        expect(screen.getByText('Transport')).toBeInTheDocument();
        expect(screen.getByText('Editing')).toBeInTheDocument();
    });

    it('renders both custom-mapped and default-mapped labels', () => {
        render(<ShortcutsSection />);
        expect(screen.getByText('Toggle Playback')).toBeInTheDocument();
        expect(screen.getByText('Undo')).toBeInTheDocument();
    });

    it('clears customMappings on `Reset to Defaults`', () => {
        render(<ShortcutsSection />);
        fireEvent.click(screen.getByText('Reset to Defaults'));
        expect(mocks.setSpy).toHaveBeenCalledWith(expect.objectContaining({ customMappings: {} }));
    });

    it('enters capture mode when a binding button is clicked', () => {
        render(<ShortcutsSection />);
        fireEvent.click(screen.getByText('Space'));
        expect(screen.getByText(/Press the desired key combination/)).toBeInTheDocument();
    });
});
