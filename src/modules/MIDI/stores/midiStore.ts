import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type MidiNote, type MidiCC, type MidiPitchBend } from '../models/MidiNote';

export type MidiStoreState = {
    notesByClipId: Record<string, MidiNote[]>;
    ccByClipId: Record<string, MidiCC[]>;
    pitchBendByClipId: Record<string, MidiPitchBend[]>;
};

export const midiStore = createStore<MidiStoreState>({
    storage: createAutomergeStorage(DOC_PREFIX_ROOT, 'midi'),
    initialData: {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    },
});
