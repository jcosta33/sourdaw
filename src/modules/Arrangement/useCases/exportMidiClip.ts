import { inject } from '#/infra/di/inject';
import { downloadMidiFile, getMidiStoreState } from '#/modules/MIDI';
import { getAllTracks } from './getAllTracks';

export const exportMidiClip = inject({ getAllTracks, getMidiStoreState, downloadMidiFile })(
    ({ getAllTracks, getMidiStoreState, downloadMidiFile }) =>
        function exportMidiClip(clipId: string): void {
            const tracks = getAllTracks();
            const midi = getMidiStoreState();
            if (tracks.length === 0 || !midi) {
                return;
            }

            let clipName = 'export';
            let clipStartBeat = 0;
            for (const track of tracks) {
                const clip = track.clips.find((candidateClip) => candidateClip.id === clipId);
                if (clip) {
                    clipName = clip.name || track.name;
                    clipStartBeat = clip.startBeat;
                    break;
                }
            }

            const notes = midi.notesByClipId[clipId] ?? [];
            const ccs = midi.ccByClipId[clipId] ?? [];

            downloadMidiFile({ clipName, clipStartBeat, notes, ccs });
        }
);
