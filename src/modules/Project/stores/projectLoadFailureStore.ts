import { createStore } from '#/infra/store/createStore';

/**
 * Set when a project open destroyed the previous session and could not put a
 * project in its place — the CRDT authority was already replaced when the load
 * threw, so there is nothing to go back to.
 *
 * This is deliberately NOT expressed through `projectStore`'s transient flags.
 * `{ initialized: false, loading: false }` looks like "no project open" but does
 * not render as it mid-session: `AppShell` latches `launchReady` the first time
 * a project opens and never re-reveals the launch screen (`AppShell.tsx:436-444`
 * calls that out and names resetting the latch as the change any return-to-
 * launch flow must make). With no overlay and no launch screen, those flags put
 * the user in the full editor over an empty `Untitled Project` — the exact
 * "keep working while their real project is gone" outcome this whole path is
 * trying to prevent. A dedicated surface renders on its own terms instead.
 *
 * Transient and session-scoped: never persisted, never projected into the CRDT.
 */
export type ProjectLoadFailureState = {
    /** What the user is told. */
    message: string;
    /** Name of the project whose open failed, for the failure surface. */
    projectName: string;
};

export const projectLoadFailureStore = createStore<ProjectLoadFailureState | null>({
    initialData: null,
});
