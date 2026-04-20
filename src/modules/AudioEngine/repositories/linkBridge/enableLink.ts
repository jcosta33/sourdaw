import { type LinkStatus, invokeLink } from './helpers';

export async function enableLink(): Promise<LinkStatus> {
    return (await invokeLink('enable_link')) as LinkStatus;
}
