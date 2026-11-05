# SampleLibrary module — Agent Guidelines

Local and native sample collection indexing, folder tree hierarchies, sample metadata and tag persistence (IndexedDB), vector embeddings for audio similarity, and 2D spatial map projections (decoded audio PCM buffers belong to AudioEngine; sidebar UI tabs belong to ContentBrowser).

## Public Contract Surface

Public surface: `useCases/index.ts`, `stores/index.ts`, `presentations/views/index.ts`.

## Key Subsystems

- **Sample Database & Persistence**: IndexedDB persistence for library root directories, sample file paths, and metadata (`stores/libraryStore.ts`, `repositories/libraryPersistence/`).
- **Native & Browser Filesystem Access**: `repositories/` (`readNativeDirectory.ts`, `readNativeAudioFileBytes.ts`, `pickNativeSampleFolder.ts`, `readBrowserLibrarySampleFile.ts`) provide dual-runtime directory scanning.
- **Similarity & Spatial Projection**: `useCases/findSimilarSamples.ts`, `useCases/projectSpatialMap.ts`, and `stores/embeddingStore.ts` compute audio similarity distances and project multidimensional embeddings into 2D coordinates.
- **Agent Catalog Search**: `useCases/searchAgentCatalog.ts` answers an agent's query only with entries built from indexed records already in `libraryStore`, each carrying the provenance and licensing derived from its library root, so an agent can never supply or invent a catalog entry.
- **Agent Catalog Admission**: `services/agentCatalog/indexedCatalogEntries.ts` holds the one admission rule and the one provenance derivation every agent-facing catalog answer uses; `useCases/resolveAgentCatalogCandidate.ts` hands a caller the audio source behind a candidate id under those same terms: a file for every root but the factory's, and for a factory-root record the sample's own resident buffer obtained through `ensureFactorySampleBuffer` (decided by the record's root, never by a missing handle; an unavailable buffer is `file-unavailable`). Decoding, measuring, and placing that audio belong to the caller (AiRuntime), because this module holds no decoded audio and issues no commands.

## Invariants & Traps

- **Decoupled From Audio Buffers**: Stores sample file descriptors, metadata, and relative paths; does not hold decoded `AudioBuffer` instances in memory (`AudioEngine/stores/audioBufferCache.ts` owns cached audio PCM).
- **File System Access Permissions**: In browser environments, folder handles require explicit user permission queries via `requestPermission` and handle restoration.
- **Non-Blocking Indexing**: Background scanning and tag extraction must not block the main UI thread or audio deadlines.
- **Dual Runtime Detection**: Check native filesystem availability before calling desktop file scanning routines.
- **Factory Samples Load On Demand**: The factory root is a handle-less `browser` shim with synthesised buffers, so its availability is its records plus PCM, not a filesystem. After `restoreLibrary`, `seedFactoryLibrary` marks a restored factory root ready without rendering. Every reader of a factory sample's buffer goes through `ensureFactorySampleBuffer`: the resident cache entry, then the PCM stored for it in this or an earlier launch, or held by a write of this session that has not landed (`restoreUnpinnedAudioBuffersFromIdb`, which pins nothing and writes nothing), then, only when storage holds no record and this session holds no PCM, one render of the pack shared by concurrent callers, caching that sample alone. When storage cannot be read, the sample plays this session from a render that storage never receives (`holdAudioBufferForSession`), because a stored render could overwrite a record the failed read could not see. A render never caches a sample that has stored audio or a resident buffer, because a saved project may play that audio and a render of another build can differ from it: Rescan re-renders the pack and caches only the samples storage holds nothing for. A root disconnected during the render or the caching stops the caching and lists or persists no records. The seed flag means "seeded once": flag set and root absent means the user disconnected it, so it is never recreated.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

```bash
pnpm guard --profile focused -- pnpm test:run <changed-spec>
```
