---
name: tanstack-query
description: >
  Apply when creating, editing, or reviewing async server-state logic, query hooks, query client setup, mutations, cache invalidation, prefetching, or Suspense-based data flows. Enforces TanStack Query patterns for this project: use QueryClient as the async state boundary, define query hooks in presentation hooks, use useSuspenseQuery and useSuspenseInfiniteQuery for async reads, use mutations for writes, invalidate or update cache explicitly, prefetch at route or render boundaries, and keep all business logic in use cases rather than query functions or components.
---

## Setup

```tsx
// src/app/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
```

```tsx
// src/modules/Project/presentations/hooks/useProject.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getProject } from "#/modules/Project/useCases/getProject";

export const useProject = (id: number) => {
  const { data: project } = useSuspenseQuery({
    queryKey: useProject.getKey(id),
    queryFn: ({ signal }) => getProject(id, signal),
  });

  return { project };
};

useProject.getKey = (id: number) => ["project", id];
```

```tsx
// src/routes/project.$projectId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

import { ProjectView } from "#/modules/Project/presentations/views/ProjectView";

export const Route = createFileRoute("/project/$projectId")({
  loader: ({ params }) => {
    return {
      projectId: Number(params.projectId),
    };
  },
  pendingComponent: () => <div>Loading project...</div>,
  errorComponent: () => <div>Could not load project</div>,
  component: ProjectPage,
});

const ProjectPage = (): ReactElement => {
  const { projectId } = Route.useLoaderData();

  return <ProjectView id={projectId} />;
};
```

```tsx
// src/modules/Project/presentations/views/ProjectView.tsx
import { type ReactElement } from "react";

import { useProject } from "../hooks/useProject";

export const ProjectView = ({ id }: { id: number }): ReactElement => {
  const { project } = useProject(id);

  return <div>{project.name}</div>;
};
```

## Core Patterns

### Query hooks live in presentation hooks, not in components

```tsx
// src/modules/Track/presentations/hooks/useTrack.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getTrack } from "#/modules/Track/useCases/getTrack";

export const useTrack = (id: number) => {
  const { data: track } = useSuspenseQuery({
    queryKey: useTrack.getKey(id),
    queryFn: ({ signal }) => getTrack(id, signal),
  });

  return { track };
};

useTrack.getKey = (id: number) => ["track", id];
```

```tsx
// src/modules/Track/presentations/views/TrackView.tsx
import { type ReactElement } from "react";

import { useTrack } from "../hooks/useTrack";

export const TrackView = ({ id }: { id: number }): ReactElement => {
  const { track } = useTrack(id);

  return <div>{track.name}</div>;
};
```

Views consume presentation hooks.

Do not place query definitions directly in presentational components.

---

### Query functions call use cases, not fetch or repository code directly

```tsx
// src/modules/Library/presentations/hooks/useLibrary.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getLibrary } from "#/modules/Library/useCases/getLibrary";

export const useLibrary = (id: number) => {
  const { data: library } = useSuspenseQuery({
    queryKey: useLibrary.getKey(id),
    queryFn: ({ signal }) => getLibrary(id, signal),
  });

  return { library };
};

useLibrary.getKey = (id: number) => ["library", id];
```

The query layer is a caching and lifecycle layer.

Business logic remains in use cases.

---

### Use Suspense-first query hooks for reads

```tsx
// src/modules/Mixer/presentations/hooks/useMixer.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getMixer } from "#/modules/Mixer/useCases/getMixer";

export const useMixer = (projectId: number) => {
  const { data: mixer } = useSuspenseQuery({
    queryKey: useMixer.getKey(projectId),
    queryFn: ({ signal }) => getMixer(projectId, signal),
  });

  return { mixer };
};

useMixer.getKey = (projectId: number) => ["mixer", projectId];
```

For async reads in this project, prefer:

- `useSuspenseQuery`
- `useSuspenseInfiniteQuery`

This keeps views clean and works naturally with route-level pending and error UI.

---

### Route boundaries and query hooks work together

```tsx
// src/routes/mixer.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

import { MixerView } from "#/modules/Mixer/presentations/views/MixerView";

export const Route = createFileRoute("/mixer")({
  pendingComponent: () => <div>Loading mixer...</div>,
  errorComponent: () => <div>Mixer failed to load</div>,
  component: MixerPage,
});

const MixerPage = (): ReactElement => {
  return <MixerView />;
};
```

