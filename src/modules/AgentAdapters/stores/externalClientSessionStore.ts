/**
 * What external clients may reach, for this session only.
 *
 * Nothing here is persisted and nothing here is project truth: the store is
 * built on the default in-memory backing, so a reload leaves every externally
 * reachable transport disabled and every grant gone. That is the intended
 * lifetime. A grant that survived a reload would be an approval nobody in the
 * new session gave, and a transport that came back enabled would reopen a door
 * the last session's operator closed.
 */

import { createStore } from '#/infra/store/createStore';

import { type ExternalClientGrant, type ExternalClientTransport } from '../models/ExternalClientContract';

export type ExternalClientSessionState = {
    enabledTransports: readonly ExternalClientTransport[];
    grants: Readonly<Record<string, ExternalClientGrant>>;
    activeProjectId: string | null;
};

/** Disabled, ungranted and project-less: the only state a session may start in. */
const emptyExternalClientSession = (): ExternalClientSessionState => ({
    enabledTransports: [],
    grants: {},
    activeProjectId: null,
});

export const externalClientSessionStore = createStore<ExternalClientSessionState>({
    initialData: emptyExternalClientSession(),
});

export function resetExternalClientSession(): void {
    externalClientSessionStore.set(emptyExternalClientSession());
}

/** The session as it stands, with a cleared store read as a fresh one. */
export function readExternalClientSession(): ExternalClientSessionState {
    return externalClientSessionStore.value ?? emptyExternalClientSession();
}
