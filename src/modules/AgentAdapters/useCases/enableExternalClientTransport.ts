/**
 * The local approval that opens a transport.
 *
 * This is the only route by which an externally reachable transport becomes
 * enabled, so the answer to "who let this in" is always a call made on this
 * machine.
 */

import { type ExternalClientTransport } from '../models/ExternalClientContract';
import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

export function enableExternalClientTransport(transport: ExternalClientTransport): void {
    const session = readExternalClientSession();
    if (session.enabledTransports.includes(transport)) {
        return;
    }
    externalClientSessionStore.set({ ...session, enabledTransports: [...session.enabledTransports, transport] });
}
