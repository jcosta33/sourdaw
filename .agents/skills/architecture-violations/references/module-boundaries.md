# Module boundary: contract-folder barrels

Canonical module-boundary reference: `docs/architecture/03-typescript-module.md` §3.3
(contract-folder barrels) and §3.1 (public contract surface). This file is the
deep mechanics behind Core rule 5 (real boundaries) and Core rule 6 (no
laundering). Read it before moving logic across a module edge.

---

## The four contract surfaces

Each module exposes **four independently-importable contract surfaces**. There is
**no module-root `index.ts`**.

```text
src/modules/ModuleName/useCases/index.ts          ← business operations
src/modules/ModuleName/stores/index.ts            ← Store<T> instances
src/modules/ModuleName/events/index.ts            ← typed event payload types (if any)
src/modules/ModuleName/presentations/views/index.ts  ← composable UI entry points (if any)
```

Each `<contract>/index.ts` may only re-export from files within its own folder.
`useCases/index.ts` must not import from `stores/`, and vice versa.

Everything else — `models/`, `repositories/`, `services/`, `validators/`,
`transformers/`, `presentations/hooks/`, `presentations/stores/`,
`presentations/context/`, `presentations/components/`, `presentations/renderers/`,
`engine/`, `runtime/`, `worklets/`, `errors/`, `handlers/` — is private. External
consumers never import those paths directly.

## Importing cross-module

```ts
// CORRECT — import from contract-folder barrel
import { addTrack } from '#/modules/Arrangement/useCases';
import { trackStore } from '#/modules/Arrangement/stores';
import type { TrackAddedEvent } from '#/modules/Arrangement/events';
import { ArrangementBar } from '#/modules/Arrangement/presentations/views';

// FORBIDDEN — direct file access from outside the module
import { addTrack } from '#/modules/Arrangement/useCases/addTrack';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';

// FORBIDDEN — root index.ts does not exist in a migrated module
import { addTrack, trackStore } from '#/modules/Arrangement';
```

## Importing inside the same module (never own contract barrels)

Files under `src/modules/<Name>/` must **not** import from
`#/modules/<Name>/useCases`, `#/modules/<Name>/stores`, etc. Use **relative**
paths.

```ts
// CORRECT — Arrangement file importing Arrangement internals
import { trackStore } from '../stores/trackStore';
import { addClip } from './useCases/clip/addClip';

// FORBIDDEN — same module importing its own contract barrel
import { trackStore } from '#/modules/Arrangement/stores';
import { addClip } from '#/modules/Arrangement/useCases';
```

## Writing a contract-folder barrel

```ts
// src/modules/Arrangement/useCases/index.ts — curated use cases barrel
export { addTrack } from './addTrack';
export { removeTrack } from './removeTrack';
export { getArrangementHandlers } from './getArrangementHandlers';

// FORBIDDEN inside useCases/index.ts:
export type { SomeDto } from './getThing'; // use-case types do not cross modules
export { Track } from '../models/Track'; // models/ is private; wrong folder
export { trackStore } from '../stores/trackStore'; // wrong folder — use stores/index.ts
```

```ts
// src/modules/Arrangement/stores/index.ts — curated stores barrel
export { trackStore, defaultTrackState } from './trackStore';
export type { TrackStoreState } from './trackStore';

// FORBIDDEN inside stores/index.ts:
export { addTrack } from '../useCases/addTrack'; // wrong folder — use useCases/index.ts
```

## No module-root `index.ts`

Do not add `<module>/index.ts` or `<module>/contract.ts` aggregation shims.
Module-root barrels are retired (none remain). Create or extend the four
contract-folder barrels only.
