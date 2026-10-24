import { useState } from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { TimelineClipNavigator } from '#/modules/Arrangement/presentations/views';
import {
    clipSelectionStore,
    defaultClipSelectionState,
    defaultTrackState,
    trackStore,
} from '#/modules/Arrangement/stores';
import { copySelectedClip, getArrangementHandlers, pasteClip, setClipSelection } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import * as commandUseCases from '#/modules/Command/useCases';
import { clearUndoHistory, resetActionReplayAuthority, setActionHistoryMetadataPort } from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { playheadPositionRef } from '#/modules/Transport/stores';

import { createApplicationMenuTemplate } from '../../../../../../electron/applicationMenu';
import { useNativeApplicationMenu } from '../useNativeApplicationMenu';

import type { Clip, Track } from '#/modules/Arrangement/stores';
import type { NativeMenuIntent } from '../../../../../../electron/applicationMenu';

const native = vi.hoisted(() => ({ listener: undefined as ((intent: NativeMenuIntent) => void) | undefined }));

vi.mock('../../../useCases/nativeApplicationMenu', () => ({
    nativeApplicationMenu: () => ({
        listen: (listener: (intent: NativeMenuIntent) => void) => {
            native.listener = listener;
            return () => {
                native.listener = undefined;
            };
        },
        projectState: async () => undefined,
        saveResult: async () => undefined,
        listenSessionQuiesce: () => () => undefined,
        listenSessionQuiesceCancel: () => () => undefined,
        sessionQuiesced: async () => undefined,
        sessionQuiesceStarted: async () => true,
    }),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

let initialPlayheadBeat = 0;

function makeClip(id: string, startBeat: number): Clip {
    return {
        id,
        trackId: 'track-one',
        name: id,
        startBeat,
        endBeat: startBeat + 2,
        type: 'midi',
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '#ffffff',
        locked: false,
        muted: false,
    };
}

function makeTrack(): Track {
    return {
        id: 'track-one',
        name: 'Track One',
        kind: 'midi',
        muted: false,
        soloed: false,
        armed: false,
        gain: 1,
        pan: 0,
        color: '#ffffff',
        clips: [makeClip('clip-one', 0), makeClip('clip-two', 4)],
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
        height: 100,
        outputId: 'master',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alternative-one',
        alternatives: [{ id: 'alternative-one', name: 'Main', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
    };
}

function NativeMenuHost() {
    const [browseOpen, setBrowseOpen] = useState(true);
    const project = projectStore.value;
    if (project === null) {
        throw new Error('project required for native menu test');
    }
    useNativeApplicationMenu(project);
    return (
        <>
            <button>Arrangement</button>
            {browseOpen ? <TimelineClipNavigator onClose={() => setBrowseOpen(false)} /> : null}
        </>
    );
}

function clipIds(): string[] {
    return trackStore.value?.tracks[0]?.clips.map((clip) => clip.id) ?? [];
}

describe('native Edit focus with the timeline clip navigator', () => {
    beforeEach(() => {
        initialPlayheadBeat = playheadPositionRef.current;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('native focus integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: false, initialized: true });
        trackStore.set({ ...defaultTrackState, tracks: [makeTrack()], selectedTrackId: 'track-one' });
        setClipSelection(['clip-one']);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        act(() => {
            clipSelectionStore.set(defaultClipSelectionState);
            trackStore.set(defaultTrackState);
        });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        playheadPositionRef.current = initialPlayheadBeat;
        native.listener = undefined;
    });

    it('keeps native Cut inside Browse, then cuts the selected clip after focus returns to arrangement', async () => {
        const dispatch = vi.spyOn(commandUseCases, 'executeUserAppAction');
        const template = createApplicationMenuTemplate({
            appName: 'Sourdaw',
            send: (intent) => native.listener?.(intent),
        });
        const edit = template.find((item) => item.label === 'Edit');
        const cut = edit?.submenu?.find((item) => item.label === 'Cut');
        const undo = edit?.submenu?.find((item) => item.label === 'Undo');
        expect(cut?.accelerator).toBe('CommandOrControl+X');
        expect(cut?.click).toBeTypeOf('function');
        expect(undo?.accelerator).toBe('CommandOrControl+Z');

        render(<NativeMenuHost />);
        const listbox = screen.getByRole('listbox', { name: 'Timeline clips' });
        expect(document.activeElement).toBe(listbox);
        expect(listbox).not.toHaveAttribute('data-canvas-editor');
        fireEvent.keyDown(listbox, { key: 'ArrowDown' });
        expect(listbox.getAttribute('aria-activedescendant')).toContain('clip-two');
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-one']);
        const historyBefore = structuredClone(undoHistoryStore.value);

        cut?.click?.();

        expect(dispatch).not.toHaveBeenCalled();
        expect(clipIds()).toEqual(['clip-one', 'clip-two']);
        expect(clipSelectionStore.value?.selectedClipIds).toEqual(['clip-one']);
        expect(undoHistoryStore.value).toEqual(historyBefore);
        expect(document.activeElement).toBe(listbox);

        fireEvent.keyDown(listbox, { key: 'Escape' });
        const arrangement = screen.getByRole('button', { name: 'Arrangement' });
        arrangement.focus();
        expect(document.activeElement).toBe(arrangement);
        cut?.click?.();

        await waitFor(() => expect(clipIds()).toEqual(['clip-two']));
        expect(dispatch).toHaveBeenCalledWith({ type: 'cutClip' });
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        act(() => undo?.click?.());
        await waitFor(() => expect(clipIds()).toEqual(['clip-one', 'clip-two']));
    });

    it('preserves the prior clip clipboard when native Cut targets Browse', () => {
        setClipSelection(['clip-two']);
        expect(copySelectedClip()).toBe(true);
        setClipSelection(['clip-one']);
        const dispatch = vi.spyOn(commandUseCases, 'executeUserAppAction');
        const template = createApplicationMenuTemplate({
            appName: 'Sourdaw',
            send: (intent) => native.listener?.(intent),
        });
        const cut = template.find((item) => item.label === 'Edit')?.submenu?.find((item) => item.label === 'Cut');
        expect(cut?.accelerator).toBe('CommandOrControl+X');

        render(<NativeMenuHost />);
        expect(document.activeElement).toBe(screen.getByRole('listbox', { name: 'Timeline clips' }));
        cut?.click?.();

        expect(dispatch).not.toHaveBeenCalled();
        expect(clipIds()).toEqual(['clip-one', 'clip-two']);
        playheadPositionRef.current = 8;
        act(() => {
            expect(pasteClip()).toBe(true);
        });
        expect(trackStore.value?.tracks[0]?.clips.some((clip) => clip.name === 'clip-two (paste)')).toBe(true);
    });
});
