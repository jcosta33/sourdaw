/** One candidate the sample catalog answers with, as discovery projects it. */
type SampleCatalogCandidate = {
    id: string;
    displayName: string;
    provenance: unknown;
    licensing: unknown;
    score: number;
};

type SampleCatalogSearchResult =
    | {
          status: 'results';
          items: readonly SampleCatalogCandidate[];
          truncated: boolean;
          warnings: readonly string[];
      }
    | { status: 'rejected' };

/** The sample library as agent discovery reads it: its roots, and its own catalog search. */
type SampleDiscoverySource = {
    /** The library's state, of which discovery reads whether any root is ready; `null` before it loads. */
    readLibrary: () => { roots: readonly { status: string }[] } | null;
    /** The catalog's own answer to one text query, at the limit discovery asks for. */
    searchCatalog: (query: { text: string; limit: number }) => SampleCatalogSearchResult;
};

let registeredSource: SampleDiscoverySource | null = null;

/**
 * Project may not import SampleLibrary, which orbits it, so the composition
 * root (`#/app/registerSupportingServicePorts`) fills this once at boot,
 * before an agent can query the sample domain.
 */
export const sampleDiscoverySource = {
    /**
     * Registering the identical source again is a no-op, so a caller that
     * cannot know whether registration already ran may repeat it. A different
     * one refuses.
     */
    configure(source: SampleDiscoverySource): void {
        if (registeredSource === null) {
            registeredSource = source;
            return;
        }
        if (
            registeredSource.readLibrary !== source.readLibrary ||
            registeredSource.searchCatalog !== source.searchCatalog
        ) {
            throw new Error('sampleDiscoverySource.configure: the source differs from the registered one');
        }
    },
    /**
     * The registered source. Reading before registration throws rather than
     * answering an unindexed catalog: an agent would then be told the library
     * holds nothing it could use.
     */
    read(caller: string): SampleDiscoverySource {
        if (registeredSource === null) {
            throw new Error(
                `${caller}: the sample discovery source is not registered; call registerSupportingServicePorts() from #/app/registerSupportingServicePorts (bootstrap does this)`
            );
        }
        return registeredSource;
    },
};
