import { deleteAutomationTimeRange } from '#/modules/Automation/useCases';
import { removeMidiClipData, splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { markerStore } from '../../stores/markerStore';

import { timeOperationDependencies } from './timeOperationDependencies';

export function deleteTime(startBeat: number, endBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    const deps = timeOperationDependencies;
    if (!deps) {
        throw new Error('Arrangement time operation dependencies are not registered');
    }

    const duration = endBeat - startBeat;

    const removedMidiClipIds: string[] = [];
    const splitOps: Array<{
        sourceClipId: string;
        newClipId: string;
        splitBeat: number;
        discardBeforeBeat?: number;
    }> = [];

    setTrackState({
        ...state,
        tracks: state.tracks.map((track) => {
            const newClips: Clip[] = [];
            for (const clip of track.clips) {
                if (clip.endBeat <= startBeat) {
                    newClips.push(clip);
                } else if (clip.startBeat >= endBeat) {
                    newClips.push({
                        ...clip,
                        startBeat: clip.startBeat - duration,
                        endBeat: clip.endBeat - duration,
                    });
                } else if (clip.startBeat >= startBeat && clip.endBeat <= endBeat) {
                    // Fully inside deleted region — remove and clean its MIDI
                    // data (ledger M-022; previously orphaned in the store).
                    removedMidiClipIds.push(clip.id);
                } else if (clip.startBeat < startBeat && clip.endBeat > endBeat) {
                    // Spans the deleted region: split into left and right
                    // parts (same convention as deleteTimeRange, #608); the
                    // right part lands at startBeat because the timeline
                    // after endBeat shifts left by duration.
                    const rightClipId = `clip-dt-${crypto.randomUUID().slice(0, 8)}`;
                    newClips.push(
                        { ...clip, endBeat: startBeat, name: `${clip.name} (L)` },
                        {
                            ...clip,
                            id: rightClipId,
                            startBeat,
                            endBeat: clip.endBeat - duration,
                            name: `${clip.name} (R)`,
                            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                            midiOffsetBeats: 0,
                        }
                    );
                    if (clip.type === 'midi') {
                        splitOps.push({
                            sourceClipId: clip.id,
                            newClipId: rightClipId,
                            splitBeat: endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                            discardBeforeBeat: startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0),
                        });
                    }
                } else if (clip.startBeat < startBeat) {
                    // Crosses the left edge: keep the left part; in-range
                    // notes move to a throwaway id and are removed.
                    newClips.push({ ...clip, endBeat: startBeat });
                    if (clip.type === 'midi') {
                        const mediaSplit = startBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                        const discardId = `clip-dt-discard-${crypto.randomUUID().slice(0, 8)}`;
                        splitOps.push({
                            sourceClipId: clip.id,
                            newClipId: discardId,
                            splitBeat: mediaSplit,
                            discardBeforeBeat: mediaSplit,
                        });
                        removedMidiClipIds.push(discardId);
                    }
                } else {
                    // Crosses the right edge: keep the right part at
                    // startBeat with its audio content re-based (previously
                    // the offset was not adjusted, replaying the wrong media;
                    // ledger M-022). Its MIDI media starts at the split
                    // point, so it moves to a fresh id re-based at 0.
                    const rightClipId = `clip-dt-${crypto.randomUUID().slice(0, 8)}`;
                    newClips.push({
                        ...clip,
                        id: rightClipId,
                        startBeat,
                        endBeat: clip.endBeat - duration,
                        audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (endBeat - clip.startBeat),
                        midiOffsetBeats: 0,
                    });
                    if (clip.type === 'midi') {
                        const mediaSplit = endBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);
                        splitOps.push({
                            sourceClipId: clip.id,
                            newClipId: rightClipId,
                            splitBeat: mediaSplit,
                            discardBeforeBeat: mediaSplit,
                        });
                        removedMidiClipIds.push(clip.id);
                    }
                }
            }
            return { ...track, clips: newClips };
        }),
    });

    for (const op of splitOps) {
        splitMidiNotesAtBeat(op);
    }
    for (const clipId of removedMidiClipIds) {
        removeMidiClipData([clipId]);
    }

    const markerState = markerStore.value;
    if (markerState) {
        markerStore.set({
            ...markerState,
            markers: markerState.markers
                .filter((message) => message.beat < startBeat || message.beat >= endBeat)
                .map((message) => (message.beat >= endBeat ? { ...message, beat: message.beat - duration } : message)),
            // Sections are timeline content too: drop sections inside the
            // range and shift later ones left, or they misalign with the
            // clips (ledger M-022).
            sections: (markerState.sections ?? [])
                .filter((section) => section.endBeat <= startBeat || section.startBeat >= endBeat)
                .map((section) =>
                    section.startBeat >= endBeat
                        ? { ...section, startBeat: section.startBeat - duration, endBeat: section.endBeat - duration }
                        : section
                ),
        });
    }

    deleteAutomationTimeRange({ startBeat, endBeat });
    deps.deleteTimelineMapsTimeRange({ startBeat, endBeat });
}
