import { decodeAudioFile as decodeAudioFileImpl } from '#/modules/AudioEngine/useCases';

export function decodeAudioFile(...args: Parameters<typeof decodeAudioFileImpl>) {
    return decodeAudioFileImpl(...args);
}
