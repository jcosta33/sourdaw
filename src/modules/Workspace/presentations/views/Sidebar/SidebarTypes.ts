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
    payload?: Record<string, any>;
    /** Optional icon component for the back bar */
    icon?: React.ComponentType<{ className?: string }>;
    /** Optional color class for the icon */
    iconColor?: string;
};
