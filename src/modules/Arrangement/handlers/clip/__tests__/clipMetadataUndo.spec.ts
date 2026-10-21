import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { type ActionUndoEntry } from '#/modules/Command/models/UndoEntry';
import { clearHandlerRegistry, registerHandlerMap, undoHistoryStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { resolveClipLoopOriginAdvance } from '#/utils/clipLoopOrigin';
import { type TrackClipStateSnapshot } from '#/utils/handlerContract';

import { type Clip, createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { trimClipStart } from '../../../useCases/clipEditing/trimClipStart';
import { handleLockClip } from '../handleLockClip';
import { handleMuteClip } from '../handleMuteClip';
import { handleRestoreClipLoop } from '../handleRestoreClipLoop';
import { handleRestoreTrackClipStates } from '../handleRestoreTrackClipStates';
import { handleSetClipColor } from '../handleSetClipColor';
import { handleSetClipFade } from '../handleSetClipFade';
import { handleSetClipLoop } from '../handleSetClipLoop';
import { handleSetClipLoopLength } from '../handleSetClipLoopLength';

vi.mock('#/utils/Notification/notifyUser', () => ({
    notifyUser: vi.fn(),
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

const clip: Clip = {
    id: 'clip-1',
    trackId: 'track-1',
    name: 'Verse',
    startBeat: 0,
    endBeat: 8,
    type: 'audio',
    fadeInBeats: 0.25,
    fadeOutBeats: 0.5,
    gain: 1,
    color: '#112233',
    locked: false,
    muted: false,
    loopEnabled: false,
};

function seedClip(includeLoopEnabled = true): void {
    const seededClip = { ...clip };
    if (!includeLoopEnabled) {
        delete seededClip.loopEnabled;
    }
    const track = { ...createTrack({ id: 'track-1', name: 'Audio', kind: 'audio' }), clips: [seededClip] };
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
}

describe('clip metadata handler replay', () => {
    beforeEach(seedClip);

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('captures guarded lock undo and redo actions', () => {
        const action = { type: 'lockClip', payload: { clipId: clip.id, locked: true } } as const;

        expect(handleLockClip.describe(action)).toEqual({
            label: 'Lock clip',
            inverseAction: {
                type: 'lockClip',
                payload: { clipId: clip.id, locked: false, expectedLocked: true },
            },
            redoAction: {
                type: 'lockClip',
                payload: { clipId: clip.id, locked: true, expectedLocked: false },
            },
        });
        expect(handleLockClip.isNoop?.(action)).toBe(false);
        expect(handleLockClip.execute(action)).toEqual({ status: 'written' });
        expect(handleLockClip.isNoop?.(action)).toBe(true);
    });

    it('captures guarded mute undo and redo actions', () => {
        const action = { type: 'muteClip', payload: { clipId: clip.id, muted: true } } as const;

        expect(handleMuteClip.describe(action)).toEqual({
            label: 'Mute clip',
            inverseAction: {
                type: 'muteClip',
                payload: { clipId: clip.id, muted: false, expectedMuted: true },
            },
            redoAction: {
                type: 'muteClip',
                payload: { clipId: clip.id, muted: true, expectedMuted: false },
            },
        });
        expect(handleMuteClip.isNoop?.(action)).toBe(false);
        expect(handleMuteClip.execute(action)).toEqual({ status: 'written' });
        expect(handleMuteClip.isNoop?.(action)).toBe(true);
    });

    it('refuses stale color undo after a newer color edit', () => {
        const action = { type: 'setClipColor', payload: { clipId: clip.id, color: '#445566' } } as const;
        const description = handleSetClipColor.describe(action);

        expect(description).toEqual({
            label: 'Set clip color',
            inverseAction: {
                type: 'setClipColor',
                payload: { clipId: clip.id, color: '#112233', expectedColor: '#445566' },
            },
            redoAction: {
                type: 'setClipColor',
                payload: { clipId: clip.id, color: '#445566', expectedColor: '#112233' },
            },
        });
        expect(handleSetClipColor.execute(action)).toEqual({ status: 'written' });
        expect(
            handleSetClipColor.execute({ type: 'setClipColor', payload: { clipId: clip.id, color: '#778899' } })
        ).toEqual({ status: 'written' });
        expect(description.inverseAction?.type).toBe('setClipColor');
        if (description.inverseAction?.type !== 'setClipColor') {
            throw new Error('Expected color inverse action');
        }
        expect(handleSetClipColor.execute(description.inverseAction)).toEqual({ status: 'conflict' });
    });

    it('captures normalized fade replay and refuses a stale inverse', () => {
        const action = {
            type: 'setClipFade',
            payload: { clipId: clip.id, fadeInBeats: 1, fadeOutBeats: 2 },
        } as const;
        const description = handleSetClipFade.describe(action);

        expect(description).toEqual({
            label: 'Set clip fade',
            inverseAction: {
                type: 'setClipFade',
                payload: {
                    clipId: clip.id,
                    fadeInBeats: 0.25,
                    fadeOutBeats: 0.5,
                    expectedFadeInBeats: 1,
                    expectedFadeOutBeats: 2,
                },
            },
            redoAction: {
                type: 'setClipFade',
                payload: {
                    clipId: clip.id,
                    fadeInBeats: 1,
                    fadeOutBeats: 2,
                    expectedFadeInBeats: 0.25,
                    expectedFadeOutBeats: 0.5,
                },
            },
        });
        expect(handleSetClipFade.execute(action)).toEqual({ status: 'written' });
        expect(
            handleSetClipFade.execute({
                type: 'setClipFade',
                payload: { clipId: clip.id, fadeInBeats: 3, fadeOutBeats: 4 },
            })
        ).toEqual({ status: 'written' });
        expect(description.inverseAction?.type).toBe('setClipFade');
        if (description.inverseAction?.type !== 'setClipFade') {
            throw new Error('Expected fade inverse action');
        }
        expect(handleSetClipFade.execute(description.inverseAction)).toEqual({ status: 'conflict' });
    });

    it('captures exact guarded loop undo and redo actions', () => {
        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } } as const;

        expect(handleSetClipLoop.describe(action)).toEqual({
            label: 'Enable clip loop',
            inverseAction: {
                type: 'restoreClipLoop',
                payload: {
                    clipId: clip.id,
                    expected: { present: true, enabled: true, audioLoopStartSeconds: 0 },
                    // The enable's inverse records the pre-enable anchor state
                    // explicitly (#5198): this clip carried none, so the undo
                    // removes the key the enable minted.
                    replacement: { present: true, enabled: false, loopOriginBeat: null, audioLoopStartSeconds: null },
                },
            },
            redoAction: {
                type: 'restoreClipLoop',
                payload: {
                    clipId: clip.id,
                    expected: { present: true, enabled: false, loopOriginBeat: null, audioLoopStartSeconds: null },
                    replacement: { present: true, enabled: true, audioLoopStartSeconds: 0 },
                },
            },
        });
        expect(handleSetClipLoop.isNoop?.(action)).toBe(false);
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        expect(handleSetClipLoop.isNoop?.(action)).toBe(true);
    });

    it('captures a new loop region at the stored head and restores its prior dormant source boundary', () => {
        const source = { ...clip, audioOffsetSeconds: 7, audioLoopStartSeconds: 5.5, loopOriginBeat: 2 };
        trackStore.set({
            tracks: [{ ...createTrack({ id: 'track-1', name: 'Audio', kind: 'audio' }), clips: [source] }],
            selectedTrackId: 'track-1',
            ghostClips: [],
        });
        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } } as const;
        const description = handleSetClipLoop.describe(action);
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioLoopStartSeconds).toBe(7);
        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected loop inverse');
        }
        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioLoopStartSeconds).toBe(5.5);
    });

    it('captures presence-aware guarded loop-length undo and redo actions', () => {
        const action = { type: 'setClipLoopLength', payload: { clipId: clip.id, loopLength: 4 } } as const;

        expect(handleSetClipLoopLength.describe(action)).toEqual({
            label: 'Set clip loop length to 4 beats; clip looping is disabled, so the stored length is dormant until enabled',
            inverseAction: {
                type: 'restoreClipLoopLength',
                payload: {
                    clipId: clip.id,
                    expected: { present: true, value: 4 },
                    replacement: { present: false, value: 0 },
                },
            },
            redoAction: {
                type: 'restoreClipLoopLength',
                payload: {
                    clipId: clip.id,
                    expected: { present: false, value: 0 },
                    replacement: { present: true, value: 4 },
                },
            },
        });
    });

    it('restores an absent loopEnabled property exactly across undo and redo', () => {
        seedClip(false);
        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } } as const;
        const description = handleSetClipLoop.describe(action);

        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        expect(description.inverseAction?.type).toBe('restoreClipLoop');
        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop inverse action');
        }
        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        const restoredClip = trackStore.value?.tracks[0]?.clips[0];
        expect(restoredClip).toBeDefined();
        expect(Object.hasOwn(restoredClip ?? {}, 'loopEnabled')).toBe(false);

        expect(description.redoAction?.type).toBe('restoreClipLoop');
        if (description.redoAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop redo action');
        }
        expect(handleRestoreClipLoop.execute(description.redoAction)).toEqual({ status: 'written' });
        expect(trackStore.value?.tracks[0]?.clips[0]?.loopEnabled).toBe(true);
    });

    it('treats an own undefined loopEnabled property as durably absent', () => {
        const seededClip = { ...clip };
        Object.defineProperty(seededClip, 'loopEnabled', {
            configurable: true,
            enumerable: true,
            value: undefined,
            writable: true,
        });
        const track = { ...createTrack({ id: 'track-1', name: 'Audio', kind: 'audio' }), clips: [seededClip] };
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } } as const;
        const description = handleSetClipLoop.describe(action);

        expect(description.inverseAction).toEqual({
            type: 'restoreClipLoop',
            payload: {
                clipId: clip.id,
                expected: { present: true, enabled: true, audioLoopStartSeconds: 0 },
                replacement: { present: false, enabled: false, loopOriginBeat: null, audioLoopStartSeconds: null },
            },
        });
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop inverse action');
        }
        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        expect(Object.hasOwn(trackStore.value?.tracks[0]?.clips[0] ?? {}, 'loopEnabled')).toBe(false);
    });
});

