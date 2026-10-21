import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { type Clip, type Track, trackStore, takeLaneStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, resolveClipsWithComping } from '#/modules/Arrangement/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { tempoMapStore } from '#/modules/Transport/stores';
import { isRecord } from '#/utils/structuralEquality';

import { clearUndoHistory } from '../../useCases/clearUndoHistory';
import { executeAppAction } from '../../useCases/executeAppAction';
import { getExecutableCommandRegistration } from '../../useCases/getExecutableCommandRegistration';
import { getInternalUndoSessionReplayContracts } from '../../useCases/getInternalUndoSessionReplayContracts';
import { redo } from '../../useCases/redo';
import { resetActionReplayAuthority } from '../../useCases/resetActionReplayAuthority';
import { undo } from '../../useCases/undo';
import { clearHandlerRegistry, registerHandlerMap } from '../handlerRegistry';
import { hydrateUndoStoreFromSession, undoStore } from '../undoStore';

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

const sourceClip: Clip = {
    id: 'source',
    trackId: 'track-1',
    name: 'Comp source',
    startBeat: 2,
    endBeat: 8,
    type: 'audio',
    audioBufferId: 'comp-source-buffer',
    audioOffsetSeconds: 0.5,
    audioOffsetBeats: 1,
    fadeInBeats: 0,
    fadeOutBeats: 0,
    gain: 1,
    color: '#000',
    locked: false,
    muted: false,
};
const sourceTrack: Track = {
    id: 'track-1',
    name: 'Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 0.8,
    pan: 0,
    color: '#000',
    clips: [sourceClip],
    devices: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 80,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
    midiFx: [],
};

function contracts() {
    const forward = getExecutableCommandRegistration('splitClip');
    return [
        {
            actionType: forward.actionType,
            operationVersion: forward.operationVersion,
            role: 'forward' as const,
            validateArguments: forward.runtimeSchema.validate,
            validateEntry: forward.sessionEntryValidator,
        },
        ...getInternalUndoSessionReplayContracts(),
    ];
}
function ownerState() {
    return {
        raw: getCrdtDoc('root'),
        clips: trackStore.value!.tracks[0]!.clips,
        takes: takeLaneStore.value,
        audible: resolveClipsWithComping('track-1', trackStore.value!.tracks[0]!.clips),
    };
}
async function savedMirror(stack: 'past' | 'future') {
    await vi.waitFor(() => {
        const raw = sessionStorage.getItem('sourdaw-undo-session');
        if (!raw) {
            throw new Error('waiting for production session mirror');
        }
        const parsed: unknown = JSON.parse(raw);
        if (!isRecord(parsed) || !Array.isArray(parsed[stack]) || parsed[stack].length !== 1) {
            throw new Error('waiting for produced split entry');
        }
    });
    return sessionStorage.getItem('sourdaw-undo-session')!;
}

