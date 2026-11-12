import { change, clone } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { trackStore } from '../../../stores/trackStore';
import { applyRelinkAudioSourceTargets } from '../applyRelinkAudioSourceTargets';
import { captureRelinkAudioSourceCommitValidation } from '../captureRelinkAudioSourceCommitValidation';
import { captureRelinkAudioSourceTargets } from '../captureRelinkAudioSourceTargets';

type Project = { tracks: NonNullable<typeof trackStore.value> };

function beginRelink() {
    const targets = captureRelinkAudioSourceTargets('missing', 'replacement');
    const transaction = runWithAutomergeStorageTransaction(undefined, () => {
        const proof = captureRelinkAudioSourceCommitValidation(targets);
        applyRelinkAudioSourceTargets(targets);
        expect(proof.captureWrittenState()).toBe(true);
        return proof;
    });
    if (transaction.status !== 'returned') {
        throw transaction.error;
    }
    return { transaction, proof: transaction.value };
}

function candidate() {
    return { tracks: trackStore.value };
}

describe('relink source commit observation provenance', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('relink observer provenance');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        trackStore.set({
            tracks: [
                TrackDummy.create({
                    id: 'track',
                    clips: [ClipDummy.create({ id: 'clip', trackId: 'track', audioBufferId: 'missing' })],
                }),
            ],
            selectedTrackId: null,
        });
        flushAutomergeStorageWrites();
    });
    afterEach(() => {
        vi.restoreAllMocks();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('retains a later same-owner removal as final intent, then releases before publication', () => {
        const subscribe = trackStore.subscribe;
        const releases: ReturnType<typeof vi.fn>[] = [];
        vi.spyOn(trackStore, 'subscribe').mockImplementation((listener) => {
            const release = vi.fn(subscribe(listener));
            releases.push(release);
            return release;
        });
        const { transaction, proof } = beginRelink();
        try {
            transaction.scope(() => {
                const state = trackStore.value!;
                trackStore.set({ ...state, tracks: state.tracks.map((track) => ({ ...track, clips: [] })) });
            });
            expect(proof.validation.beforeCommit()).toBeNull();
            expect(proof.validation.beforeMutation?.(getCrdtDoc<Project>('root')!)).toBeNull();
            expect(proof.validation.validateDocument(candidate())).toBeNull();
            proof.validation.release();
            expect(releases).toHaveLength(1);
            expect(releases[0]).toHaveBeenCalledTimes(1);
            transaction.scope(() => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: [ClipDummy.create({ id: 'clip', trackId: 'track', audioBufferId: 'foreign' })],
                    })),
                });
            });
            expect(proof.validation.validateDocument(candidate())).not.toBeNull();
        } finally {
            proof.validation.release();
            transaction.abort();
        }
    });

    it.each(['outside', 'inside', 'inside-before-notification'] as const)(
        'does not certify a peer source publication %s the owner scope during hydration',
        (publicationScope) => {
            const { transaction, proof } = beginRelink();
            const root = getCrdtDoc<Project>('root')!;
            const peer = change(clone(root, 'bbbbbbbbbbbbbbbb'), (draft) => {
                draft.tracks.tracks[0]!.clips[0]!.audioBufferId = 'peer';
            });
            try {
                if (publicationScope === 'outside') {
                    replaceCrdtDocInLineage({ id: 'root', doc: peer });
                }
                transaction.scope(() => {
                    if (publicationScope !== 'outside') {
                        replaceCrdtDocInLineage({ id: 'root', doc: peer });
                    }
                    if (publicationScope === 'inside-before-notification') {
                        trackStore.hydrate({ tracks: [] });
                    }
                    trackStore.hydrate(peer.tracks);
                });
                expect(proof.validation.beforeCommit()).not.toBeNull();
                expect(proof.validation.beforeMutation?.(peer)).not.toBeNull();
                expect(proof.validation.validateDocument(candidate())).not.toBeNull();
                expect(getCrdtDoc<Project>('root')?.tracks.tracks[0]?.clips[0]?.audioBufferId).toBe('peer');
            } finally {
                proof.validation.release();
                transaction.abort();
            }
        }
    );

    it('refuses a stale projection when a newer raw source already exists before the capture', () => {
        const targets = captureRelinkAudioSourceTargets('missing', 'replacement');
        const root = getCrdtDoc<Project>('root')!;
        const peer = change(clone(root, 'bbbbbbbbbbbbbbbb'), (draft) => {
            draft.tracks.tracks[0]!.clips[0]!.audioBufferId = 'peer';
        });
        replaceCrdtDocInLineage({ id: 'root', doc: peer });
        expect(trackStore.value?.tracks[0]?.clips[0]?.audioBufferId).toBe('missing');
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            const proof = captureRelinkAudioSourceCommitValidation(targets);
            applyRelinkAudioSourceTargets(targets);
            expect(proof.captureWrittenState()).toBe(false);
            return proof;
        });
        if (transaction.status !== 'returned') {
            throw transaction.error;
        }
        try {
            expect(transaction.value.validation.beforeCommit()).not.toBeNull();
            expect(transaction.value.validation.beforeMutation?.(peer)).not.toBeNull();
            expect(transaction.value.validation.validateDocument(candidate())).not.toBeNull();
            expect(getCrdtDoc<Project>('root')?.tracks.tracks[0]?.clips[0]?.audioBufferId).toBe('peer');
        } finally {
            transaction.value.validation.release();
            transaction.abort();
        }
    });

    it('does not mistake an unrelated owned gain change for a dropped relink intent', () => {
        const { transaction, proof } = beginRelink();
        try {
            transaction.scope(() => {
                const state = trackStore.value!;
                trackStore.set({
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) => ({ ...clip, gain: 0.25 })),
                    })),
                });
            });
            expect(proof.validation.validateDocument(candidate())).toBeNull();
            const state = trackStore.value!;
            const dropped = {
                tracks: {
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) => ({ ...clip, audioBufferId: 'missing' })),
                    })),
                },
            };
            expect(proof.validation.validateDocument(dropped)).not.toBeNull();
            const explicitNull = {
                tracks: {
                    ...state,
                    tracks: state.tracks.map((track) => ({
                        ...track,
                        clips: track.clips.map((clip) => ({ ...clip, fileId: null })),
                    })),
                },
            };
            expect(proof.validation.validateDocument(explicitNull)).not.toBeNull();
        } finally {
            proof.validation.release();
            transaction.abort();
        }
    });
});
