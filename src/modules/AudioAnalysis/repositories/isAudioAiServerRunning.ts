import { isTauri } from '#/utils/tauriBridge';

// eslint-disable-next-line @typescript-eslint/require-await -- callers expect Promise<boolean>
export async function isAudioAiServerRunning(): Promise<boolean> {
    return isTauri();
}
