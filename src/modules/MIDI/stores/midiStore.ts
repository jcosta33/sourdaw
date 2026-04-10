import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

export type MidiNote = {
    id: string;
    pitch: number;
    startBeat: number;
    duration: number;
    velocity: number;
    probability?: number;
    pressure?: number;
    slide?: number;
    pitchBend?: number;
};

export type MidiCC = {
    id: string;
    controller: number;
    value: number;
    beat: number;
    channel: number;
};

export type MidiPitchBend = {
    id: string;
    value: number;
    beat: number;
    channel: number;
};

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
