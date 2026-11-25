import { beforeEach, describe, expect, it, vi } from 'vitest';

import { trackStore, updateClipInStore, type Clip } from '#/modules/Arrangement/stores';

import { getPitchHandlers } from '../../../useCases/getPitchHandlers';
import { handleCommitPitchEdit } from '../handleCommitPitchEdit';
import { handleRestoreClipFileId } from '../handleRestoreClipFileId';

vi.mock('#/modules/Arrangement/stores', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Arrangement/stores')>();
    return { ...actual, updateClipInStore: vi.fn() };
});

const contour = { points: [], sample_rate: 44100, hop_size: 256, algorithm: 'pyin' };

describe('Command Pitch Handlers', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // Clip has no declared `fileId`, but pitch handlers read it as a legacy extra
        // property (see findPitchEditClip). Build the clip as a standalone value so the
        // extra property survives without tripping excess-property checks.
        const pitchClip = {
            id: 'c1',
            trackId: 't1',
            name: 'Clip 1',
            startBeat: 0,
            endBeat: 4,
            type: 'audio' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ff0000',
            locked: false,
            muted: false,
            fileId: 'orig.wav',
        };
        trackStore.set({
            tracks: [
                {
                    id: 't1',
                    name: 'Track 1',
                    kind: 'audio',
                    muted: false,
                    soloed: false,
                    armed: false,
                    gain: 0.8,
                    pan: 0,
                    color: '#ff0000',
                    clips: [pitchClip],
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
                },
            ],
            selectedTrackId: 't1',
            ghostClips: [],
        });
    });

    it('getPitchHandlers registers both the forward action and its inverse', () => {
        const handlers = getPitchHandlers();
        expect(handlers.commitPitchEdit).toBe(handleCommitPitchEdit);
        expect(handlers.restoreClipFileId).toBe(handleRestoreClipFileId);
    });

    it('handleCommitPitchEdit is undoable and describes a restoreClipFileId inverse from the live clip', () => {
        expect(handleCommitPitchEdit.undoable).toBe(true);
        expect(
            handleCommitPitchEdit.describe({
                type: 'commitPitchEdit',
                payload: { clipId: 'c1', segments: [], contour, retuneSpeedMs: 25, formantPreserve: true },
            })
        ).toEqual({
            label: 'Commit Pitch Edit',
            // No analysis is seeded for this clip, so there are no blobs and no contour
            // to carry — but the key is present, because an absent `blobs` would make
            // the restore preserve whatever is there at undo time instead of putting
            // the clip back the way the commit found it.
            // The seeded clip has no `audioBufferId`; `null` records that absence so
            // undo can remove the buffer the commit wrote.
            inverseAction: {
                type: 'restoreClipFileId',
                payload: { clipId: 'c1', fileId: 'orig.wav', audioBufferId: null, blobs: [] },
            },
        });
    });

    describe('handleRestoreClipFileId buffer id', () => {
        const committedClip: Clip = {
            id: 'c1',
            trackId: 't1',
            name: 'Clip 1',
            startBeat: 0,
            endBeat: 4,
            type: 'audio',
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '#ff0000',
            locked: false,
            muted: false,
            fileId: 'pitch-edits/c1/orig_pitch.wav',
            audioBufferId: 'audio-pitch:rendered',
        };

        async function restoreOnto(audioBufferId: string | null | undefined): Promise<Clip> {
            await handleRestoreClipFileId.execute({
                type: 'restoreClipFileId',
                payload: { clipId: 'c1', fileId: 'orig.wav', audioBufferId },
            });
            const updater = vi.mocked(updateClipInStore).mock.calls[0]?.[1];
            if (!updater) {
                throw new Error('restore did not update the clip');
            }
            return updater(committedClip);
        }

        it('removes the buffer id when the pre-edit clip had none', async () => {
            const restored = await restoreOnto(null);
            expect(restored.fileId).toBe('orig.wav');
            expect('audioBufferId' in restored).toBe(false);
        });

        it('puts back a recorded buffer id', async () => {
            expect((await restoreOnto('buffer-c1')).audioBufferId).toBe('buffer-c1');
        });

        it('leaves the buffer id alone for an inverse recorded before absence was explicit', async () => {
            expect((await restoreOnto(undefined)).audioBufferId).toBe('audio-pitch:rendered');
        });
    });

    it('handleCommitPitchEdit emits no inverse for a missing clip', () => {
        expect(
            handleCommitPitchEdit.describe({
                type: 'commitPitchEdit',
                payload: { clipId: 'missing', segments: [], contour, retuneSpeedMs: 25, formantPreserve: true },
            })
        ).toEqual({ label: 'Commit Pitch Edit', inverseAction: null });
    });

    it('handleRestoreClipFileId swaps the clip file pointer and is not itself undoable', async () => {
        expect(handleRestoreClipFileId.undoable).toBe(false);
        await handleRestoreClipFileId.execute({
            type: 'restoreClipFileId',
            payload: { clipId: 'c1', fileId: 'orig.wav' },
        });
        expect(updateClipInStore).toHaveBeenCalledWith('c1', expect.any(Function));
        expect(
            handleRestoreClipFileId.describe({
                type: 'restoreClipFileId',
                payload: { clipId: 'c1', fileId: 'orig.wav' },
            })
        ).toEqual({ label: 'Restore Clip Audio' });
    });
});
