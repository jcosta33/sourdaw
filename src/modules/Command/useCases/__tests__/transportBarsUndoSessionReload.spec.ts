import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import {
    captureDurableDocumentWitness,
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getMidiGrooveHandlers, getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { getProjectHandlers } from '#/modules/Project/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { clearHandlerRegistry } from '../../stores/handlerRegistry';
import { undoStore } from '../../stores/undoStore';
import { clearUndoHistory } from '../clearUndoHistory';
import { executeAppAction } from '../executeAppAction';
import { reconcileSessionUndoForProject } from '../reconcileSessionUndoForProject';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { stampSessionUndoWitness } from '../stampSessionUndoWitness';
import { undo } from '../undo';

/**
 * A count-in or pre-roll bar change keeps its undo entry, and every older entry behind it, in the
 * session history a project reload restores (#6510).
 */

const UNDO_SESSION_KEY = 'sourdaw-undo-session';
const PROJECT_ID = 'transport-bars-session-undo-project';
const TRACK_ID = 'track-vocal';

type BarsKind = {
    readonly kind: string;
    readonly action: AppAction;
    readonly forward: AppAction['type'];
    readonly read: () => number | undefined;
    readonly initial: number;
    readonly changed: number;
};

const BARS_KINDS: readonly BarsKind[] = [
    {
        kind: 'count-in',
        action: { type: 'setCountInBars', payload: { bars: 2 } },
        forward: 'setCountInBars',
        read: () => transportStore.value?.countInBars,
        initial: 1,
        changed: 2,
    },
    {
        kind: 'pre-roll',
        action: { type: 'setPreRollBars', payload: { bars: 4 } },
        forward: 'setPreRollBars',
        read: () => transportStore.value?.preRollBars,
        initial: 2,
        changed: 4,
    },
];

function primeProject(): void {
    const track = {
        ...createTrack({ name: 'Lead Vocal', kind: 'audio', withoutDefaultDevice: true }),
        id: TRACK_ID,
    };
    trackStore.set({ tracks: [track], selectedTrackId: null });
    transportStore.set({ ...defaultTransportState, countInBars: 1, preRollBars: 2 });
}

/** The handler set a boot registers; deferred, the saved history waits for its project to be installed. */
function registerProduction(deferSessionRestore = false): void {
    clearHandlerRegistry();
    registerProductionCommandHandlers(
        [
            getArrangementHandlers(),
            getAudioRenderingHandlers(),
            getAutomationHandlers(),
            getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
            getMidiNoteTransformHandlers(),
            getMidiGrooveHandlers(),
            getProjectHandlers(),
            getTransportHandlers(),
            getYeastHandlers(),
        ],
        { deferSessionRestore }
    );
}

function reconcile(): void {
    reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
}

function savedPastTypes(): string[] {
    const saved: unknown = JSON.parse(sessionStorage.getItem(UNDO_SESSION_KEY) ?? 'null');
    if (!isRecord(saved) || !Array.isArray(saved.past)) {
        throw new Error('Expected a saved undo history');
    }
    return saved.past.map((entry: unknown) => {
        const action = isRecord(entry) ? entry.action : undefined;
        return isRecord(action) && typeof action.type === 'string' ? action.type : 'unknown';
    });
}

/** A project reload: the saved document and session history come back into a fresh boot. */
function reloadSavedProject(): string[] {
    flushAutomergeStorageWrites();
    stampSessionUndoWitness();
    const savedTypes = savedPastTypes();
    const current = getCrdtDoc('root');
    if (!current) {
        throw new Error('Expected a project to save');
    }
    const saved = Automerge.save(current);
    removeCrdtDoc('root');
    registerProduction(true);
    expect(undoStore.value).toMatchObject({ past: [], future: [] });
    replaceCrdtDoc({ id: 'root', doc: Automerge.load(saved) });
    projectCrdtToStores({ resetProjections: true });
    reconcile();
    return savedTypes;
}

function pastTypes(): string[] {
    return (undoStore.value?.past ?? []).map((entry) => (entry.kind === 'action' ? entry.action.type : entry.kind));
}

function vocalColor(): string | undefined {
    return trackStore.value?.tracks.find((track) => track.id === TRACK_ID)?.color;
}

describe('count-in and pre-roll undo entries in the history a project reload restores', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('transport bars session undo');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        clearUndoHistory();
        registerProduction();
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(UNDO_SESSION_KEY);
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it.each(BARS_KINDS)(
        'restores, undoes and redoes a $kind change behind an older edit',
        async ({ action, forward, read, initial, changed }) => {
            primeProject();
            flushAutomergeStorageWrites();
            reconcile();
            const originalColor = vocalColor();

            await executeAppAction({ type: 'setTrackColor', payload: { trackId: TRACK_ID, color: '#ff5500' } });
            await executeAppAction(structuredClone(action));
            expect(read()).toBe(changed);

            const savedTypes = reloadSavedProject();

            expect(savedTypes).toEqual(['setTrackColor', forward]);
            expect(pastTypes()).toEqual(['setTrackColor', forward]);
            expect(read()).toBe(changed);

            await undo();
            expect(read()).toBe(initial);
            expect(vocalColor()).toBe('#ff5500');
            await redo();
            expect(read()).toBe(changed);
            await undo();
            expect(read()).toBe(initial);

            await undo();
            expect(vocalColor()).toBe(originalColor);
            expect(pastTypes()).toEqual([]);
        }
    );
});
