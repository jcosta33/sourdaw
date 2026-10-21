import { change, clone, getHeads, load, merge, save, toJS } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction } from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    agentProjectInspectionPort,
    createCrdtDoc,
    findAutomergeProjectConflicts,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDocInLineage,
} from '#/modules/CrdtDocument/useCases';
import { midiStore, type MidiStoreState } from '#/modules/MIDI/stores';
import { type AppAction } from '#/utils/handlerContract';

import { handleRepairProjectData } from '../handleRepairProjectData';

/**
 * The end-to-end repair route of issue #3573 against a real Automerge
 * document: a concurrent edit merged into the project leaves a genuine
 * conflict, the gate refuses every action but the repair, and the repair
 * closes the conflict by keeping the value the document already resolved to.
 */
type ProjectDocument = {
    targets: Record<string, { gain: number; id: string; name: string }>;
};

function seedProjectDocument(): void {
    createCrdtDoc('root');
    mutateCrdtDoc<ProjectDocument>({
        id: 'root',
        changeFn: (doc) => {
            doc.targets = { 'track-bass': { gain: 0.8, id: 'track-bass', name: 'Bass' } };
        },
    });
}

function mergeConflictingRemoteEdit(): void {
    const local = getCrdtDoc('root') as ProjectDocument | null;
    if (!local) {
        throw new Error('Expected a seeded root document');
    }
    // Automerge keeps the concurrent value with the greatest actor id at equal counters,
    // and the local document carries a random actor, so the remote actor must sort above
    // every possible local actor for 0.7 to be the deterministic winner.
    const remote = change(clone(local, { actor: 'f'.repeat(64) }), (draft) => {
        draft.targets['track-bass']!.gain = 0.7;
    });
    mutateCrdtDoc<ProjectDocument>({
        id: 'root',
        changeFn: (doc) => {
            doc.targets['track-bass']!.gain = 0.6;
        },
    });
    const localHead = load<ProjectDocument>(save(getCrdtDoc('root') as ProjectDocument));
    const merged = merge(localHead, remote);
    // The lineage-preserving replacement a sync merge performs — the identity-
    // moving `replaceCrdtDoc` is for project replacement, not merged edits.
    replaceCrdtDocInLineage({ id: 'root', doc: merged });
    if (findAutomergeProjectConflicts({ document: getCrdtDoc('root') as ProjectDocument }).length === 0) {
        throw new Error('Expected the merged document to carry a conflict');
    }
}

function registerCanaryHandler(): void {
    registerHandlerMap({
        repairProjectData: handleRepairProjectData,
        setTrackPan: {
            describe: (action: Extract<AppAction, { type: 'setTrackPan' }>) => ({
                label: `Set ${action.payload.trackId} pan`,
            }),
            execute: () => ({ status: 'written' }),
            undoable: true,
        },
    });
}

type CompositeProjectDocument = {
    tracks: {
        tracks: {
            id: string;
            name: string;
            kind: 'midi';
            gain: number;
            pan: number;
            muted: boolean;
            notes: string;
            clips: {
                id: string;
                trackId: string;
                name: string;
                startBeat: number;
                endBeat: number;
                type: 'midi';
                midiOffsetBeats: number;
            }[];
        }[];
    };
    midi: MidiStoreState;
};

function musicalTracks(name: string): CompositeProjectDocument['tracks'] {
    return {
        tracks: [
            {
                id: 'track-bass',
                name,
                kind: 'midi',
                gain: 0.8,
                pan: 0,
                muted: false,
                notes: 'Preserve this arrangement',
                clips: [
                    {
                        id: 'clip-bass',
                        trackId: 'track-bass',
                        name: 'Bass phrase',
                        startBeat: 4,
                        endBeat: 8,
                        type: 'midi',
                        midiOffsetBeats: 0,
                    },
                ],
            },
        ],
    };
}

