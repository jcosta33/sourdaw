import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

export async function crumbsAllSoundOff(instanceId: string): Promise<void> {
    if (!isTauri()) {
        return;
    }
    await tauriInvoke('crumbs_all_sound_off', { instanceId });
}
