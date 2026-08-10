import { getLinkStatus as readLinkStatus } from '../../repositories/linkBridge/getLinkStatus';

type LinkStatus = {
    supported: boolean;
    implementation: string;
    enabled: boolean;
    tempo: number;
    quantum: number;
    beat: number;
    phase: number;
    num_peers: number;
    message: string | null;
};

export async function getLinkStatus(): Promise<LinkStatus> {
    return await readLinkStatus();
}
