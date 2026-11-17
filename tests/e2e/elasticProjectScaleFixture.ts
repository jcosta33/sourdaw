import { getChangesMetaSince, getHeads, getMissingDeps, toJS, type Heads } from '@automerge/automerge';

import { getWarpState, markerStore, takeLaneStore, trackStore } from '../../src/modules/Arrangement/stores';
import { automationStore } from '../../src/modules/Automation/stores';
import { executeAppAction, executeAppActionBatch } from '../../src/modules/Command/useCases';
import { getCrdtDoc, settlePendingProjectWritesAndCaptureRevision } from '../../src/modules/CrdtDocument/useCases';
import { midiStore } from '../../src/modules/MIDI/stores';
import { type ArrangementStoreState, projectStore } from '../../src/modules/Project/stores';
import { buildProjectData, getProjectSnapshotKey } from '../../src/modules/Project/useCases';
import { tempoMapStore, timeSignatureMapStore } from '../../src/modules/Transport/stores';

/** A substantial arrangement and edit session, rather than padding an unrelated document field. */
export const elasticProjectScale = {
    audioTracks: 16,
    midiTracks: 16,
    clipsPerTrack: 8,
    notesPerMidiClip: 64,
    detectedClips: 8,
    markersPerDetectedClip: 120,
    historyEdits: 2048,
} as const;

/** Plain caller-read truth, captured outside Detect's measured interval. */
export function captureElasticProjectScalePreservedState(targetClipId: string) {
    const document = getCrdtDoc<{
        tracks?: Pick<NonNullable<typeof trackStore.value>, 'tracks'>;
        midi?: NonNullable<typeof midiStore.value>;
        warpStates?: { states: Record<string, unknown> };
    }>('root');
    if (!document) {
        throw new Error('Project-scale preservation requires the actual root document');
    }
    const clips = (trackStore.value?.tracks ?? []).flatMap((track) => track.clips);
    const companionClips = clips.filter((clip) => clip.id !== targetClipId && getWarpState(clip.id).markers.length > 0);
    const companionIds = companionClips.map((clip) => clip.id);
    const raw = toJS(document);
    // Store decoding materializes plain values; the native document uses its own conversion above.
    const projected = structuredClone({
        tracks: trackStore.value?.tracks,
        midi: midiStore.value,
        warpStates: Object.fromEntries(companionIds.map((clipId) => [clipId, getWarpState(clipId)])),
    });
    return {
        raw: {
            tracks: raw.tracks,
            midi: raw.midi,
            warpStates: Object.fromEntries(
                Object.entries(raw.warpStates?.states ?? {}).filter(([clipId]) => clipId !== targetClipId)
            ),
        },
        projected,
    };
}

/** Read native cached arrangements independently of the serializer's active-snapshot refresh. */
export async function captureElasticPersistenceTruth(targetClipId: string) {
    settlePendingProjectWritesAndCaptureRevision();
    const document = getCrdtDoc<{
        tracks: Pick<NonNullable<typeof trackStore.value>, 'tracks'>;
        midi: NonNullable<typeof midiStore.value>;
        arrangements: ArrangementStoreState;
        projectMeta: { projectId: string; createdAt: number };
    }>('root');
    const project = projectStore.value;
    if (!document || !project?.projectId || project.loading || !project.initialized) {
        throw new Error('Persistence acceptance requires a fully loaded real project');
    }
    const raw = toJS(document);
    const active = raw.arrangements.arrangements.find((entry) => entry.id === raw.arrangements.activeArrangementId);
    const targetTrack = raw.tracks.tracks.find((track) => track.clips.some((clip) => clip.id === targetClipId));
    if (!active || !targetTrack) {
        throw new Error('Persistence acceptance lost the active arrangement or target track');
    }
    const midiState = midiStore.value;
    if (!midiState) {
        throw new Error('Persistence acceptance requires the actual MIDI projection');
    }
    const midi: typeof active.midi = {
        notesByClipId: midiState.notesByClipId,
        ccByClipId: midiState.ccByClipId,
        pitchBendByClipId: midiState.pitchBendByClipId,
    };
    if (midiState.noteCoordinateFormat === 'clip-relative') {
        midi.noteCoordinateFormat = 'clip-relative';
    }
    const expectedActive = {
        id: active.id,
        name: active.name,
        tracks: { tracks: raw.tracks.tracks, selectedTrackId: trackStore.value?.selectedTrackId ?? null },
        automation: automationStore.value ?? { lanes: [] },
        midi,
        tempoMap: tempoMapStore.value ?? undefined,
        timeSignatureMap: timeSignatureMapStore.value ?? undefined,
        markers: markerStore.value ?? undefined,
        takeLanes: takeLaneStore.value ?? undefined,
    };
    const built = await buildProjectData({ includeAudioBuffers: false });
    if (!built) {
        throw new Error('Persistence acceptance could not capture the real wire representation');
    }
    return {
        projectId: project.projectId,
        createdAt: project.createdAt,
        nativeProjectId: raw.projectMeta.projectId,
        nativeCreatedAt: raw.projectMeta.createdAt,
        dirty: projectStore.value?.dirty,
        targetTrack: { id: targetTrack.id, name: targetTrack.name },
        historyHashes: getChangesMetaSince(document, [])
            .map((change) => change.hash)
            .sort(),
        preserved: captureElasticProjectScalePreservedState(targetClipId),
        nativeActive: active,
        expectedActive: structuredClone(expectedActive),
        wire: built.data,
    };
}

