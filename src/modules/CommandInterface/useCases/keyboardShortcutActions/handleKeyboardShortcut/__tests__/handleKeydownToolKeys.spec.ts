import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getToolShortcutKeys, setEditingTool } from '#/modules/WorkspaceShell/useCases';

import { shortcutStore } from '../../../../stores/shortcutStore';
import { viewCommands } from '../../../commands/ViewCommands';
import { handleKeydown, type KeyDescriptor } from '../handleKeydown';

const { cycleAutomationVisibilityMock } = vi.hoisted(() => ({ cycleAutomationVisibilityMock: vi.fn() }));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Arrangement/useCases') = await importOriginal();
    return { ...actual, addMarker: vi.fn(), zoomTimelineBy: vi.fn() };
});
vi.mock('#/modules/SessionLauncher/stores', async (importOriginal) => {
    const actual: typeof import('#/modules/SessionLauncher/stores') = await importOriginal();
    return { ...actual, loopStationStore: { value: { armed: false, slots: [] } } };
});
vi.mock('#/modules/SessionLauncher/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/SessionLauncher/useCases') = await importOriginal();
    return { ...actual, stopAllSlots: vi.fn(), triggerPad: vi.fn() };
});
vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Transport/useCases') = await importOriginal();
    return {
        ...actual,
        stopPlayback: vi.fn(() => Promise.resolve()),
        panicAllNotes: vi.fn(() => Promise.resolve()),
        seekPlayhead: vi.fn(),
        setLoopRegion: vi.fn(),
    };
});
vi.mock('#/modules/Onboarding/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Onboarding/useCases') = await importOriginal();
    return { ...actual, startOnboardingTour: vi.fn() };
});
vi.mock('#/modules/WorkspaceShell/stores', async (importOriginal) => {
    const actual: typeof import('#/modules/WorkspaceShell/stores') = await importOriginal();
    return { ...actual, workspaceStore: { value: { collaborationPanelOpen: false } } };
});
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/Command/useCases') = await importOriginal();
    return { ...actual, executeUserAppAction: vi.fn(), pushUndoEntry: vi.fn(), redo: vi.fn(), undo: vi.fn() };
});
// Only the side-effecting use cases are doubled: the key maps and the key-listing
// function are the real exports, because they are what this spec compares.
vi.mock('#/modules/WorkspaceShell/useCases', async (importOriginal) => {
    const actual: typeof import('#/modules/WorkspaceShell/useCases') = await importOriginal();
    return {
        ...actual,
        closeCollaborationPanel: vi.fn(),
        cycleAutomationVisibility: cycleAutomationVisibilityMock,
        openExportDialog: vi.fn(),
        openPreferencesDialog: vi.fn(),
        setEditingTool: vi.fn(),
        showDevicePanel: vi.fn(),
        startToolSwap: vi.fn(),
        toggleCommandPalette: vi.fn(),
        toggleMixer: vi.fn(),
        toggleTrackList: vi.fn(),
        toggleVirtualKeyboard: vi.fn(),
        toggleWorkspaceMode: vi.fn(),
    };
});

const TOOLS = ['select', 'cut', 'draw', 'automation', 'stretch', 'marquee'] as const;

// `g` arms the AI chord leader and swallows the next press, so it goes last.
const CANDIDATE_KEYS = [...'abcdefhijklmnopqrstuvwxyz0123456789g'];

function press(key: string): void {
    const descriptor: KeyDescriptor = { key, mod: false, shift: false, alt: false, repeat: false, isInput: false };
    handleKeydown(descriptor);
}

/** Every plain key that makes the real keyboard handler select a tool, by tool. */
function keysThatSelect(): Record<string, string[]> {
    const selecting: Record<string, string[]> = {};
    for (const key of CANDIDATE_KEYS) {
        vi.mocked(setEditingTool).mockClear();
        press(key);
        for (const [tool] of vi.mocked(setEditingTool).mock.calls) {
            const keys = selecting[tool] ?? [];
            keys.push(key.toUpperCase());
            selecting[tool] = keys;
        }
    }
    return selecting;
}

function sortedKeys(keys: readonly string[] | undefined): string[] {
    const copy = keys === undefined ? [] : [...keys];
    return copy.sort();
}

describe('tool shortcut help matches the keyboard handler', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        shortcutStore.set({ definitions: shortcutStore.value?.definitions ?? [], customMappings: {} });
        injectDependencies(handleKeydown, { eventBus: { emit: vi.fn(), on: vi.fn(() => () => undefined) } });
    });

    it('lists, for every tool, exactly the keys that select it', () => {
        const selecting = keysThatSelect();

        for (const tool of TOOLS) {
            expect(sortedKeys(getToolShortcutKeys(tool))).toStrictEqual(sortedKeys(selecting[tool]));
        }
    });

    it('shows each palette tool command the keys that select that tool', () => {
        const selecting = keysThatSelect();

        const hints = viewCommands
            .filter((command) => command.id.startsWith('tool-'))
            .map((command) => ({
                tool: command.id.replace('tool-', ''),
                keys: (command.shortcut ?? '').split(' / ').sort(),
            }));

        expect(hints).toStrictEqual(
            ['select', 'cut', 'draw', 'automation', 'stretch'].map((tool) => ({
                tool,
                keys: sortedKeys(selecting[tool]),
            }))
        );
    });

    it('keeps A on automation visibility instead of selecting a tool', () => {
        press('a');

        expect(cycleAutomationVisibilityMock).toHaveBeenCalledTimes(1);
        expect(setEditingTool).not.toHaveBeenCalled();
    });
});
