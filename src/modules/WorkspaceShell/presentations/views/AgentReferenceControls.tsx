import { type ReactElement } from 'react';

import { AgentReferenceSection } from '../components/agentWorkspace/AgentReferenceSection';
import { useAgentReferenceController } from '../hooks/useAgentReferenceController';

/** The agent workspace's reference section, wired to the user's loaded comparison reference. */
export const AgentReferenceControls = (): ReactElement => {
    const { reference, loading, error, handleLoad, handleClear } = useAgentReferenceController();

    return (
        <AgentReferenceSection
            reference={reference}
            loading={loading}
            error={error}
            onLoad={handleLoad}
            onClear={handleClear}
        />
    );
};