function compositeDocument(): NonNullable<ReturnType<typeof getCrdtDoc<CompositeProjectDocument>>> {
    const doc = getCrdtDoc<CompositeProjectDocument>('root');
    if (!doc) {
        throw new Error('Expected the composite root document');
    }
    return doc;
}

function mergeCompositeConflict(kind: 'map' | 'list'): void {
    createCrdtDoc('root');
    mutateCrdtDoc<CompositeProjectDocument>({
        id: 'root',
        changeFn: (draft) => {
            draft.tracks = musicalTracks('Initial bass');
            draft.midi = {
                probabilitySeed: 7,
                ccByClipId: {},
                pitchBendByClipId: {},
                noteCoordinateFormat: 'clip-relative',
                notesByClipId: {
                    'clip-bass': [{ id: 'note-bass', pitch: 36, startBeat: 0, duration: 1, velocity: 97 }],
                },
            };
            draft.midi.notesByClipId['clip-bass']![0]!.duration = 0.9999999999999999;
        },
    });
    const base = compositeDocument();
    const local = change(clone(base, { actor: '0'.repeat(64) }), (draft) => {
        if (kind === 'map') {
            draft.tracks = musicalTracks('Local bass');
        } else {
            draft.tracks.tracks = musicalTracks('Local bass').tracks;
        }
    });
    const remote = change(clone(base, { actor: 'f'.repeat(64) }), (draft) => {
        if (kind === 'map') {
            draft.tracks = musicalTracks('Resolved bass');
        } else {
            draft.tracks.tracks = musicalTracks('Resolved bass').tracks;
        }
        // Direct scalar writes seed the exact source double; a bulk fixture import
        // could round it before the repair under test ever sees it (#5042).
        draft.tracks.tracks[0]!.gain = 0.9999999999999999;
        draft.tracks.tracks[0]!.clips[0]!.midiOffsetBeats = 0.9999999999999999;
    });
    replaceCrdtDocInLineage({ id: 'root', doc: merge(local, remote) });
}