```tsx
// src/modules/Mixer/presentations/views/MixerView.tsx
import { type ReactElement } from "react";

import { useMixer } from "../hooks/useMixer";

export const MixerView = (): ReactElement => {
  const { mixer } = useMixer(1);

  return <div>{mixer.name}</div>;
};
```

Routes provide entry boundaries.

Views consume Suspense-enabled hooks.

---

### Use mutations for writes and keep mutation functions thin

```tsx
// src/modules/Track/presentations/hooks/useRenameTrack.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { renameTrack } from "#/modules/Track/useCases/renameTrack";

export const useRenameTrack = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: renameTrack,
    onSuccess: (track) => {
      queryClient.setQueryData(["track", track.id], track);

      queryClient.invalidateQueries({
        queryKey: ["project", track.projectId],
      });
    },
  });

  return {
    renameTrack: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};
```

Mutation functions should call use cases.

Do not embed domain rules in `onSuccess` or `mutationFn`.

---

### Prefer explicit cache updates plus targeted invalidation

```tsx
// src/modules/Clip/presentations/hooks/useMoveClip.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { moveClip } from "#/modules/Clip/useCases/moveClip";

export const useMoveClip = () => {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: moveClip,
    onSuccess: (clip) => {
      queryClient.setQueryData(["clip", clip.id], clip);

      queryClient.invalidateQueries({
        queryKey: ["track", clip.trackId],
      });

      queryClient.invalidateQueries({
        queryKey: ["project", clip.projectId],
      });
    },
  });

  return {
    moveClip: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};
```

Be explicit about which queries are affected.

Do not invalidate the whole cache.

---

### Use query keys as stable public contracts

```tsx
// src/modules/Project/presentations/hooks/useProjectList.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getProjectList } from "#/modules/Project/useCases/getProjectList";

type ProjectListFilters = {
  search: string;
};

export const useProjectList = (filters: ProjectListFilters) => {
  const { data: projects } = useSuspenseQuery({
    queryKey: useProjectList.getKey(filters),
    queryFn: ({ signal }) => getProjectList(filters, signal),
  });

  return { projects };
};

useProjectList.getKey = (filters: ProjectListFilters) => [
  "project-list",
  filters,
];
```

Each query hook must expose a `.getKey(...)` helper.

This keeps route prefetching, invalidation, and cache updates consistent.

---

### Prefetch before the boundary when beneficial

```tsx
// src/modules/Project/presentations/components/ProjectPreviewBoundary.tsx
import { usePrefetchQuery } from "@tanstack/react-query";
import { Suspense, type ReactElement } from "react";

import { getProject } from "#/modules/Project/useCases/getProject";
import { ProjectPreview } from "./ProjectPreview";

export const ProjectPreviewBoundary = ({
  id,
}: {
  id: number;
}): ReactElement => {
  usePrefetchQuery({
    queryKey: ["project", id],
    queryFn: ({ signal }) => getProject(id, signal),
  });

  return (
    <Suspense fallback={<div>Loading preview...</div>}>
      <ProjectPreview id={id} />
    </Suspense>
  );
};
```

Use prefetching when there is a clear UX benefit:

- route hover or intent preload
- panel open boundaries
- tab switches
- likely-next views

Do not prefetch everything by default.

---

### Use infinite queries only for genuinely paginated surfaces

```tsx
// src/modules/Library/presentations/hooks/useSamplePages.ts
import { useSuspenseInfiniteQuery } from "@tanstack/react-query";

import { getSamplePage } from "#/modules/Library/useCases/getSamplePage";

export const useSamplePages = (search: string) => {
  const query = useSuspenseInfiniteQuery({
    queryKey: useSamplePages.getKey(search),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) =>
      getSamplePage({ page: pageParam, search }, signal),
    getNextPageParam: (lastPage) => {
      if (!lastPage.hasNextPage) {
        return undefined;
      }

      return lastPage.nextPage;
    },
  });

  return {
    pages: query.data.pages,
    fetchNextPage: query.fetchNextPage,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
  };
};

useSamplePages.getKey = (search: string) => ["sample-pages", search];
```

