import { openCachedAudioBufferHold } from '#/modules/AudioEngine/useCases/openCachedAudioBufferHold';

let importedSampleResidency: ReturnType<typeof openCachedAudioBufferHold> | null = null;

/** Keeps sidebar-imported sample PCM resident until the browsing session ends. */
export function registerBrowserImportedSampleAudio(bufferId: string): void {
    importedSampleResidency ??= openCachedAudioBufferHold();
    importedSampleResidency.retain(bufferId);
}
