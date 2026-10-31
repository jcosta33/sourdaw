# FactorySynthesis module — Agent Guidelines

Procedural offline audio synthesis and preset sound generator for factory sample packs (808/909 drum machines, acoustic drums, lo-fi percussion, basses, keys, risers, impacts); does not own sample library indexing or disk storage (SampleLibrary).

## Public Contract Surface

- **Use Cases** (`useCases/index.ts`): `renderFactorySamples`, `FACTORY_LIBRARY_ROOT_ID`, `FACTORY_SEED_FLAG_KEY`.

## Key Subsystems

- **DSP Building Blocks** (`services/`): Mathematical oscillators, envelopes, filters, dynamics, distortion, delay, reverb, and buffer mixing primitives.
- **Pack Generators** (`transformers/`): Programmatic instrument and kit generators (`drums808`, `drums909`, `drumsAcoustic`, `drumsLofi`, `percWorld`, `percElectronic`, `bass`, `keys`, `generateRisersPack`, `generateImpactsPack`) and the render-all orchestrator `generateFactorySamples`. They return raw PCM records (`models/RenderedFactorySample.ts`), never AudioBuffers.
- **Synthesis Worker** (`workers/factorySynthesisWorker.ts`, runtime in `factorySynthesisWorkerRuntime.ts`): renders every pack off the main thread and transfers each channel buffer back. `repositories/factorySynthesisWorkerClient.ts` owns the Worker lifetime, timeout, and reply validation.
- **Generation Pipeline** (`useCases/renderFactorySamples.ts`): awaits the worker and builds AudioBuffers on the main thread in chunks, yielding between them.

## Invariants & Traps

- Pure offline DSP: generators run in a dedicated Worker, so they must not touch AudioContext, DOM, or any main-thread state. AudioBuffer construction happens only in `useCases/renderFactorySamples.ts`.
- Workers may import only `models/` and `transformers/` (`workers-no-module-runtime-imports`); keep generators out of `useCases/` and `services/` imports out of the worker entry.
- Register the worker's `onmessage` synchronously at module top level, with no top-level await: Chromium drops messages posted to a module worker while its top-level evaluation is suspended, and builds emit workers as IIFE.
- No in-process fallback: a failed or timed-out render rejects, and the seed retries on the next launch.
- Sample ids, order, lengths, channel counts, sample rate, and samples are persisted project references; generators must keep them stable. `factory-fx-impact-glitch-stutter` alone uses `Math.random`.
- Deterministic seeding: procedural generator logic must produce identical sample buffers across runs given the same seed parameters.

## Verification

PR CI owns broader unit and crate suites. Locally run only the exact changed spec or filtered Rust test.

- `pnpm test:run <changed-spec>`
- PR CI checks module boundaries; inspect that result after cross-module changes.