describe('handleRepairProjectData against a conflicted document', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        registerCrdtStorageRuntime();
        agentProjectInspectionPort.setProvider(() => ({
            audioGraphValid: true,
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        clearHandlerRegistry();
        clearUndoHistory();
        agentProjectRepairStateStore.set(null);
        registerCanaryHandler();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        removeCrdtDoc('root');
        agentProjectInspectionPort.setProvider(null);
        agentProjectRepairStateStore.set(null);
        clearHandlerRegistry();
        clearUndoHistory();
        vi.unstubAllGlobals();
    });

    it('keeps the resolved conflict value, clears the gate, and re-admits mutations', async () => {
        seedProjectDocument();

        // Undo history exists before anything goes wrong; the repair must not
        // disturb it (the repair changes no musical content).
        await executeAppAction({
            type: 'setTrackPan',
            payload: { expectedPan: 0, pan: 0.1, trackId: 'track-bass' },
        });
        expect(undoStore.value?.past.length).toBe(1);

        mergeConflictingRemoteEdit();
        projectCrdtToStores();

        // The merged conflict holds the gate: every action is refused...
        expect(agentProjectRepairStateStore.value).toMatchObject({
            repairCandidates: [{ kind: 'choose-automerge-conflict-value', path: ['targets', 'track-bass', 'gain'] }],
            status: 'repair-required',
        });
        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0.1, pan: 0.2, trackId: 'track-bass' } })
        ).rejects.toThrow('Action conflicts with current project state: setTrackPan');

        // ...except the repair itself, which is the admitted route through it.
        await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

        expect(agentProjectRepairStateStore.value).toBeNull();
        const repaired = getCrdtDoc('root') as ProjectDocument | null;
        if (!repaired) {
            throw new Error('Expected the repaired root document');
        }
        expect(findAutomergeProjectConflicts({ document: repaired })).toEqual([]);
        // The conflict resolves to the remote value (0.7) by actor order at equal counters.
        // The repair closes the conflict by keeping that resolved value rather than
        // re-imposing the local preference.
        expect(repaired.targets['track-bass']?.gain).toBe(0.7);

        // Mutations are re-admitted and undo history survived the repair.
        expect(undoStore.value?.past.length).toBe(1);
        await expect(
            executeAppAction({ type: 'setTrackPan', payload: { expectedPan: 0.1, pan: 0.2, trackId: 'track-bass' } })
        ).resolves.toBeUndefined();
        expect(undoStore.value?.past.length).toBe(2);
    });

    it.each(['map', 'list'] as const)(
        'repairs a genuine concurrent %s conflict without changing musical truth',
        async (kind) => {
            clearHandlerRegistry();
            registerHandlerMap({
                repairProjectData: handleRepairProjectData,
                setTrackPan: getArrangementHandlers().setTrackPan,
            });
            mergeCompositeConflict(kind);
            const expectedPath = kind === 'map' ? ['tracks'] : ['tracks', 'tracks'];
            const before = compositeDocument();
            const headsBefore = getHeads(before);
            const resolved = toJS(before);
            const resolvedTracks = resolved.tracks;
            const resolvedMidi = resolved.midi;
            expect(before.tracks.tracks[0]?.gain).toBe(0.9999999999999999);
            expect(before.tracks.tracks[0]?.clips[0]?.midiOffsetBeats).toBe(0.9999999999999999);
            expect(before.midi.notesByClipId['clip-bass']?.[0]?.duration).toBe(0.9999999999999999);
            expect(findAutomergeProjectConflicts({ document: before })).toMatchObject([{ path: expectedPath }]);
            projectCrdtToStores({ resetProjections: true });
            expect(agentProjectRepairStateStore.value).toMatchObject({
                status: 'repair-required',
                repairCandidates: [{ kind: 'choose-automerge-conflict-value', path: expectedPath }],
            });
            const edit = {
                type: 'setTrackPan',
                payload: { expectedPan: 0, pan: 0.25, trackId: 'track-bass', automationRecordingPolicy: 'suppressed' },
            } as const;
            await expect(executeAppAction(edit)).rejects.toThrow(
                'Action conflicts with current project state: setTrackPan'
            );

            await expect(executeAppAction({ type: 'repairProjectData' })).resolves.toBeUndefined();

            const repaired = compositeDocument();
            expect(getHeads(repaired)).not.toEqual(headsBefore);
            expect(findAutomergeProjectConflicts({ document: repaired })).toEqual([]);
            expect(agentProjectRepairStateStore.value).toBeNull();
            expect(repaired.tracks).toEqual(resolvedTracks);
            expect(repaired.midi).toEqual(resolvedMidi);
            expect(trackStore.value?.tracks).toMatchObject(resolvedTracks.tracks);
            expect(midiStore.value).toEqual(resolvedMidi);
            expect(undoStore.value?.past).toHaveLength(0);

            // Reload the saved Automerge bytes, then rebuild the actual store projections.
            replaceCrdtDocInLineage({ id: 'root', doc: load<CompositeProjectDocument>(save(repaired)) });
            projectCrdtToStores({ resetProjections: true });
            expect(findAutomergeProjectConflicts({ document: compositeDocument() })).toEqual([]);
            expect(agentProjectRepairStateStore.value).toBeNull();
            expect(compositeDocument().tracks).toEqual(resolvedTracks);
            expect(compositeDocument().midi).toEqual(resolvedMidi);
            expect(trackStore.value?.tracks).toMatchObject(resolvedTracks.tracks);
            expect(midiStore.value).toEqual(resolvedMidi);

            await expect(executeAppAction(edit)).resolves.toBeUndefined();
            flushAutomergeStorageWrites();
            expect(compositeDocument().tracks.tracks[0]?.pan).toBe(0.25);
            expect(trackStore.value?.tracks[0]?.pan).toBe(0.25);
            expect(compositeDocument().tracks.tracks[0]?.gain).toBe(0.9999999999999999);
            expect(undoStore.value?.past).toHaveLength(1);
        }
    );
});
