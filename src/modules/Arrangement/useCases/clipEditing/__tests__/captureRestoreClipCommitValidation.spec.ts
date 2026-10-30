import { change, clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { addClip } from '../../clip/addClip';
import { captureRestoreClipCommitValidation } from '../captureRestoreClipCommitValidation';

type Project = { tracks: NonNullable<typeof trackStore.value> };
const action: Extract<AppAction, { type: 'restoreClip' }> = {
    type: 'restoreClip',
    payload: {
        clipId: 'source',
        trackId: 'track',
        clipSnapshot: ClipDummy.create({ id: 'source', trackId: 'track', startBeat: 0, endBeat: 4 }),
        ripplePlan: null,
        retiredTakeLanes: [],
        midiNotesSnapshot: null,
        midiCcSnapshot: null,
        midiPitchBendSnapshot: null,
    },
};

describe('restore clip commit observation provenance', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('restore observer provenance');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track',
                    clips: [ClipDummy.create({ id: 'peer', trackId: 'track', startBeat: 8, endBeat: 12 })],
                }),
            ],
            selectedTrackId: 'track',
        });
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('preserves JSON-visible key order, omitted optionals and ordered nested owner arrays', () => {
        const knead = {
            blobs: ['a', 'b'].map((id) => ({
                id,
                startTime: 0,
                endTime: 1,
                pitchCenterCents: 60,
                pitchCurveCents: [60, 61],
                voicedConfidence: 1,
            })),
            retuneSpeedMs: 10,
            humanizePercent: 5,
            formantPreserve: true,
        };
        const source = ClipDummy.create({
            id: 'source',
            trackId: 'track',
            startBeat: 0,
            endBeat: 4,
            audioBufferId: undefined,
            overrides: { a: true, b: false },
            kneadState: knead,
        });
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            const proof = captureRestoreClipCommitValidation(action);
            const state = trackStore.value;
            if (!proof || !state) {
                throw new Error('Expected the source owner and commit proof');
            }
            trackStore.set({
                ...state,
                tracks: state.tracks.map((track) => ({ ...track, clips: [...track.clips, source] })),
            });
            expect(proof.captureWrittenState()).toBe(true);
            return proof;
        });
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        const proof = transaction.value;
        const root = getCrdtDoc<Project>('root');
        const state = trackStore.value;
        if (!root || !state) {
            throw new Error('Expected raw and projected source owners');
        }
        const prospective = (clip: Readonly<Record<string, unknown>>) => ({
            ...root,
            tracks: {
                ...state,
                tracks: state.tracks.map((track) => ({
                    ...track,
                    clips: track.clips.map((current) => (current.id === 'source' ? clip : current)),
                })),
            },
        });
        try {
            const reordered = Object.fromEntries(Object.entries(source).toReversed());
            reordered.overrides = { b: false, a: true };
            Reflect.deleteProperty(reordered, 'audioBufferId');
            expect(proof.validation.beforeCommit()).toBeNull();
            expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(source));
            expect(proof.validation.validateDocument(prospective(reordered))).toBeNull();
            expect(proof.validation.validateDocument(prospective({ ...reordered, audioBufferId: 'other' }))).toBe(
                'Clip restore did not reach the committed owners'
            );
            expect(
                proof.validation.validateDocument(
                    prospective({
                        ...reordered,
                        kneadState: { ...knead, blobs: knead.blobs.toReversed() },
                    })
                )
            ).toBe('Clip restore did not reach the committed owners');
        } finally {
            proof.validation.release();
            transaction.abort();
        }
    });

    it.each(['outside', 'inside', 'inside-before-notification'] as const)(
        'does not certify a peer publication %s the owner scope during hydration',
        (publicationScope) => {
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                const proof = captureRestoreClipCommitValidation(action);
                if (!proof) {
                    throw new Error('Expected an owned restore guard');
                }
                addClip({ id: 'source', trackId: 'track', name: 'Source', startBeat: 0, endBeat: 4 });
                expect(proof.captureWrittenState()).toBe(true);
                return proof;
            });
            if (transaction.status !== 'returned') {
                throw transaction.error;
            }
            const proof = transaction.value;
            const root = getCrdtDoc<Project>('root');
            if (!root) {
                throw new Error('Expected the raw project');
            }
            // No projection bridge is installed: publication and hydration can
            // deliberately share the owner scope without becoming owner intent.
            const peer = change(clone(root, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.tracks.tracks[0]!.clips[0]!.name = 'Peer name';
            });
            if (publicationScope === 'outside') {
                replaceCrdtDocInLineage({ id: 'root', doc: peer });
            }
            transaction.scope(() => {
                if (publicationScope !== 'outside') {
                    replaceCrdtDocInLineage({ id: 'root', doc: peer });
                }
                if (publicationScope === 'inside-before-notification') {
                    const current = trackStore.value;
                    if (!current) {
                        throw new Error('Expected the pending projection');
                    }
                    trackStore.set({ ...current, selectedTrackId: null });
                }
                trackStore.hydrate();
                const state = trackStore.value;
                if (!state) {
                    throw new Error('Expected the hydrated store');
                }
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) =>
                            clip.id === 'peer' ? { ...clip, name: 'Owned later name' } : clip
                        ),
                    })),
                });
            });
            expect(trackStore.value?.tracks[0]?.clips.map((clip) => clip.id)).toEqual(['peer']);
            expect(proof.validation.beforeCommit()).toBeNull();
            expect(proof.validation.validateDocument(getCrdtDoc<Readonly<Record<string, unknown>>>('root')!)).toBe(
                'Clip restore did not reach the committed owners'
            );
            proof.validation.release();
            proof.validation.release();
            transaction.abort();
        }
    );
});
