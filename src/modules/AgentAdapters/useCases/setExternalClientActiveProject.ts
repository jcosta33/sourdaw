/**
 * The project external clients are currently talking about.
 *
 * Grants are issued against it and admission compares it back, so moving it
 * strands every grant issued against the project that was open before —
 * deliberately: a client that asked for authority over one project never asked
 * for it over the next one.
 */

import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

export function setExternalClientActiveProject(projectId: string | null): void {
    externalClientSessionStore.set({ ...readExternalClientSession(), activeProjectId: projectId });
}
