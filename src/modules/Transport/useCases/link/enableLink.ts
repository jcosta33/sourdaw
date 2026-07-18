import { enableLink as enableLinkBridge } from '../../repositories/linkBridge/enableLink';

type LinkStatus = {
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
};

export async function enableLink(): Promise<LinkStatus> {
    return await enableLinkBridge();
}
