/**
 * Transfer-safe, revision-correlated model for one live graph mutation.
 *
 * The compiler owns the runtime form: callers may supply a structured-cloneable
 * value, but AudioEngine applies only its frozen compiled representation at the
 * main-thread graph boundary. This command deliberately covers one output edge;
 * device construction and worklet controls keep their existing owners until they
 * have equivalent contracts.
 */
export type RuntimeGraphDelta = Readonly<{
    schemaVersion: 1;
    command: 'set-track-output';
    correlation: Readonly<{
        /** Expected live-engine revision immediately before this command applies. */
        appRevision: number;
        /** CRDT project revision that produced this graph view. */
        projectRevision: string;
    }>;
    /** Source first, then the non-terminal destination when there is one. */
    nodes: readonly RuntimeGraphDeltaNode[];
    edges: readonly [RuntimeGraphOutputEdge];
    /** This topology command has no continuous-control payload. */
    parameters: readonly [];
}>;

export type RuntimeGraphDeltaNode = Readonly<{
    id: string;
    kind: 'audio' | 'midi' | 'bus' | 'master' | 'folder';
    /** Ordered exactly as the owning project's device chain. */
    devices: readonly RuntimeGraphDeltaDevice[];
}>;

export type RuntimeGraphDeltaDevice = Readonly<{
    id: string;
    /** Device-factory type required by the live graph node. */
    type: string;
    /** Sorted, stable parameter IDs; values are intentionally not transported by this topology command. */
    parameterIds: readonly string[];
}>;

/**
 * Composition-owned authority for comparing an opaque compiled revision with
 * the project snapshot that is current immediately before a live graph write.
 */
export type RuntimeGraphProjectRevisionValidator = (expectedProjectRevision: string) => boolean;

/**
 * Composition-owned authority for comparing a compiled topology with the
 * current project-owned track/device topology before the live graph changes.
 */
export type RuntimeGraphTopologyValidator = (nodes: readonly RuntimeGraphDeltaNode[]) => boolean;

export type RuntimeGraphOutputEdge = Readonly<{
    kind: 'output';
    sourceId: string;
    targetId: string;
}>;

export type RuntimeGraphDeltaResult =
    | Readonly<{
          acceptance: 'rejected';
          application: 'not-applied';
          reason: string;
      }>
    | Readonly<{
          acceptance: 'accepted';
          application: 'applied';
          correlation: RuntimeGraphDelta['correlation'];
          runtimeRevision: number;
      }>
    | Readonly<{
          acceptance: 'accepted';
          application: 'needs-reconcile';
          /**
           * Whether the runtime attempted and failed to restore a live edge.
           * A failed compensation never claims the project graph was restored.
           */
          compensation: 'not-attempted' | 'failed';
          correlation: RuntimeGraphDelta['correlation'];
          reason: string;
          runtimeRevision: number;
      }>;
