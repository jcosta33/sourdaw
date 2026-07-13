import { inject } from '#/infra/di/inject';
import { duplicateClipAutomationBatch } from '#/modules/Automation/useCases';
import { duplicateMidiClipData } from '#/modules/MIDI/useCases';

import { type Clip } from '../models/Track';
import { getTrackById } from '../repositories/track/getTrackById';
import { getTrackState } from '../repositories/track/getTrackState';
import { setTrackState } from '../repositories/track/setTrackState';
import { updateTrack } from '../repositories/track/updateTrack';

import { addTrack } from './addTrack';
import { ArrangementEventBus } from './arrangementEventBus';

type ClipCopy = { sourceClipId: string; targetClipId: string };
type AutomationClipCopy = ClipCopy & { targetTrackId: string };
type Rollback = () => void;

export const duplicateTrack = inject({ eventBus: ArrangementEventBus })(
    ({ eventBus }) =>
        function duplicateTrack(trackId: string): void {
            const source = getTrackById(trackId);
            if (!source) {
                return;
            }
            const arrangementSnapshot = getTrackState();
            if (!arrangementSnapshot) {
                return;
            }

            const newTrackId = `track-dup-${crypto.randomUUID().slice(0, 8)}`;
            const midiClipCopies: ClipCopy[] = [];
            const automationClipCopies: AutomationClipCopy[] = [];

            // 1. Deep copy alternatives and collect satellite-state work.
            const newAlternatives = source.alternatives.map((alt) => {
                const newAltId = `alt-dup-${crypto.randomUUID().slice(0, 8)}`;
                const newClips: Clip[] = alt.clips.map((clip) => {
                    const newClipId = `clip-dup-${crypto.randomUUID().slice(0, 8)}`;
                    const copy = { sourceClipId: clip.id, targetClipId: newClipId };

                    automationClipCopies.push({ ...copy, targetTrackId: newTrackId });
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

            const rollbacks: Rollback[] = [];
            try {
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
                rollbacks.push(() => {
                    setTrackState(arrangementSnapshot);
                });

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
                    rollbacks.push(duplicateMidiClipData({ copies: midiClipCopies }));
                }
                rollbacks.push(duplicateClipAutomationBatch({ copies: automationClipCopies }));

                void eventBus.emit('track.added', {
                    trackId: newTrack.id,
                    name: newTrack.name,
                    kind: newTrack.kind,
                });
            } catch (error) {
                for (let index = rollbacks.length - 1; index >= 0; index--) {
                    const rollback = rollbacks[index];
                    if (!rollback) {
                        continue;
                    }
                    try {
                        rollback();
                    } catch {
                        // Rollback is best-effort so the original owner failure remains authoritative.
                    }
                }
                throw error;
            }
        }
);
