import { invokeLink } from './invokeLink';

export async function setLinkTempo(tempo: number): Promise<void> {
    await invokeLink('set_link_tempo', { tempo });
}
