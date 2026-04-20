import { getTrackById } from '../repositories/track/getTrackById';
import { updateTrack } from '../repositories/track/updateTrack';
import { midiStore } from '#/modules/MIDI/stores';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { addTrack } from './addTrack';
import { type Clip } from '../models/Track';

export function duplicateTrack(trackId: string): void {
    const source = getTrackById(trackId);
    if (!source) {
        return;
    }

    const newTrackId = `track-dup-${crypto.randomUUID().slice(0, 8)}`;
    
    // 1. Deep copy alternatives and their clips
    const newAlternatives = source.alternatives.map((alt) => {
        const newAltId = `alt-dup-${crypto.randomUUID().slice(0, 8)}`;
        const newClips: Clip[] = alt.clips.map((clip) => {
            const newClipId = `clip-dup-${crypto.randomUUID().slice(0, 8)}`;
            
            // Handle MIDI data duplication (notes, CC, pitch bend)
            if (clip.type === 'midi') {
                const midiState = midiStore.value;
                if (midiState) {
                    const sourceNotes = midiState.notesByClipId[clip.id];
                    const sourceCc = midiState.ccByClipId[clip.id];
                    const sourcePb = midiState.pitchBendByClipId[clip.id];

                    const updates: Partial<typeof midiState> = {};
                    if (sourceNotes && sourceNotes.length > 0) {
                        updates.notesByClipId = {
                            ...midiState.notesByClipId,
                            [newClipId]: sourceNotes.map((n) => ({
                                ...n,
                                id: `note-dup-${crypto.randomUUID().slice(0, 8)}`,
                            })),
                        };
                    }
                    if (sourceCc && sourceCc.length > 0) {
                        updates.ccByClipId = {
                            ...midiState.ccByClipId,
                            [newClipId]: sourceCc.map((cc) => ({
                                ...cc,
                                id: `cc-dup-${crypto.randomUUID().slice(0, 8)}`,
                            })),
                        };
                    }
                    if (sourcePb && sourcePb.length > 0) {
                        updates.pitchBendByClipId = {
                            ...midiState.pitchBendByClipId,
                            [newClipId]: sourcePb.map((pb) => ({
                                ...pb,
                                id: `pb-dup-${crypto.randomUUID().slice(0, 8)}`,
                            })),
                        };
                    }
                    if (Object.keys(updates).length > 0) {
                        midiStore.set({ ...midiState, ...updates });
                    }
                }
            }

            // Duplicate automation lanes for this clip
            duplicateClipAutomation(clip.id, newClipId);

            return {
                ...clip,
                id: newClipId,
                trackId: newTrackId,
            };
        });

        return {
            ...alt,
            id: newAltId,
            clips: newClips,
        };
    });

    // 2. Find new active alternative ID
    const sourceActiveIndex = source.alternatives.findIndex((alt) => alt.id === source.activeAlternativeId);
    const newActiveAlternativeId = newAlternatives[sourceActiveIndex]?.id ?? newAlternatives[0]?.id ?? '';

    // 3. Add the track
    const newTrack = addTrack({ 
        id: newTrackId,
        name: `${source.name} (copy)`, 
        kind: source.kind 
    });
    
    if (!newTrack) {
        return;
    }

    // 4. Update track with copied devices, sends, and alternatives
    updateTrack(newTrack.id, (t) => ({
        ...t,
        gain: source.gain,
        pan: source.pan,
        color: source.color,
        devices: source.devices.map((d) => ({
            ...d,
            id: `dev-dup-${crypto.randomUUID().slice(0, 8)}`,
        })),
        sends: [...source.sends],
        alternatives: newAlternatives,
        activeAlternativeId: newActiveAlternativeId,
        clips: newAlternatives.find((alt) => alt.id === newActiveAlternativeId)?.clips ?? [],
        vcaGroupId: source.vcaGroupId,
        outputId: source.outputId,
        followChordTrack: source.followChordTrack,
        notes: source.notes,
    }));
}
