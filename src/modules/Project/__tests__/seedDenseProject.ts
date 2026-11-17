import * as A from '@automerge/automerge';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { getWarpState } from '#/modules/Arrangement/stores';
import { addClip, addTrack, hydrateClipWarpStates } from '#/modules/Arrangement/useCases';
import {
    getCrdtDoc,
    projectCrdtToStores,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { type midiStore } from '#/modules/MIDI/stores';
import { setMidiStoreState } from '#/modules/MIDI/useCases';

import { arrangementStore } from '../stores/arrangementStore';
import { projectStore } from '../stores/projectStore';
import { takeSnapshot } from '../useCases/arrangement/takeSnapshot';
import { createFreshProjectMetadata } from '../useCases/createFreshProjectMetadata';
import { resetModuleStoresToDefault } from '../useCases/projectPersistence/helpers/resetModuleStoresToDefault';

type DenseNativeRoot = {
    [key: string]: unknown;
    tracks?: { tracks: { name: string }[] };
    actionHistory?: {
        entries: {
            id: string;
            label: string;
            timestamp: number;
            source: string;
            actionKind: string;
            reverted: boolean;
        }[];
    };
};

function root() {
    const document = getCrdtDoc<DenseNativeRoot>('root');
    if (!document) {
        throw new Error('Actual native project root is missing');
    }
    return document;
}

function requireValue<T>(value: T | null | undefined): T {
    if (value === null || value === undefined) {
        throw new Error('Fixture owner refused its valid input');
    }
    return value;
}

export function seedDenseProject(): void {
    resetCrdtProjectAuthority('Native preparation');
    resetModuleStoresToDefault();
    projectStore.set(createFreshProjectMetadata({ name: 'Native preparation', initialized: true, loading: false }));
    requireValue(addTrack({ id: 'scale-track-0', name: 'Source', kind: 'audio' }));
    requireValue(
        addClip({
            id: 'source',
            trackId: 'scale-track-0',
            name: '120 second source',
            type: 'audio',
            startBeat: 0,
            endBeat: 240,
            audioBufferId: 'source-pcm',
        })
    );
    arrangementStore.set({
        arrangements: [takeSnapshot('active', 'Active'), takeSnapshot('inactive', 'Inactive')],
        activeArrangementId: 'active',
    });
    flushAutomergeStorageWrites();
    // Retain real native edits while the fixture is small. This is a native
    // history fixture, not a claim that Command replay was exercised here.
    let history = A.clone(root());
    for (let index = 0; index < 2048; index++) {
        history = A.change(history, { message: `Retained edit ${index}`, time: 0 }, (draft) => {
            const track = draft.tracks?.tracks[0];
            if (!track) {
                throw new Error('Native history fixture lost its real source track');
            }
            track.name = `Retained edit ${index}`;
            draft.actionHistory ??= { entries: [] };
            const rows = draft.actionHistory.entries;
            rows.push({
                id: `history-${index}`,
                label: `Edit ${index}`,
                timestamp: index,
                source: 'manual',
                actionKind: 'renameTrack',
                reverted: false,
            });
            if (rows.length > 200) {
                rows.splice(0, rows.length - 200);
            }
        });
    }
    replaceCrdtDoc({ id: 'root', doc: history });
    projectCrdtToStores({ resetProjections: true });
    for (let trackIndex = 0; trackIndex < 32; trackIndex++) {
        const trackId = `scale-track-${trackIndex}`;
        const audio = trackIndex < 16;
        if (trackIndex > 0) {
            requireValue(addTrack({ id: trackId, name: `Scale ${trackIndex}`, kind: audio ? 'audio' : 'midi' }));
        }
        for (let clipIndex = 0; clipIndex < 8; clipIndex++) {
            if (trackIndex === 0 && clipIndex === 0) {
                continue;
            }
            const length = audio ? 240 : 32;
            const payload: Parameters<typeof addClip>[0] = {
                id: `scale-clip-${trackIndex}-${clipIndex}`,
                trackId,
                name: `Phrase ${clipIndex}`,
                type: audio ? 'audio' : 'midi',
                startBeat: clipIndex * length,
                endBeat: (clipIndex + 1) * length,
            };
            if (audio) {
                payload.audioBufferId = 'source-pcm';
            }
            requireValue(addClip(payload));
        }
        flushAutomergeStorageWrites();
    }
    const notesByClipId: NonNullable<typeof midiStore.value>['notesByClipId'] = {};
    for (let trackIndex = 16; trackIndex < 32; trackIndex++) {
        for (let clipIndex = 0; clipIndex < 8; clipIndex++) {
            notesByClipId[`scale-clip-${trackIndex}-${clipIndex}`] = Array.from({ length: 64 }, (_, note) => ({
                id: `note-${trackIndex}-${clipIndex}-${note}`,
                pitch: 48 + ((note + trackIndex) % 24),
                startBeat: note / 2,
                duration: 0.375,
                velocity: 0.5 + (note % 5) / 10,
            }));
        }
    }
    setMidiStoreState({ notesByClipId, ccByClipId: {}, pitchBendByClipId: {}, noteCoordinateFormat: 'clip-relative' });
    hydrateClipWarpStates(
        Array.from({ length: 8 }, (_, index) => ({
            clipId: `scale-clip-${index + 1}-0`,
            ...getWarpState('source'),
            enabled: true,
            markers: Array.from({ length: 120 }, (_, marker) => ({
                id: `marker-${index}-${marker}`,
                originalBeat: marker * 2,
                warpedBeat: marker * 2,
                origin: 'transient-auto',
                confidence: 1,
                locked: false,
            })),
        }))
    );
    flushAutomergeStorageWrites();
    arrangementStore.hydrate();
}
