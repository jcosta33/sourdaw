# SampleLibrary module — Agent Guidelines

Local and native sample collection indexing, folder tree hierarchies, sample metadata and tag persistence (IndexedDB), vector embeddings for audio similarity, and 2D spatial map projections (decoded audio PCM buffers belong to AudioEngine; sidebar UI tabs belong to ContentBrowser).

## Public Contract Surface

- `stores`: `libraryStore` (`LibraryState`), `embeddingStore`.
- `useCases`: `buildFolderTree`, `requestPermission`, `readNativeLibrarySampleFile`, `resolveDroppedSampleFile`, `restoreLibrary`, `searchSamples`, `findSimilarSamples`, `searchAgentCatalog`, `projectSpatialMap`, `seedFactoryLibrary`.
- `presentations/views`: `LibraryBrowser`, `SpatialMapRenderer`.

## Key Subsystems

- **Sample Database & Persistence**: IndexedDB persistence for library root directories, sample file paths, and metadata (`stores/libraryStore.ts`, `repositories/libraryPersistence/`).
- **Native & Browser Filesystem Access**: `repositories/` (`readNativeDirectory.ts`, `readNativeAudioFileBytes.ts`, `pickNativeSampleFolder.ts`, `readBrowserLibrarySampleFile.ts`) provide dual-runtime directory scanning.
- **Similarity & Spatial Projection**: `useCases/findSimilarSamples.ts`, `useCases/projectSpatialMap.ts`, and `stores/embeddingStore.ts` compute audio similarity distances and project multidimensional embeddings into 2D coordinates.
- **Agent Catalog Search**: `useCases/searchAgentCatalog.ts` answers an agent's query only with entries built from indexed records already in `libraryStore`, each carrying the provenance and licensing derived from its library root, so an agent can never supply or invent a catalog entry.

## Invariants & Traps

- **Decoupled From Audio Buffers**: Stores sample file descriptors, metadata, and relative paths; does not hold decoded `AudioBuffer` instances in memory (`AudioEngine/stores/audioBufferCache.ts` owns cached audio PCM).
- **File System Access Permissions**: In browser environments, folder handles require explicit user permission queries via `requestPermission` and handle restoration.
- **Non-Blocking Indexing**: Background scanning and tag extraction must not block the main UI thread or audio deadlines.
- **Dual Runtime Detection**: Check native filesystem availability before calling desktop file scanning routines.

## Verification

```bash
pnpm vitest run src/modules/SampleLibrary
```
