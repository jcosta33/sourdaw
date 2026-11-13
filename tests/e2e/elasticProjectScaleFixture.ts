import { getChangesMetaSince, getHeads } from '@automerge/automerge';

import { getWarpState, trackStore } from '../../src/modules/Arrangement/stores';
import { executeAppAction } from '../../src/modules/Command/useCases';
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
    const initial = trackStore.value?.tracks.filter((track) => track.kind === 'audio');
    const sourceTrack = initial?.[0];
    const sourceClip = sourceTrack?.clips.find((clip) => clip.type === 'audio');
    if (initial?.length !== 1 || !sourceTrack || !sourceClip?.audioBufferId) {
        throw new Error('Project-scale fixture starts from one actual imported audio clip');
    }
    const sourceLength = sourceClip.endBeat - sourceClip.startBeat;
    const trackIds = [sourceTrack.id];
    for (let index = 1; index < elasticProjectScale.audioTracks + elasticProjectScale.midiTracks; index++) {
        const id = `scale-track-${index}`;
        const kind = index < elasticProjectScale.audioTracks ? 'audio' : 'midi';
        await executeAppAction({
            type: 'addTrack',
            payload: { id, kind, name: `Scale ${kind} ${index + 1}`, select: false },
        });
        trackIds.push(id);
    }
    const elasticClipIds: string[] = [];
    for (const [trackIndex, trackId] of trackIds.entries()) {
        const audio = trackIndex < elasticProjectScale.audioTracks;
        for (let clipIndex = 0; clipIndex < elasticProjectScale.clipsPerTrack; clipIndex++) {
            if (trackIndex === 0 && clipIndex === 0) continue;
            const clipId = `scale-clip-${trackIndex}-${clipIndex}`;
            const length = audio ? sourceLength : 32;
            await executeAppAction({
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
                await executeAppAction({
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
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    for (const clipId of elasticClipIds) {
        await executeAppAction({ type: 'detectTransients', payload: { clipId, sensitivity: 0.5 } });
        if (getWarpState(clipId).markers.length !== elasticProjectScale.markersPerDetectedClip) {
            throw new Error(`Project-scale Detect did not produce the expected source markers: ${clipId}`);
        }
    }
    const documentBeforeEdits = getCrdtDoc('root');
    if (!documentBeforeEdits) throw new Error('Project-scale fixture lost its root before editing');
    const changesBeforeEdits = getChangesMetaSince(documentBeforeEdits, []).length;
    for (let edit = 0; edit < elasticProjectScale.historyEdits; edit++) {
        const trackId = trackIds[edit % trackIds.length];
        const track = trackStore.value?.tracks.find((candidate) => candidate.id === trackId);
        if (!track) throw new Error('Project-scale edit lost its actual track');
        if (edit % 3 === 0) {
            await executeAppAction({ type: 'renameTrack', payload: { trackId: track.id, name: `Scale edit ${edit}` } });
        } else if (edit % 3 === 1) {
            await executeAppAction({
                type: 'setTrackGain',
                payload: { trackId: track.id, gain: track.gain === 0.75 ? 0.875 : 0.75, expectedGain: track.gain },
            });
        } else {
            await executeAppAction({
                type: 'setTrackPan',
                payload: { trackId: track.id, pan: track.pan === -0.25 ? 0.25 : -0.25, expectedPan: track.pan },
            });
        }
        if ((edit + 1) % 32 === 0) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
    }
    const snapshot = await inspectElasticProjectScale();
    return {
        targetClipId: sourceClip.id,
        targetTrackId: sourceTrack.id,
        historyEditChanges: snapshot.changes - changesBeforeEdits,
        ...snapshot,
    };
}
