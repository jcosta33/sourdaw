import { getChangesMetaSince, getHeads, getMissingDeps } from '@automerge/automerge';

import { getWarpState, trackStore } from '../../src/modules/Arrangement/stores';
import { executeAppAction, executeAppActionBatch } from '../../src/modules/Command/useCases';
import { captureCheckpointRoot, getCrdtDoc } from '../../src/modules/CrdtDocument/useCases';
import { midiStore } from '../../src/modules/MIDI/stores';

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
export function captureElasticProjectScalePreservedState(targetClipId: string): unknown {
    const document = getCrdtDoc<{
        tracks?: unknown;
        midi?: unknown;
        warpStates?: { states: Record<string, unknown> };
    }>('root');
    if (!document) throw new Error('Project-scale preservation requires the actual root document');
    const companionIds = (trackStore.value?.tracks ?? [])
        .flatMap((track) => track.clips)
        .filter((clip) => clip.id !== targetClipId && getWarpState(clip.id).markers.length > 0)
        .map((clip) => clip.id);
    const snapshot: unknown = JSON.parse(
        JSON.stringify({
            raw: {
                tracks: document.tracks,
                midi: document.midi,
                warpStates: Object.fromEntries(
                    Object.entries(document.warpStates?.states ?? {}).filter(([clipId]) => clipId !== targetClipId)
                ),
            },
            projected: {
                tracks: trackStore.value?.tracks,
                midi: midiStore.value,
                warpStates: Object.fromEntries(companionIds.map((clipId) => [clipId, getWarpState(clipId)])),
            },
        })
    );
    return snapshot;
}

export async function inspectElasticProjectScale() {
    const { rootBytes, projectRevision } = await captureCheckpointRoot();
    const document = getCrdtDoc<Record<string, unknown>>('root');
    if (!document) throw new Error('Project-scale fixture requires the actual root document');
    const tracks = trackStore.value?.tracks.filter((track) => track.kind === 'audio' || track.kind === 'midi') ?? [];
    const changes = getChangesMetaSince(document, []);
    return {
        rootBytes: rootBytes.byteLength,
        projectRevision,
        changes: changes.length,
        actors: [...new Set(changes.map((change) => change.actor))],
        heads: getHeads(document),
        slotJsonBytes: Object.fromEntries(
            Object.entries(document).map(([slot, value]) => [
                slot,
                new TextEncoder().encode(JSON.stringify(value)).length,
            ])
        ),
        audioTracks: tracks.filter((track) => track.kind === 'audio').length,
        midiTracks: tracks.filter((track) => track.kind === 'midi').length,
        clips: tracks.reduce((count, track) => count + track.clips.length, 0),
        notes: Object.values(midiStore.value?.notesByClipId ?? {}).reduce((count, notes) => count + notes.length, 0),
        elasticClips: tracks
            .flatMap((track) => track.clips)
            .flatMap((clip) => {
                const markers = getWarpState(clip.id).markers;
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
    if (!documentBeforeEdits) throw new Error('Project-scale fixture lost its root before editing');
    const headsBeforeEdits = getHeads(documentBeforeEdits);
    progress('history', 0);
    // The final arrangement retains these actual edits; constructing them while the
    // project is small avoids repeatedly reconciling its later clips and notes.
    for (let edit = 0; edit < elasticProjectScale.historyEdits; edit++) {
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === sourceTrack.id);
        if (!track) throw new Error('Project-scale edit lost its actual track');
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
        if ((edit + 1) % 128 === 0) progress('history', edit + 1);
    }
    const documentAfterEdits = getCrdtDoc('root');
    if (!documentAfterEdits) throw new Error('Project-scale fixture lost its edited root');
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
            if (trackIndex === 0 && clipIndex === 0) continue;
            const clipId = `scale-clip-${trackIndex}-${clipIndex}`;
            const length = audio ? sourceLength : 32;
            clipActions.push({
                type: 'addClip',
                payload: {
                    id: clipId,
                    trackId,
                    name: `Scale phrase ${clipIndex + 1}`,
                    type: audio ? 'audio' : 'midi',
                    startBeat: clipIndex * length,
                    endBeat: (clipIndex + 1) * length,
                    ...(audio ? { audioBufferId: sourceClip.audioBufferId, assetHash: sourceClip.assetHash } : {}),
                },
            });
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
        if ((trackIndex + 1) % 4 === 0) progress('clips-and-notes', trackIndex + 1);
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
    const snapshot = await inspectElasticProjectScale();
    const finalDocument = getCrdtDoc('root');
    if (!finalDocument) throw new Error('Project-scale fixture lost its final root');
    progress('complete', 1);
    return {
        targetClipId: sourceClip.id,
        targetTrackId: sourceTrack.id,
        historyEditChanges,
        historyHeads,
        historyRetained: getMissingDeps(finalDocument, historyHeads).length === 0,
        ...snapshot,
    };
}
