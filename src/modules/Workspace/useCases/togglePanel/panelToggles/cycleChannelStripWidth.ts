import { getWorkspaceState, updateWorkspaceState } from '../../../repositories/workspace';
import { type ChannelStripWidth } from '../../workspaceQueries/helpers';

const STRIP_WIDTH_CYCLE: Record<ChannelStripWidth, ChannelStripWidth> = {
    narrow: 'normal',
    normal: 'wide',
    wide: 'narrow',
};

export const cycleChannelStripWidth = (): void => {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ channelStripWidth: STRIP_WIDTH_CYCLE[current.channelStripWidth] });
};
