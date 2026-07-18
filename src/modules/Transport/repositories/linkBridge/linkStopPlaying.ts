import { invokeLink } from './invokeLink';

export async function linkStopPlaying(): Promise<void> {
    await invokeLink('link_stop_playing');
}
