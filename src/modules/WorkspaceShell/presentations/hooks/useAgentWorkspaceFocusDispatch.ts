import { useEffect, type RefObject } from 'react';

import type { AgentWorkspaceFocusRequest } from './useAgentWorkspaceRunSelection';

type AgentWorkspaceFocusRefs = {
    summaryHeadingRef: RefObject<HTMLHeadingElement | null>;
    runListRef: RefObject<HTMLDivElement | null>;
    comparisonToggleRef: RefObject<HTMLButtonElement | null>;
};

/**
 * Dispatches the one shared focus request both the run-selection hook and the
 * comparison controller write into. It lives here, not in either producer,
 * because it is the one place a run-list ref, a heading ref and a
 * comparison-toggle ref all need to be in scope together.
 */
export function useAgentWorkspaceFocusDispatch(
    focusRequest: AgentWorkspaceFocusRequest,
    setFocusRequest: (request: AgentWorkspaceFocusRequest) => void,
    refs: AgentWorkspaceFocusRefs,
    comparisonActive: boolean
): void {
    useEffect(() => {
        if (focusRequest === null) {
            return;
        }
        if (focusRequest === 'heading') {
            refs.summaryHeadingRef.current?.focus();
            setFocusRequest(null);
            return;
        }
        if (focusRequest === 'list') {
            refs.runListRef.current?.focus();
            setFocusRequest(null);
            return;
        }
        // 'comparison': start() settles asynchronously through the serialised
        // queue, so the toggle this focuses does not exist until the view
        // reports an active session.
        if (!comparisonActive) {
            return;
        }
        refs.comparisonToggleRef.current?.focus();
        setFocusRequest(null);
    }, [
        focusRequest,
        comparisonActive,
        refs.comparisonToggleRef,
        refs.runListRef,
        refs.summaryHeadingRef,
        setFocusRequest,
    ]);
}
