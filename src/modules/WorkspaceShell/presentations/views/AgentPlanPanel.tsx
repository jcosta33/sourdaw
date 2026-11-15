import { type ComponentProps, type ReactElement } from 'react';

import { useStore } from '#/infra/store/useStore';
import { trackStore } from '#/modules/Arrangement/stores';

import { AgentPlanSection } from '../components/agentWorkspace/AgentPlanSection';

/** The plan section with the live track list, so measured targets read by the names the musician gave them. */
export const AgentPlanPanel = ({ plan }: Pick<ComponentProps<typeof AgentPlanSection>, 'plan'>): ReactElement => {
    const { tracks } = useStore(trackStore, { tracks: [], selectedTrackId: null });
    return <AgentPlanSection plan={plan} tracks={tracks} />;
};
