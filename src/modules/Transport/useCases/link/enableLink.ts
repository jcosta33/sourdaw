import { enableLink as enableLinkBridge } from '../../repositories/linkBridge/enableLink';

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

export async function enableLink(): Promise<LinkStatus> {
    return await enableLinkBridge();
}