describe('clip loop disable undo keeps the pre-disable anchor (#5198)', () => {
    beforeEach(seedClip);

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    function runEnableTrimDisable() {
        // Enable at 0 (anchor 0), trim the start to 4 (advance 4, region
        // offset 4 - advance 4 = 0), then disable — the document now holds
        // {loopEnabled: false, anchor 0, startBeat 4}.
        expect(handleSetClipLoop.execute({ type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } })).toEqual(
            { status: 'written' }
        );
        expect(trimClipStart(clip.id, 4)).toBe(true);
        const disableAction = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: false } } as const;
        const description = handleSetClipLoop.describe(disableAction);
        expect(handleSetClipLoop.execute(disableAction)).toEqual({ status: 'written' });
        return description;
    }

    it('restores the pre-disable anchor, advance, and loop window on undo', () => {
        const description = runEnableTrimDisable();
        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop inverse action');
        }
        // The inverse records the anchor the clip carried before the disable.
        expect(description.inverseAction.payload.replacement).toEqual({
            present: true,
            enabled: true,
            loopOriginBeat: 0,
            audioLoopStartSeconds: 0,
        });

        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored).toMatchObject({ loopEnabled: true, loopOriginBeat: 0, startBeat: 4 });
        const advance = resolveClipLoopOriginAdvance({
            startBeat: restored!.startBeat,
            loopOriginBeat: restored!.loopOriginBeat,
            loopEnabled: restored!.loopEnabled === true,
        });
        expect(advance).toBe(4);
        expect((restored!.audioOffsetBeats ?? 0) - advance).toBe(0);
    });
});

