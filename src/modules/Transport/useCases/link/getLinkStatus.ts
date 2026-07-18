import { getLinkStatus as readLinkStatus } from '../../repositories/linkBridge/getLinkStatus';

type LinkStatus = {
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
};

export async function getLinkStatus(): Promise<LinkStatus> {
    return await readLinkStatus();
}
