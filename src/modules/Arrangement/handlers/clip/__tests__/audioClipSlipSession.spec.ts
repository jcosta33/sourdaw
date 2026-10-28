import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoHistoryStore } from '#/modules/Command/stores';
import {
    executeAppAction,
    isExecutableAppActionType,
    redo,
    registerProductionCommandHandlers,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';
import { isRecord } from '#/utils/structuralEquality';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { type TakeLane } from '../../../models/TakeLane';
import { createTrack, type Track } from '../../../models/Track';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { audioClipSlipOwner } from '../../../useCases/clipEditing/audioClipSlipOwner';
import { audioClipSlipState } from '../../../useCases/clipEditing/audioClipSlipState';
import { audioClipStartTrimState } from '../../../useCases/clipEditing/audioClipStartTrimState';
import { prepareAudioClipSlip } from '../../../useCases/clipEditing/prepareAudioClipSlip';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { handleRestoreAudioClipSlip } from '../handleRestoreAudioClipSlip';
import { handleSlipClipContent } from '../handleSlipClipContent';

vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof Automerge>();
    return { ...actual, getObjectId: vi.fn(actual.getObjectId) };
});

const sessionKey = 'sourdaw-undo-session';
type Root = { tracks: { tracks: Track[] }; takeLanes: { lanes: TakeLane[] } };
let stopBridge: () => void = () => undefined;