describe('clip loop enable undo removes the minted anchor (#5198)', () => {
    beforeEach(() => seedClip(false));

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    /** A whole-track restore entry captured while the clip was anchorless and never looped. */
    function capturedAnchorlessEntry(): TrackClipStateSnapshot {
        const track = trackStore.value?.tracks[0];
        const seededClip = track?.clips[0];
        if (!track || !seededClip) {
            throw new Error('Expected the seeded anchorless clip');
        }
        return {
            trackId: track.id,
            clips: [structuredClone(seededClip)],
            trackFields: {
                kind: track.kind,
                devices: structuredClone(track.devices),
                frozen: track.frozen,
                freezeState: structuredClone(track.freezeState),
                activeAlternativeId: track.activeAlternativeId,
                alternatives: structuredClone(track.alternatives),
            },
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            clipSatellites: [],
            clipAutomationLanes: [],
        };
    }

    it('restores the exact pre-enable anchor state and lets an older restore entry execute', () => {
        // An older whole-track restore captured this never-looped clip
        // anchorless, before the enable existed.
        const olderEntry = capturedAnchorlessEntry();

        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: true } } as const;
        const description = handleSetClipLoop.describe(action);
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        expect(trackStore.value?.tracks[0]?.clips[0]?.loopOriginBeat).toBe(0);

        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop inverse action');
        }
        // The inverse records the pre-enable anchor state: the clip carried none.
        expect(description.inverseAction.payload.replacement).toEqual({
            present: false,
            enabled: false,
            loopOriginBeat: null,
            audioLoopStartSeconds: null,
        });

        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        const undone = trackStore.value?.tracks[0]?.clips[0];
        expect(Object.hasOwn(undone ?? {}, 'loopEnabled')).toBe(false);
        // The key the enable minted is gone with it.
        expect(Object.hasOwn(undone ?? {}, 'loopOriginBeat')).toBe(false);

        // The older entry's anchorless snapshot matches live state again, so
        // it executes instead of returning conflict and leaving a conflicted
        // entry that bricks the user's next undo.
        expect(
            handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: { expected: [olderEntry], replacement: [structuredClone(olderEntry)] },
            })
        ).toEqual({ status: 'written' });
    });
});

