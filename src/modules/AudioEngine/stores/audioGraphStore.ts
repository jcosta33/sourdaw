import { Container } from "#/helpers/DependencyInjector/Container";
import { Logger } from "#/helpers/Logger/Logger";
import { Store } from "#/helpers/Store/Store";
import { type AudioGraphState, defaultAudioGraphState } from "../models/AudioGraph";

const logger = Container.getInstance().get(Logger);

export const audioGraphStore = new Store<AudioGraphState>(logger, {
    initialData: defaultAudioGraphState,
});
