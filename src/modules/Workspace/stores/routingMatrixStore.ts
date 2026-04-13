import { createStore } from '#/infra/store/createStore';

/**
 * Routing Matrix state.
 *
 * §83.1 — previously the RoutingMatrix component stored its connection map
 * in local React state, so closing and reopening the panel silently
 * discarded every route the user had configured. A module-level store
 * (memory-backed for now) at least preserves state across panel open/close
 * within a session. Wiring this through to the audio engine so routes
 * actually produce audio, and persisting across page reloads via the
 * project CRDT, is tracked as follow-up feature work — the current scope
 * is eliminating the data-loss bug in the UI layer.
 */
export type RoutingConnection = {
    sourceId: string;
    destId: string;
    /** 0-1 send level. */
    level: number;
};

export type RoutingMatrixState = {
    /** Keyed by \`${sourceId}→${destId}\`. */
    connections: Record<string, RoutingConnection>;
};

const defaultState: RoutingMatrixState = { connections: {} };

export const routingMatrixStore = createStore<RoutingMatrixState>({ initialData: defaultState });

export const routingConnectionKey = (sourceId: string, destId: string): string => `${sourceId}→${destId}`;
