/**
 * Where the published protocol manifest reaches this module from.
 *
 * The manifest is assembled by the composition root out of every owner's
 * contracts, and this module is one more consumer of it. It arrives through a
 * provider the root registers rather than an import, for the same reason
 * capability discovery does: importing the root from a module would invert the
 * composition direction.
 *
 * The contract shape is derived from what the capability catalog already
 * accepts, so the two read the same published records, plus the schema version
 * this module publishes as each operation's contract version.
 *
 * With no provider registered there is nothing published, which normalization
 * reports as every operation deferred — never as a contract it invented.
 */

import { type getAgentCapabilityCatalog } from '#/modules/AiRuntime/useCases';

type ExternalClientProtocolContract = Parameters<typeof getAgentCapabilityCatalog>[0][number] & {
    readonly schemaVersion: number;
};

type ExternalClientManifestProvider = () => readonly ExternalClientProtocolContract[];

let provider: ExternalClientManifestProvider | null = null;

export const externalClientManifestPort = {
    read(): readonly ExternalClientProtocolContract[] {
        return provider?.() ?? [];
    },
    setProvider(nextProvider: ExternalClientManifestProvider | null): void {
        provider = nextProvider;
    },
};