describe('split comp session hydration through registered production contracts', () => {
    let stopProjectionBridge: () => void;
    beforeEach(() => {
        sessionStorage.removeItem('sourdaw-undo-session');
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split comp session');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        stopProjectionBridge = setupProjectionBridge();
        projectCrdtToStores();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        hydrateUndoStoreFromSession(contracts());
        tempoMapStore.set({
            changes: [
                { id: 'fast', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'slow', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        trackStore.set({ tracks: [sourceTrack], selectedTrackId: 'track-1', ghostClips: [] });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'track-1',
                    takes: [
                        {
                            id: 'take',
                            clipId: 'source',
                            name: 'Selected',
                            startBeat: 2,
                            endBeat: 8,
                            selected: true,
                            sourceOffsetBeats: 2,
                        },
                    ],
                    activeCompRegions: [{ takeId: 'take', startBeat: 2, endBeat: 8 }],
                },
            ],
        });
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        stopProjectionBridge();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        sessionStorage.removeItem('sourdaw-undo-session');
    });
    it('hydrates real past and future mirrors, retaining generated-right metadata and a later right take', async () => {
        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } });
        flushAutomergeStorageWrites();
        const lane = takeLaneStore.value!.lanes[0]!;
        const right = lane.takes.find((take) => take.clipId === 'right')!;
        takeLaneStore.set({
            lanes: [
                {
                    ...lane,
                    takes: lane.takes
                        .map((take) =>
                            take.id === right.id ? { ...take, selected: false, name: 'Peer right name' } : take
                        )
                        .concat({
                            id: 'later',
                            clipId: 'right',
                            name: 'Later recording',
                            startBeat: 4,
                            endBeat: 8,
                            selected: false,
                            sourceOffsetSeconds: 3,
                        }),
                },
            ],
        });
        flushAutomergeStorageWrites();
        const after = ownerState();
        const past = await savedMirror('past');
        sessionStorage.setItem('sourdaw-undo-session', past);
        hydrateUndoStoreFromSession(contracts());
        expect(undoStore.value?.past).toHaveLength(1);
        await undo();
        flushAutomergeStorageWrites();
        expect(takeLaneStore.value!.lanes[0]!.takes.map((take) => take.id)).toEqual(['take']);
        expect(ownerState().audible.map((clip) => [clip.startBeat, clip.endBeat, clip.audioOffsetSeconds])).toEqual([
            [2, 8, 1.5],
        ]);
        const future = await savedMirror('future');
        sessionStorage.setItem('sourdaw-undo-session', future);
        hydrateUndoStoreFromSession(contracts());
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        flushAutomergeStorageWrites();
        expect(ownerState().takes).toEqual(after.takes);
        expect(ownerState().clips).toEqual(after.clips);
        expect(ownerState().audible).toEqual(after.audible);
        const raw = getCrdtDoc<{ takeLanes: typeof after.takes }>('root');
        expect(raw!.takeLanes).toEqual(after.takes);
    });
    it('keeps historical split entries with both optional take captures absent readable', async () => {
        await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } });
        const parsed: unknown = JSON.parse(await savedMirror('past'));
        if (!isRecord(parsed) || !Array.isArray(parsed.past)) {
            throw new Error('missing produced mirror');
        }
        const entry: unknown = parsed.past[0];
        if (!isRecord(entry)) {
            throw new Error('missing produced entry');
        }
        for (const action of [entry.inverseAction, entry.redoAction]) {
            if (!isRecord(action) || !isRecord(action.payload)) {
                throw new Error('missing replay action');
            }
            for (const snapshot of [action.payload.expected, action.payload.replacement]) {
                if (!isRecord(snapshot)) {
                    throw new Error('missing replay snapshot');
                }
                Reflect.deleteProperty(snapshot, 'takeLanes');
            }
        }
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(parsed));
        hydrateUndoStoreFromSession(contracts());
        expect(undoStore.value?.past).toHaveLength(1);
    });
    it.each(['version', 'unpaired', 'foreign-take', 'duplicate-take'])(
        'drops malformed %s captures on hydration without project writes',
        async (kind) => {
            await executeAppAction({ type: 'splitClip', payload: { clipId: 'source', beat: 4, rightClipId: 'right' } });
            flushAutomergeStorageWrites();
            const before = structuredClone(ownerState());
            const rawBefore = getCrdtDoc('root');
            const parsed: unknown = JSON.parse(await savedMirror('past'));
            if (!isRecord(parsed) || !Array.isArray(parsed.past)) {
                throw new Error('missing produced mirror');
            }
            const entry: unknown = parsed.past[0];
            if (
                !isRecord(entry) ||
                !isRecord(entry.inverseAction) ||
                !isRecord(entry.inverseAction.payload) ||
                !isRecord(entry.inverseAction.payload.expected)
            ) {
                throw new Error('missing inverse capture');
            }
            const snapshot = entry.inverseAction.payload.expected;
            if (!isRecord(snapshot.takeLanes) || !Array.isArray(snapshot.takeLanes.lanes)) {
                throw new Error('missing take facets');
            }
            if (kind === 'version') {
                Reflect.set(snapshot.takeLanes, 'version', 2);
            }
            if (kind === 'unpaired') {
                const replacement = entry.inverseAction.payload.replacement;
                if (!isRecord(replacement)) {
                    throw new Error('missing replacement capture');
                }
                Reflect.deleteProperty(replacement, 'takeLanes');
            }
            const lane: unknown = snapshot.takeLanes.lanes[0];
            if (!isRecord(lane) || !Array.isArray(lane.takes)) {
                throw new Error('missing lane takes');
            }
            if (kind === 'foreign-take') {
                Reflect.set(lane.takes[0], 'clipId', 'foreign');
            }
            if (kind === 'duplicate-take') {
                lane.takes.push(lane.takes[0]);
            }
            sessionStorage.setItem('sourdaw-undo-session', JSON.stringify(parsed));
            hydrateUndoStoreFromSession(contracts());
            expect(undoStore.value?.past).toEqual([]);
            expect(ownerState()).toEqual(before);
            expect(getCrdtDoc('root')).toBe(rawBefore);
        }
    );
});
