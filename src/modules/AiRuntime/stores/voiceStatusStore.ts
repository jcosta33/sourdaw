/**
 * voiceStatusStore — lightweight store so VoiceButton can reflect
 * the active listening state that lives inside useVoiceRecording.
 */
import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

export type VoiceStatus = {
    isListening: boolean;
    transcribing: boolean;
};

const logger = Container.getInstance().get(Logger);

export const voiceStatusStore = new Store<VoiceStatus>(logger, {
    initialData: { isListening: false, transcribing: false },
});