Do not use infinite queries for normal lists.

---

### Use QueryClient from router/app context, not ad hoc instances

```tsx
// src/modules/Project/presentations/hooks/useProjectActions.ts
import { useQueryClient } from "@tanstack/react-query";

export const useProjectActions = () => {
  const queryClient = useQueryClient();

  const refreshProject = async (projectId: number) => {
    await queryClient.invalidateQueries({
      queryKey: ["project", projectId],
    });
  };

  return { refreshProject };
};
```

Use the shared app-level `QueryClient`.

Never create a new `QueryClient` in a hook, view, or component.

## Common Mistakes

### CRITICAL Fetching in `useEffect`

Wrong:

```tsx
// src/modules/Project/presentations/views/ProjectView.tsx
import { type ReactElement, useEffect, useState } from "react";

export const ProjectView = ({ id }: { id: number }): ReactElement => {
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    let isMounted = true;

    void fetch(`/api/projects/${id}`)
      .then((response) => response.json())
      .then((project) => {
        if (isMounted) {
          setProjectName(project.name);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id]);

  return <div>{projectName}</div>;
};
```

Correct:

```tsx
// src/modules/Project/presentations/hooks/useProject.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getProject } from "#/modules/Project/useCases/getProject";

export const useProject = (id: number) => {
  const { data: project } = useSuspenseQuery({
    queryKey: useProject.getKey(id),
    queryFn: ({ signal }) => getProject(id, signal),
  });

  return { project };
};

useProject.getKey = (id: number) => ["project", id];
```

```tsx
// src/modules/Project/presentations/views/ProjectView.tsx
import { type ReactElement } from "react";

import { useProject } from "../hooks/useProject";

export const ProjectView = ({ id }: { id: number }): ReactElement => {
  const { project } = useProject(id);

  return <div>{project.name}</div>;
};
```

Data fetching must not happen in `useEffect`. This project’s conventions explicitly forbid it. Server state belongs in TanStack Query hooks. :contentReference[oaicite:1]{index=1}

### CRITICAL Putting business logic inside query functions

Wrong:

```tsx
// src/modules/Track/presentations/hooks/useTrackStatus.ts
import { useSuspenseQuery } from "@tanstack/react-query";

export const useTrackStatus = (id: number) => {
  const { data } = useSuspenseQuery({
    queryKey: ["track-status", id],
    queryFn: async () => {
      const response = await fetch(`/api/tracks/${id}`);
      const track = await response.json();

      if (track.isArchived) {
        throw new Error("Archived tracks are not editable");
      }

      return {
        ...track,
        canEdit: track.role === "owner" || track.role === "editor",
      };
    },
  });

  return { data };
};
```

Correct:

```tsx
// src/modules/Track/presentations/hooks/useTrackStatus.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getTrackStatus } from "#/modules/Track/useCases/getTrackStatus";

export const useTrackStatus = (id: number) => {
  const { data: trackStatus } = useSuspenseQuery({
    queryKey: useTrackStatus.getKey(id),
    queryFn: ({ signal }) => getTrackStatus(id, signal),
  });

  return { trackStatus };
};

useTrackStatus.getKey = (id: number) => ["track-status", id];
```

Use cases own business rules and transformations. The query layer owns caching and lifecycle only. This follows the architecture boundary rules. :contentReference[oaicite:2]{index=2}

### HIGH Defining queries directly in components

Wrong:

```tsx
// src/modules/Mixer/presentations/components/MixerPanel.tsx
import { useSuspenseQuery } from "@tanstack/react-query";

export const MixerPanel = () => {
  const { data } = useSuspenseQuery({
    queryKey: ["mixer", 1],
    queryFn: ({ signal }) => getMixer(1, signal),
  });

  return <div>{data.name}</div>;
};
```

Correct:

```tsx
// src/modules/Mixer/presentations/hooks/useMixer.ts
import { useSuspenseQuery } from "@tanstack/react-query";

import { getMixer } from "#/modules/Mixer/useCases/getMixer";

export const useMixer = (projectId: number) => {
  const { data: mixer } = useSuspenseQuery({
    queryKey: useMixer.getKey(projectId),
    queryFn: ({ signal }) => getMixer(projectId, signal),
  });

  return { mixer };
};

useMixer.getKey = (projectId: number) => ["mixer", projectId];
```

