# Routing module — Agent Guidelines

Signal routing topology: manages auxiliary sends, bus strips, sidechain routes, sidechain target capabilities, and node graph / routing matrix UI visualization.

## Domain Ownership

Owns auxiliary send routing, bus strips, sidechain routes, sidechain capability detection, and node graph / routing matrix UI visualization state. Does not own WebAudio node instantiation/DSP execution (AudioEngine) or track mixer channel ownership (Arrangement).

## Public Contract Surface

- **`useCases`**: `ensureBusStrip`, `setBusGain`, `setSend`, `removeSend`, `hydrateSidechainRoutes`, `addSidechainRoute`, `addSidechainRouteSnapshot`, `removeSidechainRoute`, `removeSidechainRouteSnapshot`, `restoreSidechainRoutes`, `getSidechainRoutesForTrack`, `getAllSidechainRoutes`, `getSidechainTargetCapability`, `setSidechainRoutes`, `wireSidechainRoutes`, `getNodeViewHandlers`.
- **`stores`**: `sidechainStore` (`defaultSidechainStoreState`, type `SidechainStoreState`).
- **`presentations/views`**: `RoutingMatrix`, `RoutingGraph`.
- **`events`**: None.
- **Handler maps**: `getNodeViewHandlers` (`handleToggleNodeView`).

## Key Subsystems

- **`models/`**: `SidechainRoute.ts` (source/target track, device, bus, send level definitions), `TrackViewTypes.ts`.
- **`stores/`**: `sidechainStore.ts` (persisted and live sidechain connection registry), `nodeView.ts` (node-graph canvas layout and zoom/pan).
- **`presentations/views/`**: `RoutingMatrix.tsx` (cross-point track-to-bus/sidechain grid), `RoutingGraph.tsx` (visual DAG canvas).
- **`errors/`**: `RoutingErrors.ts` (cycle detection, invalid target rejections).

## Invariants & Traps

- **DAG cycle prevention**: Routing topologies (buses, sends, sidechains) strictly forbid feedback loops/cycles; validation rejects routes that would create recursive signal dependencies.
- **Sidechain capability verification**: Routes targeting plugins/devices require capability inspection (`getSidechainTargetCapability`) before wiring sidechain input nodes.
- **Two-phase routing synchronization**: Routing state in `sidechainStore` coordinates with AudioEngine runtime graph via `wireSidechainRoutes` and snapshot restoration for project hydration.

## Verification

- **Focused unit tests**: `pnpm test:run src/modules/Routing`
- **Module boundaries**: `pnpm deps:validate`
