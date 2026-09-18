/**
 * The local approval that opens a transport.
 *
 * This is the only route by which an externally reachable transport becomes
 * enabled, so the answer to "who let this in" is always a call made on this
 * machine.
 *
 * A transport something off this machine can reach is carried by the desktop
 * shell and by nothing else, so the probe runs before the approval is recorded.
 * Enabling a door this build cannot open would leave the session claiming an
 * approval that no listener backs, and a later grant would be issued against
 * it. The three local transports are unaffected: they are reached from inside
 * this process, which is here by definition.
 */

import {
    isExternallyReachableTransport,
    type ExternalClientTransport,
    type ExternalClientTransportEnablement,
} from '../models/ExternalClientContract';
import { readNativeTransportSupport } from '../repositories/nativeTransportRepository';
import { externalClientSessionStore, readExternalClientSession } from '../stores/externalClientSessionStore';

export function enableExternalClientTransport(transport: ExternalClientTransport): ExternalClientTransportEnablement {
    if (isExternallyReachableTransport(transport) && !readNativeTransportSupport().available) {
        return { status: 'refused', reason: 'native-transport-unavailable' };
    }
    const session = readExternalClientSession();
    if (!session.enabledTransports.includes(transport)) {
        externalClientSessionStore.set({ ...session, enabledTransports: [...session.enabledTransports, transport] });
    }
    return { status: 'enabled' };
}
