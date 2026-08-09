import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Clip, createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { handleLockClip } from '../handleLockClip';
import { handleMuteClip } from '../handleMuteClip';
import { handleRestoreClipLoop } from '../handleRestoreClipLoop';
import { handleSetClipColor } from '../handleSetClipColor';
import { handleSetClipFade } from '../handleSetClipFade';
import { handleSetClipLoop } from '../handleSetClipLoop';
import { handleSetClipLoopLength } from '../handleSetClipLoopLength';

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
                    expected: { present: true, enabled: true },
                    replacement: { present: true, enabled: false },
                },
            },
            redoAction: {
                type: 'restoreClipLoop',
                payload: {
                    clipId: clip.id,
                    expected: { present: true, enabled: false },
                    replacement: { present: true, enabled: true },
                },
            },
        });
        expect(handleSetClipLoop.isNoop?.(action)).toBe(false);
        expect(handleSetClipLoop.execute(action)).toEqual({ status: 'written' });
        expect(handleSetClipLoop.isNoop?.(action)).toBe(true);
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
                expected: { present: true, enabled: true },
                replacement: { present: false, enabled: false },
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
