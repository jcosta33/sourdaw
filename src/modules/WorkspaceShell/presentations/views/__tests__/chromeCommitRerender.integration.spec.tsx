import { Profiler, type ReactElement } from 'react';

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { AiActionHistoryPanel } from '#/modules/AiRuntime/presentations/views';
import { aiActionHistoryStore } from '#/modules/AiRuntime/stores';
import { type Clip, type Track, trackStore } from '#/modules/Arrangement/stores';
import { hydrateTracksForProject, setTrackState } from '#/modules/Arrangement/useCases';
import { UndoHistoryPanel } from '#/modules/Command/presentations/views';
import { clearUndoHistory, pushUndoEntry } from '#/modules/Command/useCases';
import { actionHistoryStore } from '#/modules/CrdtDocument/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { defaultWorkspaceState } from '../../../models/WorkspaceState';
import { workspaceStore } from '../../../stores/workspaceStore';
import { StatusBar } from '../StatusBar';
import { TransportBar } from '../TransportBar';

/**
 * One committed app action writes the track store, the undo history and the action
 * history in the same task (issue #6480). Each chrome surface must render again only
 * when the data it shows changed, so the commit task carries no unrelated React work.
 */

type RenderCounts = Record<'transportBar' | 'statusBar' | 'undoHistoryPanel' | 'actionHistoryPanel', number>;

const counts: RenderCounts = { transportBar: 0, statusBar: 0, undoHistoryPanel: 0, actionHistoryPanel: 0 };

const count = (id: keyof RenderCounts, element: ReactElement): ReactElement => (
    <Profiler
        id={id}
        onRender={() => {
            counts[id] += 1;
        }}
    >
        {element}
    </Profiler>
);

const makeTrack = (armed: boolean, clipEndBeat: number): Track => {
    const clip: Clip = ClipDummy.create({ endBeat: clipEndBeat });
    return TrackDummy.create({
        armed,
        clips: [clip],
        alternatives: [{ id: 'track-1-alternative', name: 'Main', clips: [clip] }],
    });
};

const pushUndo = (label: string): void => {
    pushUndoEntry(
        label,
        () => undefined,
        () => undefined
    );
};

const pushHistory = (id: string): void => {
    const entries = actionHistoryStore.value?.entries ?? [];
    actionHistoryStore.set({
        entries: entries.concat({
            id,
            label: `Action ${id}`,
            actionKind: 'clip.update',
            source: 'manual',
            timestamp: Date.now(),
            reverted: false,
        }),
    });
};

const setPanelOpen = (panelOpen: boolean): void => {
    const state = aiActionHistoryStore.value;
    if (state === null) {
        throw new Error('aiActionHistoryStore must be initialised');
    }
    aiActionHistoryStore.set({ ...state, panelOpen });
};

const resetCounts = (): void => {
    counts.transportBar = 0;
    counts.statusBar = 0;
    counts.undoHistoryPanel = 0;
    counts.actionHistoryPanel = 0;
};

const mountChrome = (): void => {
    render(
        <TooltipProvider delayDuration={0}>
            {count('transportBar', <TransportBar onReviewRun={() => undefined} />)}
            {count('statusBar', <StatusBar />)}
            {count('undoHistoryPanel', <UndoHistoryPanel />)}
            {count('actionHistoryPanel', <AiActionHistoryPanel />)}
        </TooltipProvider>
    );
    resetCounts();
};

const originalInnerWidth = window.innerWidth;

describe('workspace chrome around one committed action', () => {
    beforeEach(() => {
        // The expanded status bar shows the undo count inline; the compact one hides it in a menu.
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 1600 });
        clearUndoHistory();
        actionHistoryStore.set({ entries: [] });
        workspaceStore.set({ ...defaultWorkspaceState, mode: 'arrange', undoHistoryOpen: false });
        hydrateTracksForProject({ tracks: [makeTrack(false, 4)] });
        setPanelOpen(false);
        pushUndo('Earlier edit');
        pushHistory('earlier');
    });

    afterEach(() => {
        cleanup();
        Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: originalInnerWidth });
        clearUndoHistory();
        actionHistoryStore.set({ entries: [] });
        setPanelOpen(false);
        workspaceStore.set(defaultWorkspaceState);
    });

    const commitDetect = (): void => {
        act(() => {
            setTrackState({ tracks: [makeTrack(false, 8)], selectedTrackId: null });
            pushUndo('Detect transients');
            pushHistory('detect');
        });
    };

    it('leaves the transport bar untouched by a clip edit that is also undoable and logged', () => {
        mountChrome();

        commitDetect();

        expect(counts.transportBar).toBe(0);
    });

    it('leaves the closed undo history panel untouched by the same commit', () => {
        mountChrome();

        commitDetect();

        expect(counts.undoHistoryPanel).toBe(0);
    });

    it('leaves the closed action history panel untouched by the same commit', () => {
        mountChrome();

        commitDetect();

        expect(counts.actionHistoryPanel).toBe(0);
    });

    it('leaves the status bar untouched by a clip edit that adds no undo step', () => {
        mountChrome();

        act(() => {
            setTrackState({ tracks: [makeTrack(false, 8)], selectedTrackId: null });
            pushHistory('detect');
        });

        expect(counts.statusBar).toBe(0);
    });

    it('renders the status bar again when the commit adds an undo step it counts', () => {
        mountChrome();
        expect(screen.getByText('1 undo')).toBeTruthy();

        act(() => {
            pushUndo('Detect transients');
        });

        expect(screen.getByText('2 undos')).toBeTruthy();
        expect(counts.statusBar).toBeGreaterThan(0);
    });

    it('renders the transport bar again when a track arms, which it shows', () => {
        mountChrome();

        act(() => {
            setTrackState({ tracks: [makeTrack(true, 4)], selectedTrackId: null });
        });

        expect(counts.transportBar).toBeGreaterThan(0);
    });

    it('renders the transport bar again when undo becomes available, which it shows', () => {
        clearUndoHistory();
        mountChrome();

        act(() => {
            pushUndo('First edit');
        });

        expect(counts.transportBar).toBeGreaterThan(0);
    });

    it('renders the undo history panel again when it is open and a step is added', () => {
        workspaceStore.set({ ...defaultWorkspaceState, mode: 'arrange', undoHistoryOpen: true });
        mountChrome();

        act(() => {
            pushUndo('Detect transients');
        });

        expect(screen.getByText('Detect transients')).toBeTruthy();
        expect(counts.undoHistoryPanel).toBeGreaterThan(0);
    });

    it('renders the action history panel again when it is open and an entry is added', () => {
        setPanelOpen(true);
        mountChrome();

        act(() => {
            pushHistory('detect');
        });

        expect(screen.getByText('Action detect')).toBeTruthy();
        expect(counts.actionHistoryPanel).toBeGreaterThan(0);
        expect(actionHistoryStore.value?.entries.length).toBe(2);
        expect(trackStore.value?.tracks.length).toBe(1);
    });
});
