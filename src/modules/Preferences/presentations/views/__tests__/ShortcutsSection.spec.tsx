import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { shortcutStore, type ShortcutDefinition } from '#/modules/CommandInterface/stores';
import { confirmUser } from '#/utils/Notification/confirmUser';

import { ShortcutsSection } from '../ShortcutsSection';

vi.mock('#/utils/Notification/confirmUser', () => ({
    confirmUser: vi.fn(),
}));

vi.mock('../../components/CaptureKeyButton', () => ({
    CaptureKeyButton: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
        <button onClick={onClick}>{children}</button>
    ),
}));

vi.mock('../preferencesShared', () => ({
    SectionTitle: ({ title }: { title: string }) => <h2>{title}</h2>,
}));

function definition(id: string, label: string, defaultKeys: string[]): ShortcutDefinition {
    return { id, label, category: 'transport', defaultKeys, action: { type: 'callback', id } };
}

const DEFINITIONS: ShortcutDefinition[] = [
    definition('transport.togglePlayback', 'Toggle Playback', ['Space']),
    definition('transport.toggleMetronome', 'Toggle Metronome', ['m']),
    definition('transport.toggleLoop', 'Toggle Loop', ['l']),
    { ...definition('editing.undo', 'Undo', ['mod+z']), category: 'editing' },
    { ...definition('editing.copyClip', 'Copy', ['mod+c']), category: 'editing' },
    definition('loopStation.pad.r0c0.play', 'Loop Station: Play row 1 col 1', ['1']),
];

function setCustomMappings(customMappings: Record<string, string[]>): void {
    act(() => {
        shortcutStore.set({ definitions: DEFINITIONS, customMappings });
    });
}

/** The binding button in the row labelled `label`. */
function bindingButton(label: string): HTMLElement {
    const button = screen.getByText(label).nextElementSibling;
    if (!(button instanceof HTMLElement)) {
        throw new Error(`expected a binding button beside ${label}`);
    }
    return button;
}

function startCapture(label: string): void {
    fireEvent.click(bindingButton(label));
    expect(screen.getByText(/Press the desired key combination/)).toBeInTheDocument();
}

describe('ShortcutsSection', () => {
    beforeEach(() => {
        vi.mocked(confirmUser).mockReset();
        setCustomMappings({});
    });

    afterEach(() => {
        cleanup();
    });

    it('renders category headers for every populated category', () => {
        render(<ShortcutsSection />);
        expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
        expect(screen.getByText('Transport')).toBeInTheDocument();
        expect(screen.getByText('Editing')).toBeInTheDocument();
    });

    it('clears every custom mapping on `Reset to Defaults`', () => {
        setCustomMappings({ 'editing.undo': ['mod+y'] });
        render(<ShortcutsSection />);

        fireEvent.click(screen.getByText('Reset to Defaults'));

        expect(shortcutStore.value?.customMappings).toStrictEqual({});
        expect(bindingButton('Undo')).toHaveTextContent('⌘ Z');
    });

    it('renders a combo with the shared keycap labels', () => {
        setCustomMappings({ 'editing.undo': ['mod+Backspace'] });
        render(<ShortcutsSection />);

        expect(bindingButton('Undo')).toHaveTextContent('⌘ ⌫');
    });

    it('stores alt+d when capturing macOS Option+D, which reports ∂', () => {
        render(<ShortcutsSection />);
        startCapture('Toggle Metronome');

        fireEvent.keyDown(window, { key: '∂', code: 'KeyD', altKey: true });

        expect(shortcutStore.value?.customMappings).toStrictEqual({ 'transport.toggleMetronome': ['alt+d'] });
        expect(confirmUser).not.toHaveBeenCalled();
    });

    it('ends the capture on Escape without binding anything', () => {
        render(<ShortcutsSection />);
        startCapture('Toggle Metronome');

        fireEvent.keyDown(window, { key: 'Escape', code: 'Escape' });

        expect(screen.queryByText(/Press the desired key combination/)).not.toBeInTheDocument();
        expect(shortcutStore.value?.customMappings).toStrictEqual({});
        expect(bindingButton('Toggle Metronome')).toHaveTextContent('M');
    });

    it('asks before taking a key another command holds, and moves it on confirm', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        render(<ShortcutsSection />);
        startCapture('Toggle Metronome');

        fireEvent.keyDown(window, { key: 'l', code: 'KeyL' });

        expect(confirmUser).toHaveBeenCalledWith(
            expect.objectContaining({ message: 'L is assigned to Toggle Loop. Reassign it to Toggle Metronome?' })
        );
        await vi.waitFor(() => {
            expect(shortcutStore.value?.customMappings).toStrictEqual({
                'transport.toggleMetronome': ['l'],
                'transport.toggleLoop': [],
            });
        });
        expect(bindingButton('Toggle Metronome')).toHaveTextContent('L');
        expect(bindingButton('Toggle Loop')).toHaveTextContent('Unassigned');
    });

    it('asks before moving a global key onto a Loop Station play pad, and unbinds the global on confirm', async () => {
        vi.mocked(confirmUser).mockResolvedValue(true);
        render(<ShortcutsSection />);
        startCapture('Loop Station: Play row 1 col 1');

        fireEvent.keyDown(window, { key: 'c', code: 'KeyC', metaKey: true });

        expect(confirmUser).toHaveBeenCalledWith(
            expect.objectContaining({
                message: '⌘ C is assigned to Copy. Reassign it to Loop Station: Play row 1 col 1?',
            })
        );
        await vi.waitFor(() => {
            expect(shortcutStore.value?.customMappings).toStrictEqual({
                'loopStation.pad.r0c0.play': ['mod+c'],
                'editing.copyClip': [],
            });
        });
        expect(bindingButton('Copy')).toHaveTextContent('Unassigned');
    });

    it('leaves both commands unchanged when the reassignment is cancelled', async () => {
        vi.mocked(confirmUser).mockResolvedValue(false);
        render(<ShortcutsSection />);
        startCapture('Toggle Metronome');

        fireEvent.keyDown(window, { key: 'l', code: 'KeyL' });

        expect(confirmUser).toHaveBeenCalledTimes(1);
        // The section's continuation was queued on this promise before ours.
        await vi.mocked(confirmUser).mock.results[0]?.value;
        expect(shortcutStore.value?.customMappings).toStrictEqual({});
        expect(bindingButton('Toggle Metronome')).toHaveTextContent('M');
        expect(bindingButton('Toggle Loop')).toHaveTextContent('L');
    });
});