/** Read the named record of record without importing a private repository or installing a snapshot. */
export async function readElasticNamedProject(createdAt: number): Promise<unknown> {
    const key = getProjectSnapshotKey(createdAt);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('sourdaw-projects');
        request.onupgradeneeded = () => {
            request.transaction?.abort();
            reject(new Error('Named project database must already exist after public Save'));
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Named project database read failed'));
    });
    try {
        return await new Promise<unknown>((resolve, reject) => {
            const transaction = database.transaction('projects', 'readonly');
            const request = transaction.objectStore('projects').get(key);
            transaction.oncomplete = () => {
                try {
                    const value: unknown = request.result;
                    if (typeof value !== 'string') {
                        throw new TypeError('Public Save did not write the expected named JSON record');
                    }
                    const parsed: unknown = JSON.parse(value);
                    resolve(parsed);
                } catch (error) {
                    reject(error instanceof Error ? error : new Error(String(error)));
                }
            };
            transaction.onerror = () => reject(transaction.error ?? new Error('Named JSON read failed'));
            transaction.onabort = () => reject(transaction.error ?? new Error('Named JSON read aborted'));
        });
    } finally {
        database.close();
    }
}

export function inspectElasticProjectScale(historyHeads: Heads) {
    const projectRevision = settlePendingProjectWritesAndCaptureRevision();
    const document = getCrdtDoc<{
        tracks?: Pick<NonNullable<typeof trackStore.value>, 'tracks'>;
        midi?: Pick<NonNullable<typeof midiStore.value>, 'notesByClipId'>;
        warpStates?: { states: Record<string, Pick<ReturnType<typeof getWarpState>, 'markers'>> };
    }>('root');
    if (!document) {
        throw new Error('Project-scale fixture requires the actual root document');
    }
    const tracks = document.tracks?.tracks.filter((track) => track.kind === 'audio' || track.kind === 'midi') ?? [];
    const changes = getChangesMetaSince(document, []);
    const slotJsonBytes = Object.fromEntries(
        Object.entries(document).map(([slot, value]) => [slot, new TextEncoder().encode(JSON.stringify(value)).length])
    );
    return {
        // Sum of slot-value JSON UTF-8 sizes, not an encoded native document size.
        rootSlotValueJsonBytes: Object.values(slotJsonBytes).reduce((sum, bytes) => sum + bytes, 0),
        projectRevision,
        changes: changes.length,
        actors: [...new Set(changes.map((change) => change.actor))],
        heads: getHeads(document),
        historyRetained: getMissingDeps(document, historyHeads).length === 0,
        slotJsonBytes,
        audioTracks: tracks.filter((track) => track.kind === 'audio').length,
        midiTracks: tracks.filter((track) => track.kind === 'midi').length,
        clips: tracks.reduce((count, track) => count + track.clips.length, 0),
        notes: Object.values(document.midi?.notesByClipId ?? {}).reduce((count, notes) => count + notes.length, 0),
        elasticClips: tracks
            .flatMap((track) => track.clips)
            .flatMap((clip) => {
                const markers = document.warpStates?.states[clip.id]?.markers ?? [];
                return markers.length > 0 ? [{ clipId: clip.id, markers: markers.length }] : [];
            }),
    };
}

