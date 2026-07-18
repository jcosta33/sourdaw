/**
 * Shared type for the Sidebar view tree.
 *
 * Lives at the same depth as the Sidebar tab files so both the parent
 * Sidebar.tsx and the child tab views can import it without forming a
 * cycle through `../Sidebar`.
 */

export type SidebarRoute = {
    id: string;
    title: string;
    payload?: Record<string, unknown>;
    /** Optional icon component for the back bar */
    icon?: React.ComponentType<{ className?: string }>;
    /** Optional color class for the icon */
    iconColor?: string;
};

/**
 * Device-panel emitters injected into the browser from the composition shell
 * (Workspace AppShell). The panel system is owned by Workspace; the browser
 * only triggers it, so these are passed in as callbacks rather than imported —
 * keeping ContentBrowser free of a dependency back into Workspace.
 */
export type SidebarPanelActions = {
    showBacteria: (deviceId: string | null) => void;
    showCrust: (deviceId: string | null) => void;
    showDevice: (deviceType: string, deviceId: string | null) => void;
    showDutchOven: (deviceId: string | null) => void;
    showGluten: (deviceId: string | null) => void;
    showProof: (deviceId: string | null) => void;
    showScoring: (deviceId: string | null) => void;
    showYeast: (deviceId: string | null) => void;
    showCrumbs: (deviceId: string | null) => void;
    showFermenter: (deviceId: string | null) => void;
    showGrandBoule: (deviceId: string | null) => void;
    showLevain: (deviceId: string | null) => void;
    showToaster: (deviceId: string | null) => void;
};
