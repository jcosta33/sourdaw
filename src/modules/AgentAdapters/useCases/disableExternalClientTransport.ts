/**
 * Close a transport without touching the grants issued over it.
 *
 * Admission refuses an externally reachable transport that is not enabled
 * before it looks at any grant, so closing the door is enough to stop every
 * client behind it; the grants stay readable for whoever asks what was open.
 */

import { type ExternalClientTransport } from '../models/ExternalClientContract';
import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

export function disableExternalClientTransport(transport: ExternalClientTransport): void {
    const session = readExternalClientSession();
    externalClientSessionStore.set({
        ...session,
        enabledTransports: session.enabledTransports.filter((enabled) => enabled !== transport),
    });
}
