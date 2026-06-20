import { getWorkspaceState } from '../repositories/getWorkspaceState';
import { updateWorkspaceState } from '../repositories/updateWorkspaceState';

import { type MarqueeSelection } from './workspaceQueries/helpers';

export function setMarqueeSelection(selection: MarqueeSelection | null): void {
    const current = getWorkspaceState();
    if (!current) {
        return;
    }
    updateWorkspaceState({ marqueeSelection: selection });
}
