import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { executeUserAppAction } from '#/modules/Command/useCases';

import { MacrosPanel } from '../MacrosPanel';

const panelState = {
    macros: [{ id: 'macro-1', name: 'Macro One', actions: [{ type: 'noop' }] }],
    recording: false,
    currentRecording: [],
};

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn(() => panelState),
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeUserAppAction: vi.fn(),
    executeAppAction: vi.fn(),
    startMacroRecording: vi.fn(),
    stopMacroRecording: vi.fn(),
    pushUndoEntry: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
}));

describe('MacrosPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<MacrosPanel />);
        expect(document.body).toBeTruthy();
    });

    it('should render the recorded macros from the store', () => {
        render(<MacrosPanel />);
        expect(screen.getByText('Macro One')).toBeInTheDocument();
    });

    it('should have interactive elements', () => {
        render(<MacrosPanel />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThan(0);
    });

    it('plays a macro through the user dispatch wrapper', () => {
        render(<MacrosPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Play macro Macro One' }));

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'playMacro',
            payload: { macroId: 'macro-1' },
        });
    });

    it('deletes a macro through the user dispatch wrapper', () => {
        render(<MacrosPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Delete macro Macro One' }));

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'deleteMacro',
            payload: { macroId: 'macro-1' },
        });
    });

    it('commits a rename through the user dispatch wrapper', () => {
        render(<MacrosPanel />);

        fireEvent.click(screen.getByRole('button', { name: 'Rename macro Macro One' }));
        const input = screen.getByRole('textbox');
        fireEvent.change(input, { target: { value: 'Renamed' } });
        fireEvent.blur(input);

        expect(executeUserAppAction).toHaveBeenCalledExactlyOnceWith({
            type: 'renameMacro',
            payload: { macroId: 'macro-1', name: 'Renamed' },
        });
    });
});