describe('legacy loop entries replay anchorless through the undo seam (#5198)', () => {
    function registerReplayHandlers(): void {
        clearHandlerRegistry();
        registerHandlerMap({
            restoreClipLoop: handleRestoreClipLoop,
            restoreTrackClipStates: handleRestoreTrackClipStates,
        });
    }

    /** The legacy disable-undo entry: recorded before the restore carried anchors. */
    function legacyDisableUndoEntry(): ActionUndoEntry {
        return {
            kind: 'action',
            id: 'legacy-loop-undo',
            label: 'Disable clip loop',
            timestamp: 0,
            source: 'manual',
            action: { type: 'setClipLoop', payload: { clipId: clip.id, enabled: false } },
            // Keyless — decoding a pre-#5198 entry produces no anchor field.
            inverseAction: {
                type: 'restoreClipLoop',
                payload: {
                    clipId: clip.id,
                    expected: { present: true, enabled: false },
                    replacement: { present: true, enabled: true },
                },
            },
        };
    }

    /** The whole-track restore captured while the clip was looped and anchorless — the pre-disable state. */
    function legacyWholeTrackEntry(): TrackClipStateSnapshot {
        const track = trackStore.value?.tracks[0];
        const seededClip = track?.clips[0];
        if (!track || !seededClip) {
            throw new Error('Expected the seeded clip');
        }
        return {
            trackId: track.id,
            clips: [{ ...structuredClone(seededClip), loopEnabled: true }],
            trackFields: {
                kind: track.kind,
                devices: structuredClone(track.devices),
                frozen: track.frozen,
                freezeState: structuredClone(track.freezeState),
                activeAlternativeId: track.activeAlternativeId,
                alternatives: structuredClone(track.alternatives),
            },
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            clipSatellites: [],
            clipAutomationLanes: [],
        };
    }

    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('legacy loop anchor undo replay');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerReplayHandlers();
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        // The document after a legacy disable: looping off, and — the field
        // not existing yet — no anchor. The recorded inverse replays the
        // enable.
        seedClip();
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('replays a keyless legacy loop inverse anchorless and lets a deeper legacy restore execute', async () => {
        // An older whole-track restore captured the clip looped and
        // anchorless — its pre-disable state.
        const olderEntry = legacyWholeTrackEntry();

        undoHistoryStore.set({ past: [legacyDisableUndoEntry()], future: [] });
        await undo();

        const restored = trackStore.value?.tracks[0]?.clips[0];
        expect(restored?.loopEnabled).toBe(true);
        // The replay restamped nothing: the pre-action clip carried no
        // anchor, and minting one at the enable would write a key into a
        // legacy document and make the older restore below conflict.
        expect(Object.hasOwn(restored ?? {}, 'loopOriginBeat')).toBe(false);
        expect(
            resolveClipLoopOriginAdvance({
                startBeat: restored!.startBeat,
                loopOriginBeat: restored!.loopOriginBeat,
                loopEnabled: restored!.loopEnabled === true,
            })
        ).toBe(0);

        // The older entry's anchorless snapshot matches live state again, so
        // it executes instead of returning conflict and bricking the undo
        // stack behind it.
        expect(
            handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: { expected: [olderEntry], replacement: [structuredClone(olderEntry)] },
            })
        ).toEqual({ status: 'written' });
    });
});

