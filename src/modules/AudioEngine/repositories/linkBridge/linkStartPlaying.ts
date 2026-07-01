import { invokeLink } from './invokeLink';

export async function linkStartPlaying(): Promise<void> {
    await invokeLink('link_start_playing');
}
