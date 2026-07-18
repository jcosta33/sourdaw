import { type ReactElement } from 'react';

import { ProjectLoadingOverlay } from '../components/ProjectLoadingOverlay';

export const WorkspaceProjectLoadingFallback = (): ReactElement => {
    return <ProjectLoadingOverlay />;
};