describe('clip loop disable undo keeps a never-anchored clip anchorless (#5198)', () => {
    /** A legacy looped clip: looping on, but saved before the anchor existed. */
    function seedLegacyLoopedClip(): void {
        // The base fixture carries no loopOriginBeat key, so the seed is
        // anchorless by construction — a pre-#4988 looped clip.
        const seededClip: Clip = { ...clip, loopEnabled: true };
        const track = { ...createTrack({ id: 'track-1', name: 'Audio', kind: 'audio' }), clips: [seededClip] };
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    }

    /** A whole-track restore entry captured while the clip was looped and anchorless. */
    function capturedAnchorlessLoopedEntry(): TrackClipStateSnapshot {
        const track = trackStore.value?.tracks[0];
        const seededClip = track?.clips[0];
        if (!track || !seededClip) {
            throw new Error('Expected the seeded anchorless looped clip');
        }
        return {
            trackId: track.id,
            clips: [structuredClone(seededClip)],
            trackFields: {
                kind: track.kind,
                devices: structuredClone(track.devices),
                frozen: track.frozen,
                freezeState: structuredClone(track.freezeState),
                activeAlternativeId: track.activeAlternativeId,
                alternatives: structuredClone(track.alternatives),
            },
            midiNotesByClipId: {},
            midiCcByClipId: {},
            midiPitchBendByClipId: {},
            clipSatellites: [],
            clipAutomationLanes: [],
        };
    }

    beforeEach(seedLegacyLoopedClip);

    afterEach(() => {
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    });

    it('restores the exact pre-disable anchor state and lets an older restore entry execute', () => {
        // An older whole-track restore captured this looped clip anchorless,
        // before the anchor field existed.
        const olderEntry = capturedAnchorlessLoopedEntry();

        const action = { type: 'setClipLoop', payload: { clipId: clip.id, enabled: false } } as const;
        const description = handleSetClipLoop.describe(action);
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        // The clip was never anchored, so the disable mints nothing either.
        expect(Object.hasOwn(trackStore.value?.tracks[0]?.clips[0] ?? {}, 'loopOriginBeat')).toBe(false);

        if (description.inverseAction?.type !== 'restoreClipLoop') {
            throw new Error('Expected exact loop inverse action');
        }
        // The inverse records the pre-disable anchor state explicitly: the
        // clip carried none. An anchorless entry here would decode as legacy
        // and the undo would replay the enable's restamp, minting an anchor
        // this clip never carried.
        expect(description.inverseAction.payload.replacement).toEqual({
            present: true,
            enabled: true,
            loopOriginBeat: null,
            audioLoopStartSeconds: null,
        });

        expect(handleRestoreClipLoop.execute(description.inverseAction)).toEqual({ status: 'written' });
        const undone = trackStore.value?.tracks[0]?.clips[0];
        expect(undone?.loopEnabled).toBe(true);
        // The undo minted no anchor.
        expect(Object.hasOwn(undone ?? {}, 'loopOriginBeat')).toBe(false);

        // The older entry's anchorless snapshot matches live state again, so
        // it executes instead of returning conflict and leaving a conflicted
        // entry that bricks the user's next undo.
        expect(
            handleRestoreTrackClipStates.execute({
                type: 'restoreTrackClipStates',
                payload: { expected: [olderEntry], replacement: [structuredClone(olderEntry)] },
            })
        ).toEqual({ status: 'written' });
    });
});
