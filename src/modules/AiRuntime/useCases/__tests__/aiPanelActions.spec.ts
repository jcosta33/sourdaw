import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, type Track } from '#/modules/Arrangement/stores';

import { runAppAction } from '../aiPanelActions/runAppAction';
import { toggleChat } from '../aiPanelActions/toggleChat';
import { undoLastAction } from '../aiPanelActions/undoLastAction';

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: vi.fn(),
    executeAppActionBatch: vi.fn(),
    executeUserAppAction: vi.fn(),
    undo: vi.fn(),
    REDO_NOT_APPLIED: Symbol('REDO_NOT_APPLIED'),
    isAppActionCommittedError: vi.fn(() => false),
    pushUndoEntry: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
    syncActionReplayMetadata: vi.fn(),
}));

vi.mock('#/modules/WorkspaceShell/useCases', () => ({
    toggleChatPanel: vi.fn(),
}));

function createTrack(): Track {
    return {
        id: 't1',
        name: 'Lead Vocal',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [],
        devices: [],
        sends: [],
        midiFx: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 72,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: '',
        alternatives: [],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

describe('aiPanelActions injectables', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        trackStore.set({ tracks: [createTrack()], selectedTrackId: null, ghostClips: [] });
    });

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('runAppAction forwards to executeUserAppAction', async () => {
        const { executeUserAppAction } = await import('#/modules/Command/useCases');
        await runAppAction({ type: 'muteTrack', payload: { trackId: 't1', muted: true } });

        expect(executeUserAppAction).toHaveBeenCalledWith({
            type: 'muteTrack',
            payload: { trackId: 't1', muted: true, expectedMuted: false },
        });
    });

    it('undoLastAction forwards to undo', async () => {
        const { undo } = await import('#/modules/Command/useCases');
        undoLastAction();

        expect(undo).toHaveBeenCalledTimes(1);
    });

    it('toggleChat forwards to toggleChatPanel', async () => {
        const { toggleChatPanel } = await import('#/modules/WorkspaceShell/useCases');
        toggleChat();

        expect(toggleChatPanel).toHaveBeenCalledTimes(1);
    });
});
