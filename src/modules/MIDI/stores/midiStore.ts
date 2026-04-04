import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { AutomergeStorage } from '#/helpers/Store/Storage/AutomergeStorage';

const DOC_PREFIX_ROOT = 'root';

import { type MidiNote, type MidiCC, type MidiPitchBend } from '../models/MidiNote';

const logger = Container.getInstance().get(Logger);

export type MidiStoreState = {
    notesByClipId: Record<string, MidiNote[]>;
    ccByClipId: Record<string, MidiCC[]>;
    pitchBendByClipId: Record<string, MidiPitchBend[]>;
};

export const midiStore = new Store<MidiStoreState>(logger, {
    storage: new AutomergeStorage(DOC_PREFIX_ROOT, 'midi'),
    initialData: {
        notesByClipId: {},
        ccByClipId: {},
        pitchBendByClipId: {},
    },
});
