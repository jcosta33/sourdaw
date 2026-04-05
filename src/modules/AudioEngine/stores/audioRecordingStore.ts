import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';

const logger = Container.getInstance().get(Logger);

export type AudioRecordingState = {
    isRecording: boolean;
    micPermissionGranted: boolean;
};

export const audioRecordingStore = new Store<AudioRecordingState>(logger, {
    initialData: { isRecording: false, micPermissionGranted: false },
});
