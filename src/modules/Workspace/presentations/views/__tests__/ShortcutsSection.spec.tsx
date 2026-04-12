import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShortcutsSection } from '../ShortcutsSection';

// Mock hooks
vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => ({
        bindings: {
            PLAY_PAUSE: { key: ' ' },
            STOP_RETURN: { key: '0' },
            RECORD_TOGGLE: {},
            LOOP_TOGGLE: {},
            UNDO: {},
            REDO: {},
            COPY: {},
            PASTE: {},
            DELETE: {},
            SPLIT_CLIP: {},
            DUPLICATE: {},
            SAVE_PROJECT: {},
            TOGGLE_MIXER: {},
            TOGGLE_INSPECTOR: {},
            TOGGLE_AI_ASSISTANT: {},
        },
    })),
}));

// Mock models and useCases
vi.mock('../../../models/Shortcuts', () => ({
    shortcutStore: { name: 'shortcutStore' },
    updateShortcutBinding: vi.fn(),
    resetShortcutsToDefault: vi.fn(),
    formatKeyBinding: vi.fn((b) => b.key || 'None'),
    DEFAULT_SHORTCUTS: {},
}));

// Mock child components
vi.mock('../../components/CaptureKeyButton', () => ({
    CaptureKeyButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));

vi.mock('../preferencesShared', () => ({
    SectionTitle: ({ title }: any) => <h2>{title}</h2>,
}));

describe('ShortcutsSection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render shortcut labels and bindings', () => {
        render(<ShortcutsSection />);
        expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
        expect(screen.getByText('Stop (Return to 0)')).toBeInTheDocument();
        expect(screen.getByText('0')).toBeInTheDocument();
    });

    it('should call resetShortcutsToDefault when reset button is clicked', async () => {
        render(<ShortcutsSection />);
        const resetButton = screen.getByText('Reset to Defaults');
        fireEvent.click(resetButton);
        
        const { resetShortcutsToDefault } = await import('../../../models/Shortcuts');
        expect(resetShortcutsToDefault).toHaveBeenCalled();
    });

    it('should enter editing mode when binding button is clicked', () => {
        render(<ShortcutsSection />);
        const bindingButton = screen.getByText('0');
        fireEvent.click(bindingButton);
        
        expect(screen.getByText(/Press the desired key combination/)).toBeInTheDocument();
    });
});