function register() {
    clearHandlerRegistry();
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

function reload() {
    flushAutomergeStorageWrites();
    const root = getCrdtDoc('root');
    if (!root) {
        throw new Error('Expected the real project document');
    }
    const loaded = Automerge.load(Automerge.save(root));
    expect(loaded).toEqual(root);
    replaceCrdtDocInLineage({ id: 'root', doc: loaded });
    projectCrdtToStores({ resetProjections: true });
    register();
}

function capture() {
    const description = handleSlipClipContent.describe({
        type: 'slipClipContent',
        payload: { clipId: 'c', clipType: 'audio', offset: 0.7 },
    });
    if (
        description.inverseAction?.type !== 'restoreAudioClipSlip' ||
        description.redoAction?.type !== 'restoreAudioClipSlip'
    ) {
        throw new Error('Expected the source owner to capture both replay legs');
    }
    return { inverse: description.inverseAction, redo: description.redoAction };
}

function state() {
    return structuredClone({ clip: trackStore.value!.tracks[0]!.clips[0]!, lanes: takeLaneStore.value!.lanes });
}

describe('audio slip exact source session replay', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('canonical audio slip session');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem(sessionKey);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        const clip = ClipDummy.create({
            id: 'c',
            trackId: 't',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            audioOffsetBeats: 0.5,
            audioOffsetSeconds: 0.25,
        });
        trackStore.set({
            tracks: [{ ...createTrack({ id: 't', name: 'Audio', kind: 'audio' }), clips: [clip] }],
            selectedTrackId: 't',
            ghostClips: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 't',
                    takes: [
                        { id: 'manual', clipId: 'c', name: 'Manual', startBeat: 0, endBeat: 8, selected: true },
                        {
                            id: 'placed',
                            clipId: 'c',
                            name: 'Pass',
                            startBeat: 0,
                            endBeat: 8,
                            selected: false,
                            sourceOffsetBeats: 4,
                            passAnchorSeconds: 1,
                            passDepthSeconds: 2,
                            passSourceEndSeconds: 3,
                        },
                    ],
                    activeCompRegions: [{ takeId: 'manual', startBeat: 1, endBeat: 3 }],
                },
            ],
        });
        flushAutomergeStorageWrites();
        stopBridge = setupProjectionBridge();
        projectCrdtToStores();
        register();
    });

    afterEach(() => {
        stopBridge();
        clearHandlerRegistry();
        undoHistoryStore.set({ past: [], future: [] });
        sessionStorage.removeItem(sessionKey);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        Container.clear();
    });

    it('restores exact source and comp presence through binary/session Undo and Redo, retaining peer facets', async () => {
        const before = state();
        await executeAppAction(
            { type: 'slipClipContent', payload: { clipId: 'c', clipType: 'audio', offset: 0.7 } },
            { source: 'manual' }
        );
        const after = state();
        expect(after.clip.audioOffsetSeconds).toBeCloseTo(0.35);
        expect(after.clip.audioUnwrappedOffsetSeconds).toBeCloseTo(0.35);
        expect(after.lanes[0]!.takes[1]).toEqual({
            ...before.lanes[0]!.takes[1],
            passOriginBeat: 0,
            passOriginSourceSeconds: 0.35,
        });
        await vi.waitFor(() => {
            const raw = sessionStorage.getItem(sessionKey);
            expect(raw).not.toBeNull();
            const saved: unknown = JSON.parse(raw!);
            if (!isRecord(saved) || !Array.isArray(saved.past)) {
                throw new Error('Expected saved past entries');
            }
            expect(saved.past).toHaveLength(1);
        });
        reload();
        expect(undoHistoryStore.value?.past).toHaveLength(1);
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (root) => {
                root.tracks.tracks[0]!.clips[0]!.gain = 0.6;
                root.takeLanes.lanes[0]!.takes[0]!.name = 'Peer renamed';
                root.takeLanes.lanes[0]!.takes.push({
                    id: 'peer',
                    clipId: 'other',
                    name: 'Peer',
                    startBeat: 20,
                    endBeat: 24,
                    selected: false,
                });
                root.takeLanes.lanes[0]!.activeCompRegions.push({ takeId: 'peer', startBeat: 20, endBeat: 24 });
                root.takeLanes.lanes[0]!.baseGapAudioSources!.push({
                    clipId: 'other',
                    startBeat: 20,
                    endBeat: 24,
                    audioSource: {
                        startBeat: 20,
                        audioOffsetSeconds: 7,
                        audioLoopStartSeconds: 7,
                        audioLoopPassEntrySeconds: 7,
                        audioLoopPassOriginBeat: 20,
                        loopOriginBeat: 20,
                        loopLength: 4,
                    },
                });
            },
        });
        projectCrdtToStores();
        expect((await undo()).headConsumed).toBe(true);
        const undone = state();
        expect(undone.clip).toEqual({ ...before.clip, gain: 0.6 });
        expect(undone.lanes[0]!.takes[0]!.name).toBe('Peer renamed');
        expect(undone.lanes[0]!.takes[1]).toEqual(before.lanes[0]!.takes[1]);
        expect(undone.lanes[0]!.activeCompRegions[0]).toEqual(before.lanes[0]!.activeCompRegions[0]);
        expect(undone.lanes[0]!.activeCompRegions[1]).toEqual({ takeId: 'peer', startBeat: 20, endBeat: 24 });
        expect(undone.lanes[0]!.baseGapAudioSources).toHaveLength(1);
        expect(undone.lanes[0]!.baseGapAudioSources![0]!.clipId).toBe('other');
        expect(undone.lanes[0]!.takes[2]!.id).toBe('peer');
        await vi.waitFor(() => {
            const saved: unknown = JSON.parse(sessionStorage.getItem(sessionKey)!);
            if (!isRecord(saved) || !Array.isArray(saved.future)) {
                throw new Error('Expected saved future entries');
            }
            expect(saved.future).toHaveLength(1);
        });
        reload();
        await redo();
        const redone = state();
        expect(redone.clip).toEqual({ ...after.clip, gain: 0.6 });
        expect(redone.lanes[0]!.activeCompRegions[0]).toEqual(after.lanes[0]!.activeCompRegions[0]);
        expect(redone.lanes[0]!.activeCompRegions[1]).toEqual(undone.lanes[0]!.activeCompRegions[1]);
        expect(redone.lanes[0]!.baseGapAudioSources?.filter((tile) => tile.clipId === 'c')).toEqual(
            after.lanes[0]!.baseGapAudioSources
        );
        expect(redone.lanes[0]!.baseGapAudioSources?.find((tile) => tile.clipId === 'other')).toEqual(
            undone.lanes[0]!.baseGapAudioSources![0]
        );
        expect(redone.lanes[0]!.takes[0]!.name).toBe('Peer renamed');
        expect(redone.lanes[0]!.takes[2]!.id).toBe('peer');
    });

    it('requires the lawful complete saved pair and keeps replay out of public discovery', () => {
        const pair = capture();
        const action: AppAction = { type: 'slipClipContent', payload: { clipId: 'c', clipType: 'audio', offset: 0.7 } };
        const entry = { action, inverseAction: pair.inverse, redoAction: pair.redo };
        expect(audioClipSlipState.isSessionEntry(entry)).toBe(true);
        expect(isExecutableAppActionType(pair.inverse.type)).toBe(false);
        expect(
            audioClipSlipState.isSessionEntry({
                ...entry,
                redoAction: { ...pair.redo, payload: { ...pair.redo.payload, offset: 0.8 } },
            })
        ).toBe(false);
        const forged = structuredClone(pair.inverse.payload);
        forged.after.clip.gain = 99;
        expect(handleRestoreAudioClipSlip.validateSessionActionArguments?.(forged)).toBe(false);
        for (const field of audioClipSlipState.optionalFields.filter((key) => key !== 'audioOffsetBeats')) {
            expect(
                handleRestoreAudioClipSlip.validateSessionActionArguments?.({
                    ...pair.inverse.payload,
                    after: {
                        ...pair.inverse.payload.after,
                        clip: { ...pair.inverse.payload.after.clip, [field]: undefined },
                    },
                })
            ).toBe(false);
        }
    });

    it.each(['lane', 'take', 'comp region'])(
        'refuses commit validation when the %s has no Automerge incarnation',
        async (kind) => {
            const before = state();
            const clock = audioClipStartTrimState.captureClock();
            const after = prepareAudioClipSlip(before, 0.7, audioClipStartTrimState.timeline(clock))!;
            const proof = audioClipSlipOwner.captureCommitValidation(before, after, clock);
            expect(proof).not.toBeNull();
            proof!.release();
            const actual = await vi.importActual<typeof Automerge>('@automerge/automerge');
            let missingOwnerObserved = false;
            vi.mocked(Automerge.getObjectId).mockImplementation((value) => {
                if (
                    isRecord(value) &&
                    ((kind === 'lane' && value.id === 'lane') ||
                        (kind === 'take' && value.id === 'manual') ||
                        (kind === 'comp region' && value.takeId === 'manual'))
                ) {
                    missingOwnerObserved = true;
                    return null;
                }
                return actual.getObjectId(value);
            });
            try {
                expect(audioClipSlipOwner.captureCommitValidation(before, after, clock)).toBeNull();
                expect(missingOwnerObserved).toBe(true);
                expect(state()).toEqual(before);
            } finally {
                vi.mocked(Automerge.getObjectId).mockImplementation(actual.getObjectId);
            }
        }
    );

    it('refuses a changed media owner or clock and a same-value raw incarnation replacement', () => {
        const before = state();
        const clock = audioClipStartTrimState.captureClock();
        const after = prepareAudioClipSlip(before, 0.7, audioClipStartTrimState.timeline(clock))!;
        const proof = audioClipSlipOwner.captureCommitValidation(before, after, clock);
        expect(proof).not.toBeNull();
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (root) => {
                root.tracks.tracks[0]!.clips[0] = structuredClone(before.clip);
            },
        });
        expect(proof!.beforeCommit()).toBe('Audio trim owner changed before commit');
        proof!.release();
        projectCrdtToStores();
        expect(audioClipSlipOwner.matches(before, { ...clock, tempo: 60 })).toBe(false);
        mutateCrdtDoc<Root>({
            id: 'root',
            changeFn: (root) => {
                root.tracks.tracks[0]!.clips[0]!.audioBufferId = 'replacement';
            },
        });
        projectCrdtToStores();
        expect(audioClipSlipOwner.matches(before, clock)).toBe(false);
    });
});