/** Called after the existing 120-second stereo source has been imported through the UI. */
export async function seedElasticProjectScale() {
    const started = performance.now();
    const progress = (phase: string, completed: number): void => {
        console.info(
            '[elastic-project-scale-setup]',
            JSON.stringify({ phase, completed, elapsedMs: performance.now() - started })
        );
    };
    const execute = async (action: Parameters<typeof executeAppAction>[0]): Promise<void> => {
        await executeAppAction(action);
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const executeBatch = async (actions: Parameters<typeof executeAppActionBatch>[0]): Promise<void> => {
        const result = await executeAppActionBatch(actions);
        if (result.status !== 'committed' || result.actions.length !== actions.length) {
            throw new Error(`Project-scale arrangement batch did not fully commit: ${result.status}`);
        }
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    };
    const initial = trackStore.value?.tracks.filter((track) => track.kind === 'audio');
    const sourceTrack = initial?.[0];
    const sourceClip = sourceTrack?.clips.find((clip) => clip.type === 'audio');
    if (initial?.length !== 1 || !sourceTrack || !sourceClip?.audioBufferId) {
        throw new Error('Project-scale fixture starts from one actual imported audio clip');
    }
    const sourceLength = sourceClip.endBeat - sourceClip.startBeat;
    const documentBeforeEdits = getCrdtDoc('root');
    if (!documentBeforeEdits) {
        throw new Error('Project-scale fixture lost its root before editing');
    }
    const headsBeforeEdits = getHeads(documentBeforeEdits);
    progress('history', 0);
    // The final arrangement retains these actual edits; constructing them while the
    // project is small avoids repeatedly reconciling its later clips and notes.
    for (let edit = 0; edit < elasticProjectScale.historyEdits; edit++) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === sourceTrack.id);
        if (!track) {
            throw new Error('Project-scale edit lost its actual track');
        }
        if (edit % 3 === 0) {
            await execute({ type: 'renameTrack', payload: { trackId: track.id, name: `Scale edit ${edit}` } });
        } else if (edit % 3 === 1) {
            await execute({
                type: 'setTrackGain',
                payload: { trackId: track.id, gain: track.gain === 0.75 ? 0.875 : 0.75, expectedGain: track.gain },
            });
        } else {
            await execute({
                type: 'setTrackPan',
                payload: { trackId: track.id, pan: track.pan === -0.25 ? 0.25 : -0.25, expectedPan: track.pan },
            });
        }
        if ((edit + 1) % 128 === 0) {
            progress('history', edit + 1);
        }
    }
    const documentAfterEdits = getCrdtDoc('root');
    if (!documentAfterEdits) {
        throw new Error('Project-scale fixture lost its edited root');
    }
    const historyEditChanges = getChangesMetaSince(documentAfterEdits, headsBeforeEdits).length;
    const historyHeads = getHeads(documentAfterEdits);
    progress('tracks', 0);
    const trackIds = [sourceTrack.id];
    for (let index = 1; index < elasticProjectScale.audioTracks + elasticProjectScale.midiTracks; index++) {
        const id = `scale-track-${index}`;
        const kind = index < elasticProjectScale.audioTracks ? 'audio' : 'midi';
        await execute({
            type: 'addTrack',
            payload: { id, kind, name: `Scale ${kind} ${index + 1}`, select: false },
        });
        trackIds.push(id);
    }
    progress('tracks', trackIds.length);
    progress('clips-and-notes', 0);
    const elasticClipIds: string[] = [];
    for (const [trackIndex, trackId] of trackIds.entries()) {
        const audio = trackIndex < elasticProjectScale.audioTracks;
        const clipActions: Parameters<typeof executeAppAction>[0][] = [];
        const noteActions: Parameters<typeof executeAppAction>[0][] = [];
        for (let clipIndex = 0; clipIndex < elasticProjectScale.clipsPerTrack; clipIndex++) {
            if (trackIndex === 0 && clipIndex === 0) {
                continue;
            }
            const clipId = `scale-clip-${trackIndex}-${clipIndex}`;
            const length = audio ? sourceLength : 32;
            const clipPayload: Extract<Parameters<typeof executeAppAction>[0], { type: 'addClip' }>['payload'] = {
                id: clipId,
                trackId,
                name: `Scale phrase ${clipIndex + 1}`,
                type: audio ? 'audio' : 'midi',
                startBeat: clipIndex * length,
                endBeat: (clipIndex + 1) * length,
            };
            if (audio) {
                clipPayload.audioBufferId = sourceClip.audioBufferId;
                clipPayload.assetHash = sourceClip.assetHash;
            }
            clipActions.push({ type: 'addClip', payload: clipPayload });
            if (audio && clipIndex === 0 && trackIndex <= elasticProjectScale.detectedClips) {
                elasticClipIds.push(clipId);
            }
            if (!audio) {
                noteActions.push({
                    type: 'addNotes',
                    payload: {
                        clipId,
                        notes: Array.from({ length: elasticProjectScale.notesPerMidiClip }, (_, note) => ({
                            pitch: 48 + ((note + trackIndex) % 24),
                            startBeat: note / 2,
                            duration: 0.375,
                            velocity: 0.5 + (note % 5) / 10,
                        })),
                    },
                });
            }
        }
        // Notes describe and validate their existing clips before the batch runs.
        // Commit the track's clip batch first, then its bounded note batch.
        await executeBatch(clipActions);
        if (noteActions.length > 0) {
            await executeBatch(noteActions);
        }
        if ((trackIndex + 1) % 4 === 0) {
            progress('clips-and-notes', trackIndex + 1);
        }
    }
    progress('companion-detect', 0);
    for (const [index, clipId] of elasticClipIds.entries()) {
        await execute({ type: 'detectTransients', payload: { clipId, sensitivity: 0.5 } });
        if (getWarpState(clipId).markers.length !== elasticProjectScale.markersPerDetectedClip) {
            throw new Error(`Project-scale Detect did not produce the expected source markers: ${clipId}`);
        }
        progress('companion-detect', index + 1);
    }
    progress('checkpoint', 0);
    const snapshot = inspectElasticProjectScale(historyHeads);
    progress('complete', 1);
    return {
        targetClipId: sourceClip.id,
        targetTrackId: sourceTrack.id,
        historyEditChanges,
        historyHeads,
        ...snapshot,
    };
}
