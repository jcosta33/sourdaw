import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEventBus } from '#/infra/events/createEventBus';
import {
    setNotificationEventBus,
    type NotifyPayload,
    type ConfirmPayload,
    type PromptPayload,
} from '#/utils/Notification/notificationEventBus';
import { Container } from '#/infra/di/Container';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, undoHistoryStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    isAppActionConflictError,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    getCrdtDoc,
    getDrumPreviewBranchHandlers,
    projectCrdtToStores,
    replaceCrdtDocInLineage,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { getAutomationHandlers } from '#/modules/Automation/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import {
    captureAudioSourceState,
    captureAudioSourceSnapshot,
    projectAudioLoopPassSegments,
} from '#/utils/audioSourceTime';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type TakeLane, type CompRegion } from '../../../models/TakeLane';
import { takeLaneStore, type TakeLaneStoreState } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { compRegionInterval } from '../../../useCases/comping/compRegionInterval';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { captureCompAudioSourceInputProof } from '../../../stores/compAudioSourceInputs';
import { liveCompAudioSourceInputs } from '../../../useCases/comping/liveCompAudioSourceInputs';
import { removeCompRegion } from '../../../useCases/comping/removeCompRegion';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';

const originalRegion: CompRegion = { startBeat: 0, endBeat: 8, takeId: 'a' };
const originalSource = {
    startBeat: 0,
    audioOffsetSeconds: 0,
    audioLoopStartSeconds: 0,
    audioLoopPassEntrySeconds: 0,
    audioLoopPassOriginBeat: 0,
    loopOriginBeat: 0,
    loopLength: 4,
};
const points = [0, 0.5, 2, 3.5, 4, 5.5, 7.5];
function lane(): TakeLane {
    const value = takeLaneStore.value?.lanes[0];
    if (!value) throw new Error('Expected the audio comp lane');
    return value;
}
function authority(): void {
    flushAutomergeStorageWrites();
    expect(getCrdtDoc<{ takeLanes: TakeLaneStoreState }>('root')?.takeLanes).toEqual(takeLaneStore.value);
}
function sourcePoints(): number[] {
    const clips = trackStore.value!.tracks[0]!.clips;
    const programme = resolveClipsWithComping('audio', clips);
    return points.map((beat) => {
        const clip = programme.find((part) => part.id === 'source' && part.startBeat <= beat && beat < part.endBeat);
        if (!clip) throw new Error(`No source fragment at beat ${beat}`);
        const part = projectAudioLoopPassSegments({
            clip,
            loopLengthBeats: clip.loopLength ?? clip.endBeat - clip.startBeat,
            iterationStartBeat: beat,
            iterationEndBeat: beat + 0.01,
            stretchRatio: 2,
            tempoAtClipStart: 120,
            secondsAtBeat: (at) => at / 2,
        })[0];
        if (!part) throw new Error(`No source projection at beat ${beat}`);
        return Math.round(part.sourceStartSeconds * 48000);
    });
}
async function selectMiddle(): Promise<void> {
    await executeAppAction({
        type: 'setCompRegion',
        payload: { trackId: 'audio', startBeat: 1, endBeat: 2, takeId: 'b' },
    });
    expect(undoStore.value?.past).toHaveLength(1);
    authority();
}
function peerSelection(startBeat: number, endBeat: number, takeId: string): void {
    const patch = compRegionInterval.capturePatch({ trackId: 'audio', startBeat, endBeat, takeId });
    if (!patch) throw new Error('Expected a real peer interval patch');
    expect(compRegionInterval.applyPatch(patch)).toBe('written');
    authority();
}