```tsx
// src/modules/Mixer/presentations/views/MixerView.tsx
import { type ReactElement } from "react";

import { useMixer } from "../hooks/useMixer";

export const MixerView = ({
  projectId,
}: {
  projectId: number;
}): ReactElement => {
  const { mixer } = useMixer(projectId);

  return <div>{mixer.name}</div>;
};
```

Query definitions belong in presentation hooks, not inline in components.

### HIGH Broad invalidation instead of targeted cache updates

Wrong:

```tsx
// src/modules/Project/presentations/hooks/useRenameProject.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { renameProject } from "#/modules/Project/useCases/renameProject";

export const useRenameProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameProject,
    onSuccess: () => {
      queryClient.invalidateQueries();
    },
  });
};
```

Correct:

```tsx
// src/modules/Project/presentations/hooks/useRenameProject.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { renameProject } from "#/modules/Project/useCases/renameProject";

export const useRenameProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameProject,
    onSuccess: (project) => {
      queryClient.setQueryData(["project", project.id], project);

      queryClient.invalidateQueries({
        queryKey: ["project-list"],
      });
    },
  });
};
```

Invalidate only what is affected. Prefer direct cache updates where safe.

### HIGH Creating local QueryClient instances

Wrong:

```tsx
// src/modules/Library/presentations/views/LibraryView.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export const LibraryView = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <div>Library</div>
    </QueryClientProvider>
  );
};
```

Correct:

```tsx
// src/app/queryClient.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient();
```

```tsx
// src/app/AppProviders.tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode } from "react";

import { queryClient } from "./queryClient";

export const AppProviders = ({ children }: { children: ReactNode }) => {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
};
```

There must be one shared application-level query client unless a deliberate isolated cache boundary is explicitly designed.

### HIGH Using query cache as general UI state

Wrong:

```tsx
// src/modules/Panel/presentations/hooks/usePanelState.ts
import { useQuery, useQueryClient } from "@tanstack/react-query";

export const usePanelState = () => {
  const queryClient = useQueryClient();

  const { data: isOpen = false } = useQuery({
    queryKey: ["panel-open"],
    queryFn: async () => false,
  });

  const toggle = () => {
    queryClient.setQueryData(["panel-open"], !isOpen);
  };

  return { isOpen, toggle };
};
```

Correct:

```tsx
// src/modules/Panel/presentations/stores/panelStore.ts
type PanelState = {
  isOpen: boolean;
};

let panelState: PanelState = {
  isOpen: false,
};

const listeners = new Set<() => void>();

export const panelStore = {
  get: () => panelState,
  subscribe: (listener: () => void) => {
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
    };
  },
  toggle: () => {
    panelState = {
      isOpen: !panelState.isOpen,
    };

    listeners.forEach((listener) => {
      listener();
    });
  },
};
```

```tsx
// src/modules/Panel/presentations/hooks/usePanelState.ts
import { useSyncExternalStore } from "react";

import { panelStore } from "../stores/panelStore";

export const usePanelState = () => {
  const state = useSyncExternalStore(
    panelStore.subscribe,
    panelStore.get,
    panelStore.get,
  );

  return {
    isOpen: state.isOpen,
    toggle: panelStore.toggle,
  };
};
```

TanStack Query is for async server-state, not arbitrary UI state. The project’s state management guidance reserves external stores for client UI state and TanStack Query for server state. :contentReference[oaicite:3]{index=3}

## Additional Rules

- Always type query keys through `.getKey(...)` helpers.
- Always pass `signal` from the query function context to the use case when the use case supports cancellation.
- Prefer route-level pending and error UI plus Suspense query hooks instead of manual `isLoading` branches when the route/view design supports it.
- Keep `select` usage rare; prefer transforming data in use cases or transformers unless the projection is purely local and presentation-specific.
- Keep `staleTime`, `gcTime`, retry behavior, and invalidation strategy deliberate per domain surface.
- Query hooks may expose only the data and actions the view actually needs; do not leak the entire query object unless truly necessary.
