import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import type { MidiNote } from "../models/MidiNote";

const logger = Container.getInstance().get(Logger);

export type MidiStoreState = {
    notesByClipId: Record<string, MidiNote[]>;
};

export const midiStore = new Store<MidiStoreState>(logger, {
    initialData: { notesByClipId: {} },
});
