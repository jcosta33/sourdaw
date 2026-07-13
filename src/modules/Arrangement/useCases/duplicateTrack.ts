import { inject } from '#/infra/di/inject';
import { duplicateClipAutomation } from '#/modules/Automation/useCases';
import { duplicateMidiClipData } from '#/modules/MIDI/useCases';

import { type Clip } from '../models/Track';
import { getTrackById } from '../repositories/track/getTrackById';
import { updateTrack } from '../repositories/track/updateTrack';

import { addTrack } from './addTrack';
import { ArrangementEventBus } from './arrangementEventBus';

type ClipCopy = { sourceClipId: string; targetClipId: string };

export const duplicateTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function duplicateTrack(trackId: string): void {
            const source = getTrackById(trackId);
            if (!source) {
                return;
            }

            const newTrackId = `track-dup-${crypto.randomUUID().slice(0, 8)}`;
            const midiClipCopies: ClipCopy[] = [];
            const automationClipCopies: ClipCopy[] = [];

            // 1. Deep copy alternatives and collect satellite-state work.
            const newAlternatives = source.alternatives.map((alt) => {
                const newAltId = `alt-dup-${crypto.randomUUID().slice(0, 8)}`;
                const newClips: Clip[] = alt.clips.map((clip) => {
                    const newClipId = `clip-dup-${crypto.randomUUID().slice(0, 8)}`;
                    const copy = { sourceClipId: clip.id, targetClipId: newClipId };

                    automationClipCopies.push(copy);
                    if (clip.type === 'midi') {
                        midiClipCopies.push(copy);
                    }

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

            // 3. Add the track without notifying consumers before its duplicate state is complete.
            const newTrack = addTrack({
                id: newTrackId,
                name: `${source.name} (copy)`,
                kind: source.kind,
                suppressAddedEvent: true,
            });

            if (!newTrack) {
                return;
            }

            // 4. Update track with copied devices, sends, and alternatives
            updateTrack(newTrack.id, (time) => ({
                ...time,
                gain: source.gain,
                pan: source.pan,
                color: source.color,
                devices: source.devices.map((data) => ({
                    ...data,
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

            if (midiClipCopies.length > 0) {
                duplicateMidiClipData({ copies: midiClipCopies });
            }

            for (const { sourceClipId, targetClipId } of automationClipCopies) {
                duplicateClipAutomation(sourceClipId, targetClipId);
            }

            void eventBus.emit('track.added', {
                trackId: newTrack.id,
                name: newTrack.name,
                kind: newTrack.kind,
            });
        }
);