describe('bounded audio comp source promotion', () => {
    beforeEach(() => {
        Container.clear();
        setNotificationEventBus(
            createEventBus<{ 'ui.notify': NotifyPayload; 'ui.confirm': ConfirmPayload; 'ui.prompt': PromptPayload }>()
        );
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('bounded audio comp source');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        sessionStorage.removeItem('sourdaw-undo-session');
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
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        const source = ClipDummy.create({
            id: 'source',
            trackId: 'audio',
            type: 'audio',
            startBeat: 0,
            endBeat: 8,
            audioBufferId: 'buffer',
            audioOffsetBeats: 0,
            loopEnabled: true,
            loopLength: 4,
            loopOriginBeat: 0,
            stretchMode: 'timestretch',
            stretchRatio: 2,
        });
        const outside = ClipDummy.create({
            id: 'outside',
            trackId: 'audio',
            type: 'audio',
            startBeat: 20,
            endBeat: 24,
            audioBufferId: 'outside-buffer',
        });
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'audio', kind: 'audio', clips: [source, outside] })],
            selectedTrackId: 'audio',
            ghostClips: [],
        });
        takeLaneStore.set({
            lanes: [
                {
                    id: 'lane',
                    trackId: 'audio',
                    takes: [
                        ...['a', 'b', 'c'].map((id, index) => ({
                            id,
                            clipId: source.id,
                            name: id,
                            startBeat: 0,
                            endBeat: 8,
                            selected: false,
                            sourceOffsetBeats: index * 8,
                        })),
                        { id: 'd', clipId: outside.id, name: 'D', startBeat: 20, endBeat: 24, selected: false },
                    ],
                    activeCompRegions: [structuredClone(originalRegion)],
                },
            ],
        });
        authority();
    });
    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        takeLaneStore.set({ lanes: [] });
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        tempoMapStore.set({ changes: [] });
        transportStore.set({ ...defaultTransportState });
        sessionStorage.removeItem('sourdaw-undo-session');
        removeCrdtDoc('root');
        Container.clear();
    });

    it('retains the original source/grid on both sides and restores exact clean absence through Undo/Redo', async () => {
        const before = structuredClone(lane());
        const samples = sourcePoints();
        await selectMiddle();
        expect(sourcePoints()).toEqual(samples);
        expect(
            lane()
                .activeCompRegions.filter((region) => region.takeId === 'a')
                .map((region) => region.audioSource)
        ).toEqual([originalSource, originalSource]);
        const after = structuredClone(lane());
        expect((await undo()).headConsumed).toBe(true);
        expect(lane()).toEqual(before);
        authority();
        await redo();
        expect(lane()).toEqual(after);
        expect(sourcePoints()).toEqual(samples);
        authority();
    });

    it('preserves a later peer selection inside the original source owner while Undo/Redo retains physical R', async () => {
        await selectMiddle();
        peerSelection(6, 7, 'c');
        const peer = structuredClone(lane().activeCompRegions.find((region) => region.takeId === 'c'));
        expect((await undo()).headConsumed).toBe(true);
        expect(lane().activeCompRegions.find((region) => region.takeId === 'c')).toEqual(peer);
        expect(
            lane()
                .activeCompRegions.filter((region) => region.takeId === 'a')
                .map((region) => region.audioSource)
        ).toEqual([originalSource, originalSource]);
        await redo();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(lane().activeCompRegions.find((region) => region.takeId === 'c')).toEqual(peer);
        authority();
    });

    it('restores clean local absence while preserving independent peer selection and gap tile array presence', async () => {
        await selectMiddle();
        peerSelection(20, 21, 'd');
        const peer = structuredClone(lane().activeCompRegions.find((region) => region.takeId === 'd'));
        const tiles = structuredClone(lane().baseGapAudioSources);
        expect(tiles?.some((tile) => tile.clipId === 'outside')).toBe(true);
        expect((await undo()).headConsumed).toBe(true);
        expect(lane().activeCompRegions).toEqual([originalRegion, peer]);
        expect(lane().baseGapAudioSources).toEqual(tiles);
        authority();
        await redo();
        expect(lane().baseGapAudioSources).toEqual(tiles);
        authority();
    });

    it('keeps the selected phrase when a peer promotes the source inputs and changes tempo before Undo', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    takes: lane().takes.map((take) => (take.id === 'a' ? { ...take, sourceOffsetBeats: 4 } : take)),
                    activeCompRegions: [{ startBeat: 6, endBeat: 8, takeId: 'a' }],
                },
            ],
        });
        authority();
        await executeAppAction({
            type: 'setCompRegion',
            payload: { trackId: 'audio', startBeat: 7, endBeat: 7.5, takeId: 'b' },
        });
        const entryFrame = () => {
            const fragment = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips).find(
                (part) => part.id === 'source' && part.startBeat === 6
            );
            if (!fragment || fragment.audioOffsetSeconds === undefined)
                throw new Error('Expected a real selected audio entry');
            return Math.round(fragment.audioOffsetSeconds * 48000);
        };
        const beforeFrame = entryFrame();
        expect(beforeFrame).toBe((2 + 6 / 2) * 48000);
        const current = lane();
        const baseTiles = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)
            .filter(
                (part) =>
                    !current.activeCompRegions.some(
                        (region) => region.startBeat < part.endBeat && region.endBeat > part.startBeat
                    )
            )
            .map((part) => {
                const audioSource = captureAudioSourceSnapshot(
                    part,
                    part.loopLength ?? part.endBeat - part.startBeat,
                    120
                );
                if (!audioSource) throw new Error('Expected the committed old-map base source');
                return { clipId: part.id, startBeat: part.startBeat, endBeat: part.endBeat, audioSource };
            });
        const tracks = trackStore.value!;
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) => {
                    const source = captureAudioSourceState(clip, clip.loopLength ?? clip.endBeat - clip.startBeat, 120);
                    if (!source) throw new Error('Expected old-map clip source inputs');
                    return { ...clip, ...source };
                }),
            })),
        });
        takeLaneStore.set({
            lanes: [
                {
                    ...current,
                    takes: current.takes.map((take) =>
                        take.sourceOffsetBeats === undefined
                            ? take
                            : { ...take, sourceOffsetSeconds: take.sourceOffsetBeats / 2 }
                    ),
                    baseGapAudioSources: baseTiles,
                },
            ],
        });
        transportStore.set({ ...transportStore.value!, tempo: 240 });
        authority();
        expect(entryFrame()).toBe(beforeFrame);
        expect((await undo()).headConsumed).toBe(true);
        expect(entryFrame()).toBe(beforeFrame);
        authority();
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(1);
        await redo();
        expect(entryFrame()).toBe(beforeFrame);
        authority();
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
    });

    it('reprojects pending Undo from a tempo-only peer document change with identical take-lane bytes', async () => {
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    takes: lane().takes.map((take) => (take.id === 'a' ? { ...take, sourceOffsetBeats: 4 } : take)),
                    activeCompRegions: [{ startBeat: 6, endBeat: 8, takeId: 'a' }],
                },
            ],
        });
        authority();
        await executeAppAction({
            type: 'setCompRegion',
            payload: { trackId: 'audio', startBeat: 7, endBeat: 7.5, takeId: 'b' },
        });
        const historyEntry = undoHistoryStore.value?.past.at(-1);
        const inverse = historyEntry?.kind === 'action' ? historyEntry.inverseAction : undefined;
        if (inverse?.type !== 'restoreCompRegionInterval') throw new Error('Expected the real saved interval inverse');
        const original = getCrdtDoc('root');
        if (!original) throw new Error('Expected authoritative project inputs');
        const doc = JSON.parse(JSON.stringify(original));
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => changeFn(doc),
        });
        takeLaneStore.hydrate();
        expect(compRegionInterval.applyPatch(inverse.payload)).toBe('written');
        expect(lane().activeCompRegions).toEqual([{ startBeat: 6, endBeat: 8, takeId: 'a' }]);
        const rawTakeLaneBytes = JSON.stringify(doc.takeLanes);
        doc.transport.tempo = 240;
        transportStore.hydrate();
        takeLaneStore.hydrate();
        expect(JSON.stringify(doc.takeLanes)).toBe(rawTakeLaneBytes);
        const entry = resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips).find(
            (part) => part.startBeat === 6
        );
        expect(entry?.audioOffsetSeconds).toBe(5);
        expect(lane().activeCompRegions.every((region) => region.audioSource?.audioOffsetSeconds === 5)).toBe(true);
        flushAutomergeStorageWrites();
        expect(doc.takeLanes).toEqual(takeLaneStore.value);
        expect(doc.transport.tempo).toBe(240);
    });

    it('removes an audio comp interval through the typed action with source tiles and real Undo/Redo', async () => {
        const before = structuredClone(lane());
        await executeAppAction({ type: 'removeCompRegion', payload: { trackId: 'audio', startBeat: 0 } });
        expect(lane().activeCompRegions).toEqual([]);
        expect(
            lane().baseGapAudioSources?.some(
                (tile) => tile.clipId === 'source' && tile.startBeat === 0 && tile.endBeat === 8
            )
        ).toBe(true);
        expect(undoHistoryStore.value?.past.at(-1)?.kind).toBe('action');
        const after = structuredClone(lane());
        authority();
        expect((await undo()).headConsumed).toBe(true);
        expect(lane()).toEqual(before);
        authority();
        await redo();
        expect(lane()).toEqual(after);
        authority();
    });

    it('keeps later edits to another lane through real user removal and typed Undo/Redo', async () => {
        const otherClip = ClipDummy.create({ id: 'other-clip', trackId: 'other-track' });
        trackStore.set({
            ...trackStore.value!,
            tracks: [...trackStore.value!.tracks, TrackDummy.create({ id: 'other-track', clips: [otherClip] })],
        });
        const otherLane: TakeLane = {
            id: 'other-lane',
            trackId: 'other-track',
            takes: [
                { id: 'other-take', clipId: otherClip.id, name: 'Original', startBeat: 0, endBeat: 4, selected: false },
            ],
            activeCompRegions: [{ startBeat: 0, endBeat: 4, takeId: 'other-take' }],
        };
        takeLaneStore.set({ lanes: [lane(), otherLane] });
        authority();
        removeCompRegion('audio', 0);
        await vi.waitFor(() => expect(undoStore.value?.past).toHaveLength(1));
        expect(lane().activeCompRegions).toEqual([]);
        const changedOther = {
            ...otherLane,
            takes: otherLane.takes.map((take) => ({ ...take, name: 'Renamed later' })),
        };
        takeLaneStore.set({ lanes: [lane(), changedOther] });
        authority();
        expect((await undo()).headConsumed).toBe(true);
        expect(lane().activeCompRegions).toEqual([originalRegion]);
        expect(takeLaneStore.value?.lanes[1]).toEqual(changedOther);
        authority();
        await redo();
        expect(lane().activeCompRegions).toEqual([]);
        expect(takeLaneStore.value?.lanes[1]).toEqual(changedOther);
        authority();
    });

    it.each(['removed', 'retargeted'] as const)(
        'refuses removal Undo for a %s source owner without consuming history',
        async (kind) => {
            await executeAppAction({ type: 'removeCompRegion', payload: { trackId: 'audio', startBeat: 0 } });
            if (kind === 'removed')
                trackStore.set({
                    ...trackStore.value!,
                    tracks: trackStore.value!.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.filter((clip) => clip.id !== 'source'),
                    })),
                });
            else
                takeLaneStore.set({
                    lanes: [
                        {
                            ...lane(),
                            takes: lane().takes.map((take) =>
                                take.id === 'a' ? { ...take, clipId: 'outside' } : take
                            ),
                        },
                    ],
                });
            authority();
            const before = structuredClone(lane());
            expect((await undo()).headConsumed).toBe(false);
            expect(lane()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            authority();
        }
    );

    it.each([
        { trackId: 'missing', startBeat: 0 },
        { trackId: 'audio', startBeat: 99 },
        { trackId: 'audio', startBeat: 1 },
    ])('ignores a missing exact user removal target %j without history or writes', (target) => {
        const before = structuredClone(takeLaneStore.value);
        removeCompRegion(target.trackId, target.startBeat);
        expect(takeLaneStore.value).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(0);
        expect(undoStore.value?.future).toHaveLength(0);
        authority();
    });

    it('replays removal source values and optional absence after saving and reopening the project history', async () => {
        const before = structuredClone(lane());
        await executeAppAction({ type: 'removeCompRegion', payload: { trackId: 'audio', startBeat: 0 } });
        const after = structuredClone(lane());
        authority();
        await vi.waitFor(() => {
            const mirror = sessionStorage.getItem('sourdaw-undo-session');
            expect(mirror).not.toBeNull();
            expect(JSON.parse(mirror!).past).toHaveLength(1);
        });
        const doc = getCrdtDoc('root');
        if (!doc) throw new Error('Expected the committed project');
        replaceCrdtDocInLineage({ id: 'root', doc: Automerge.load(Automerge.save(doc)) });
        projectCrdtToStores({ resetProjections: true });
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
        expect(undoStore.value?.past).toHaveLength(1);
        expect(lane()).toEqual(after);
        expect((await undo()).headConsumed).toBe(true);
        expect(lane()).toEqual(before);
        authority();
        await redo();
        expect(lane()).toEqual(after);
        authority();
    });

    it('refuses removal Undo after a peer changes the newly exposed base source tile', async () => {
        await executeAppAction({ type: 'removeCompRegion', payload: { trackId: 'audio', startBeat: 0 } });
        expect(lane().activeCompRegions).toEqual([]);
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    baseGapAudioSources: lane().baseGapAudioSources?.map((tile) => ({
                        ...tile,
                        audioSource: { ...tile.audioSource, audioOffsetSeconds: 19 },
                    })),
                },
            ],
        });
        authority();
        const before = structuredClone(lane());
        expect((await undo()).headConsumed).toBe(false);
        expect(lane()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        authority();
    });

    it.each(['selected region', 'base tile'] as const)(
        'refuses Undo after a peer replaces the actual %s asset',
        async (kind) => {
            if (kind === 'selected region') await selectMiddle();
            else await executeAppAction({ type: 'removeCompRegion', payload: { trackId: 'audio', startBeat: 0 } });
            const tracks = trackStore.value!;
            trackStore.set({
                ...tracks,
                tracks: tracks.tracks.map((track) => ({
                    ...track,
                    clips: track.clips.map((clip) =>
                        clip.id === 'source' ? { ...clip, audioBufferId: 'peer-buffer' } : clip
                    ),
                })),
            });
            authority();
            expect(
                resolveClipsWithComping('audio', trackStore.value!.tracks[0]!.clips)
                    .filter((part) => part.id === 'source')
                    .every((part) => part.audioBufferId === 'peer-buffer')
            ).toBe(true);
            const before = structuredClone(takeLaneStore.value);
            const document = getCrdtDoc('root');
            expect((await undo()).headConsumed).toBe(false);
            expect(getCrdtDoc('root')).toBe(document);
            expect(takeLaneStore.value).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            authority();
        }
    );

    it('keeps an unrelated asset replacement while undoing the original source owner', async () => {
        await selectMiddle();
        const tracks = trackStore.value!;
        trackStore.set({
            ...tracks,
            tracks: tracks.tracks.map((track) => ({
                ...track,
                clips: track.clips.map((clip) =>
                    clip.id === 'outside' ? { ...clip, audioBufferId: 'peer-outside-buffer' } : clip
                ),
            })),
        });
        authority();
        expect((await undo()).headConsumed).toBe(true);
        expect(lane().activeCompRegions).toEqual([originalRegion]);
        expect(trackStore.value!.tracks[0]!.clips.find((clip) => clip.id === 'outside')?.audioBufferId).toBe(
            'peer-outside-buffer'
        );
        authority();
    });

    it.each(['cross-owner', 'outside interval', 'coherent source'] as const)(
        'refuses forged %s promotion metadata even when saved inverse and Redo agree',
        async (kind) => {
            await selectMiddle();
            const entry = undoHistoryStore.value?.past.at(-1);
            if (
                entry?.kind !== 'action' ||
                entry.action.type !== 'setCompRegion' ||
                !compRegionInterval.isCompleteSetPayload(entry.action.payload)
            )
                throw new Error('Expected a complete owner-prepared comp entry');
            const { takeId, ...patch } = entry.action.payload;
            const audioSourcePromotions = patch.audioSourcePromotions?.map((delta) => {
                if (delta.expected.kind !== 'take' || delta.replacement.kind !== 'take') return delta;
                if (kind === 'cross-owner')
                    return {
                        ...delta,
                        expected: { ...delta.expected, takeId: 'c' },
                        replacement: { ...delta.replacement, takeId: 'c' },
                    };
                if (kind === 'outside interval')
                    return {
                        ...delta,
                        expected: { ...delta.expected, startBeat: 20, endBeat: 24 },
                        replacement: { ...delta.replacement, startBeat: 20, endBeat: 24 },
                        sourceInputs: { ...delta.sourceInputs, startBeat: 20, endBeat: 24 },
                    };
                const alter = (owner: typeof delta.expected) =>
                    owner.audioSource
                        ? { ...owner, audioSource: { ...owner.audioSource, audioOffsetSeconds: 19 } }
                        : owner;
                return { ...delta, expected: alter(delta.expected), replacement: alter(delta.replacement) };
            });
            const recomputedPromotions = audioSourcePromotions?.map((delta) => {
                const sourceInputs = captureCompAudioSourceInputProof(
                    lane(),
                    delta.expected,
                    liveCompAudioSourceInputs()
                );
                if (!sourceInputs) throw new Error('Expected caller-recomputable current input fingerprint');
                return { ...delta, sourceInputs };
            });
            const forged = { ...patch, audioSourcePromotions: recomputedPromotions };
            const inverse = compRegionInterval.reversePatch(forged);
            const forgedEntry = {
                action: { type: 'setCompRegion' as const, payload: { ...forged, takeId } },
                inverseAction: { type: 'restoreCompRegionInterval' as const, payload: inverse },
                redoAction: { type: 'restoreCompRegionInterval' as const, payload: forged },
            };
            const before = structuredClone(takeLaneStore.value);
            const document = getCrdtDoc('root');
            let refused = false;
            try {
                await executeAppAction(forgedEntry.inverseAction);
            } catch (error) {
                if (!isAppActionConflictError(error)) throw error;
                refused = true;
            }
            expect(refused).toBe(true);
            expect(compRegionInterval.isSessionEntry(forgedEntry)).toBe(kind === 'coherent source');
            expect(getCrdtDoc('root')).toBe(document);
            expect(takeLaneStore.value).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            authority();
        }
    );

    it('refuses a same-owner source change on a surviving complement without consuming history', async () => {
        await selectMiddle();
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    activeCompRegions: lane().activeCompRegions.map((region, index) =>
                        index === 0 && region.audioSource
                            ? { ...region, audioSource: { ...region.audioSource, audioOffsetSeconds: 19 } }
                            : region
                    ),
                },
            ],
        });
        authority();
        const before = structuredClone(lane());
        const document = getCrdtDoc('root');
        expect((await undo()).headConsumed).toBe(false);
        expect(getCrdtDoc('root')).toBe(document);
        expect(lane()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        authority();
    });

    it('recomputes complement support on saved Redo and refuses caller-supplied private authorization', async () => {
        await selectMiddle();
        expect((await undo()).headConsumed).toBe(true);
        const entry = undoHistoryStore.value?.future.at(-1);
        if (entry?.kind !== 'action' || entry.redoAction?.type !== 'restoreCompRegionInterval')
            throw new Error('Expected a saved comp Redo');
        const patch = entry.redoAction.payload;
        const audioSourcePromotions = patch.audioSourcePromotions?.map((delta) => ({
            ...delta,
            replacement: {
                ...delta.replacement,
                ...(delta.replacement.audioSource
                    ? { audioSource: { ...delta.replacement.audioSource, audioOffsetSeconds: 19 } }
                    : {}),
            },
        }));
        const forged = { ...patch, audioSourcePromotions };
        const before = structuredClone(lane());
        const document = getCrdtDoc('root');
        for (const payload of [
            forged,
            {
                ...forged,
                sourceAuthorizations: audioSourcePromotions?.map((delta) => ({
                    owner: delta.expected,
                    source: delta.replacement.audioSource,
                    sourceInputs: delta.sourceInputs,
                    operation: 'promote',
                })),
            },
        ]) {
            let refused = false;
            try {
                await executeAppAction({ type: 'restoreCompRegionInterval', payload });
            } catch (error) {
                if (!isAppActionConflictError(error)) throw error;
                refused = true;
            }
            expect(refused).toBe(true);
            expect(getCrdtDoc('root')).toBe(document);
            expect(lane()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);
        }
        await redo();
        expect(undoStore.value?.past).toHaveLength(1);
        authority();
    });

    it('allows a structurally valid historical source snapshot wholly inside the requested owner', async () => {
        await executeAppAction({
            type: 'setCompRegion',
            payload: { trackId: 'audio', startBeat: 0, endBeat: 8, takeId: 'b' },
        });
        const entry = undoHistoryStore.value?.past.at(-1);
        if (entry?.kind !== 'action' || entry.inverseAction?.type !== 'restoreCompRegionInterval')
            throw new Error('Expected whole-owner comp inverse');
        const payload = entry.inverseAction.payload;
        const audioSourcePromotions = payload.audioSourcePromotions?.map((delta) => ({
            ...delta,
            expected: {
                ...delta.expected,
                ...(delta.expected.audioSource
                    ? { audioSource: { ...delta.expected.audioSource, audioOffsetSeconds: 19 } }
                    : {}),
            },
        }));
        await executeAppAction({ type: 'restoreCompRegionInterval', payload: { ...payload, audioSourcePromotions } });
        expect(lane().activeCompRegions).toHaveLength(1);
        expect(lane().activeCompRegions[0]?.audioSource?.audioOffsetSeconds).toBe(19);
        authority();
    });

    it('refuses an owned middle source edit without writes or history consumption', async () => {
        await selectMiddle();
        takeLaneStore.set({
            lanes: [
                {
                    ...lane(),
                    activeCompRegions: lane().activeCompRegions.map((region) =>
                        region.takeId === 'b'
                            ? { ...region, audioSource: { ...originalSource, startBeat: 1, audioOffsetSeconds: 19 } }
                            : region
                    ),
                },
            ],
        });
        authority();
        const before = structuredClone(lane());
        expect((await undo()).headConsumed).toBe(false);
        expect(lane()).toEqual(before);
        expect(undoStore.value?.past).toHaveLength(1);
        expect(undoStore.value?.future).toHaveLength(0);
        authority();
    });

    it('refuses Redo when a peer strips only the middle metadata instead of restoring the exact original owner', async () => {
        await selectMiddle();
        peerSelection(6, 7, 'c');
        expect((await undo()).headConsumed).toBe(true);
        const regions = lane().activeCompRegions.flatMap((region) => {
            if (region.takeId !== 'a' || region.startBeat > 1 || region.endBeat < 2) return [region];
            return [
                { ...region, endBeat: 1 },
                { startBeat: 1, endBeat: 2, takeId: 'a' },
                { ...region, startBeat: 2 },
            ];
        });
        takeLaneStore.set({ lanes: [{ ...lane(), activeCompRegions: regions }] });
        authority();
        const before = structuredClone(lane());
        await redo();
        expect(lane()).toEqual(before);
        expect(undoStore.value?.future).toHaveLength(1);
        expect(undoStore.value?.past).toHaveLength(0);
        authority();
    });
});
