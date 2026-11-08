import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';

import { trackStore, type Clip } from '../../stores/trackStore';

import { readRecordingClipOwner } from './readRecordingClipOwner';
import { recordingOverdubMidiTargets } from './recordingOverdubMidiTargets';

type Position = { beat: number; passIndex: number };
type Bound =
    | { status: 'pending' | 'retired' }
    | { status: 'open'; startContextSeconds: number }
    | {
          status: 'bounded';
          startContextSeconds: number;
          ending: { contextSeconds: number; midiPosition: Position };
      };
type Provider = () => Bound;
type MidiTarget = { trackId: string; clipId: string; incarnation: string };
let owned: { root: string; provider: Provider; midiTargets: MidiTarget[] } | null = null;

function targetStillOwned(target: MidiTarget): boolean {
    const raw = readRecordingClipOwner(target.clipId);
    return (
        raw?.trackId === target.trackId &&
        raw.kind === 'midi' &&
        raw.clip.type === 'midi' &&
        raw.incarnation === target.incarnation
    );
}

/** Admission capabilities live only for their captured recording root. */
export const recordingMidiBound = {
    begin(provider?: Provider): void {
        owned = provider ? { root: captureProjectRootIdentity(), provider, midiTargets: [] } : null;
    },
    captureMidiTargets(clips: readonly Clip[], atBeat?: number): void {
        const state = owned;
        const transport = transportStore.value;
        if (!state || !transport || state.root !== captureProjectRootIdentity()) {
            return;
        }
        const targets: MidiTarget[] = [];
        for (const track of trackStore.value?.tracks ?? []) {
            if (!track.armed || track.kind !== 'midi') {
                continue;
            }
            const opened = clips.filter((clip) => clip.trackId === track.id && clip.type === 'midi');
            let candidates = opened;
            if (opened.length === 0) {
                const admitted = recordingOverdubMidiTargets(track, atBeat ?? transport.playheadPosition, transport);
                if (admitted.length > 0) {
                    // Placement may later select any original row by intersection or nearest rescue.
                    candidates = track.clips.filter((clip) => clip.type === 'midi');
                }
            }
            for (const clip of candidates) {
                const raw = readRecordingClipOwner(clip.id);
                if (raw?.trackId === track.id && raw.kind === 'midi' && raw.clip.type === 'midi') {
                    targets.push({ trackId: track.id, clipId: clip.id, incarnation: raw.incarnation });
                }
            }
        }
        state.midiTargets = targets;
    },
    hasMidiCapture(provider: Provider): boolean {
        if (!owned || owned.provider !== provider || owned.root !== captureProjectRootIdentity()) {
            return false;
        }
        return owned.midiTargets.some(targetStillOwned);
    },
    clear(): void {
        owned = null;
    },
    retire(): void {
        if (owned) {
            owned.provider = () => ({ status: 'retired' });
        }
    },
    read() {
        if (!owned) {
            return { status: 'inactive' as const };
        }
        if (owned.root !== captureProjectRootIdentity()) {
            return { status: 'retired' as const };
        }
        return owned.provider();
    },
    excludes(audioTime: number, trackId?: string | null, clipId?: string): boolean {
        const bound = this.read();
        if (bound.status === 'inactive') {
            return false;
        }
        if (
            trackId &&
            !owned?.midiTargets.some(
                (target) =>
                    target.trackId === trackId && (!clipId || target.clipId === clipId) && targetStillOwned(target)
            )
        ) {
            return true;
        }
        if (bound.status === 'open') {
            return audioTime < bound.startContextSeconds;
        }
        return (
            bound.status !== 'bounded' ||
            audioTime < bound.startContextSeconds ||
            audioTime >= bound.ending.contextSeconds
        );
    },
};
