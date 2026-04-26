import { type Track } from '#/modules/Arrangement/models/Track';
import { markerStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { midiStore } from '#/modules/MIDI/stores';

import { arrangementStore, defaultArrangementId } from '../../../stores/arrangementStore';

export function syncArrangement(tracks: Track[]) {
    arrangementStore.set({
        arrangements: [
            {
                id: defaultArrangementId,
                name: 'Arrangement 1',
                tracks: { tracks, selectedTrackId: tracks.length > 0 ? (tracks[0]?.id ?? null) : null },
                automation: automationStore.value ?? { lanes: [] },
                midi: midiStore.value ?? { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                tempoMap: { changes: [] },
                timeSignatureMap: { changes: [] },
                markers: markerStore.value ?? { markers: [], sections: [] },
                takeLanes: { lanes: [] },
            },
        ],
        activeArrangementId: defaultArrangementId,
    });
}
