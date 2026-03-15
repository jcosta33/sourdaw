---
name: tanstack-router
description: >
  Apply when creating, editing, or reviewing routes, route trees, route layouts, route loaders, search params, guards, redirects, preloading, or navigation flows. Enforces TanStack Router patterns for this project: file-based route definitions exported as Route, typed router context, beforeLoad for guards and route-scoped context, loaders for route-entry data preparation, route-level pending/error UI, typed search params with validation, preloading, and strict separation where views consume route data and presentation hooks instead of fetching ad hoc inside components.
---

## Setup

```tsx
// src/app/router.tsx
import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  createRouter,
} from "@tanstack/react-router";
import { type ReactElement } from "react";

export type AppRouterContext = {
  queryClient: QueryClient;
};

const RootLayout = (): ReactElement => {
  return <Outlet />;
};

export const rootRoute = createRootRouteWithContext<AppRouterContext>()({
  component: RootLayout,
});

export const queryClient = new QueryClient();

export const router = createRouter({
  routeTree: rootRoute,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultPreloadStaleTime: 0,
});
```

```tsx
// src/routes/project.$projectId.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

import { getProject } from "#/modules/Project/useCases/getProject";

const useProject = (id: number) => {
  const { data: project } = useSuspenseQuery({
    queryKey: useProject.getKey(id),
    queryFn: ({ signal }) => getProject(id, signal),
  });

  return { project };
};

useProject.getKey = (id: number) => ["project", id];

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

const ProjectView = ({ projectId }: { projectId: number }): ReactElement => {
  const { project } = useProject(projectId);

  return <div>{project.name}</div>;
};

export const ProjectPage = (): ReactElement => {
  const { projectId } = Route.useLoaderData();

  return <ProjectView projectId={projectId} />;
};
```

## Core Patterns

### File-based routes must export `Route`

```tsx
// src/routes/mixer.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const Route = createFileRoute("/mixer")({
  component: MixerPage,
});

const MixerPage = (): ReactElement => {
  return <div>Mixer</div>;
};
```

Every file-based route must export a route instance named `Route`.

Do not export route definitions under other names.

### Views consume route data; components do not fetch ad hoc

```tsx
// src/routes/track.$trackId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

type TrackLoaderData = {
  trackId: number;
};

export const Route = createFileRoute("/track/$trackId")({
  loader: ({ params }): TrackLoaderData => {
    return {
      trackId: Number(params.trackId),
    };
  },
  component: TrackPage,
});

const TrackView = ({ trackId }: { trackId: number }): ReactElement => {
  return <div>Track {trackId}</div>;
};

export const TrackPage = (): ReactElement => {
  const { trackId } = Route.useLoaderData();

  return <TrackView trackId={trackId} />;
};
```

Route files define route params and route-level data.

Views consume route loader data and compose the relevant presentation hooks.

Do not fetch directly inside a presentational component just because it has access to params.

### Use `beforeLoad` for guards and route context

```tsx
// src/routes/project.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ReactElement } from "react";

type ProjectRouteContext = {
  projectScope: "read" | "write";
};

export const Route = createFileRoute("/project")({
  beforeLoad: ({ context, location }): ProjectRouteContext => {
    const hasAccess = true;

    if (!hasAccess) {
      throw redirect({
        to: "/login",
        search: {
          redirect: location.href,
        },
      });
    }

    void context.queryClient;

    return {
      projectScope: "write",
    };
  },
  component: ProjectLayout,
});

const ProjectLayout = (): ReactElement => {
  return <div>Project Layout</div>;
};
```

Use `beforeLoad` for:

- auth guards
- route-level redirects
- route-scoped context
- pre-navigation checks

Do not put guard logic in the component body.

### Use route loaders for route-level async preparation

```tsx
// src/routes/project.$projectId.arrange.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

type ArrangeLoaderData = {
  projectId: number;
  initialSection: string;
};

export const Route = createFileRoute("/project/$projectId/arrange")({
  loader: async ({ params }): Promise<ArrangeLoaderData> => {
    return {
      projectId: Number(params.projectId),
      initialSection: "verse-1",
    };
  },
  component: ArrangePage,
});

export const ArrangePage = (): ReactElement => {
  const data = Route.useLoaderData();

  return <div>{data.initialSection}</div>;
};
```

Use route loaders for:

- param normalization
- route-entry data preparation
- route-scoped async reads
- coordinating route data with the surrounding view

Do not use route loaders as a dumping ground for business logic.

Keep business rules in use cases.

### Use `useNavigate` or `<Link>` for navigation

```tsx
// src/modules/Project/presentations/components/OpenMixerButton.tsx
import { useNavigate } from "@tanstack/react-router";
import { type ReactElement } from "react";

type OpenMixerButtonProps = {
  projectId: number;
};

export const OpenMixerButton = ({
  projectId,
}: OpenMixerButtonProps): ReactElement => {
  const navigate = useNavigate({ from: "/project/$projectId" });

  const handleOpenMixer = () => {
    void navigate({
      to: "/project/$projectId/mixer",
      params: {
        projectId: String(projectId),
      },
    });
  };

  return (
    <button type="button" onClick={handleOpenMixer}>
      Open Mixer
    </button>
  );
};
```

Use router APIs for navigation.

Never use:

- `window.location`
- `history.pushState`
- anchor tags for internal app navigation without router integration

### Use typed search params with validation

```tsx
// src/routes/library.tsx
import { zodValidator } from "@tanstack/zod-adapter";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const librarySearchSchema = z.object({
  query: z.string().optional().default(""),
  tab: z.enum(["all", "samples", "presets"]).default("all"),
});

export const Route = createFileRoute("/library")({
  validateSearch: zodValidator(librarySearchSchema),
  component: LibraryPage,
});

const LibraryPage = () => {
  const search = Route.useSearch();

  return (
    <div>
      <div>{search.query}</div>
      <div>{search.tab}</div>
    </div>
  );
};
```

Search params must be typed and validated.

Do not parse raw query strings manually.

### Route-level pending and error UI belong in the route

```tsx
// src/routes/editor.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const Route = createFileRoute("/editor")({
  pendingComponent: () => <div>Loading editor...</div>,
  errorComponent: () => <div>Editor failed to load</div>,
  component: EditorPage,
});

const EditorPage = (): ReactElement => {
  return <div>Editor</div>;
};
```

Prefer route-scoped loading/error handling for route entry states.

This keeps route UX explicit and localized.

### Use preloading deliberately

```tsx
// src/routes/project.$projectId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const Route = createFileRoute("/project/$projectId")({
  preloadStaleTime: 0,
  loader: ({ params }) => {
    return {
      projectId: Number(params.projectId),
    };
  },
  component: ProjectPage,
});

const ProjectPage = (): ReactElement => {
  const { projectId } = Route.useLoaderData();

  return <div>{projectId}</div>;
};
```

When route data is backed by TanStack Query or another cache that already manages freshness, prefer `preloadStaleTime: 0` or another deliberate setting instead of relying on defaults blindly.

Preload intentionally.

## Common Mistakes

### CRITICAL Fetching in components instead of route loaders and hooks

Wrong:

```tsx
// src/routes/project.$projectId.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement, useEffect, useState } from "react";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectPage,
});

const ProjectPage = (): ReactElement => {
  const { projectId } = Route.useParams();
  const [projectName, setProjectName] = useState("");

  useEffect(() => {
    void fetch(`/api/projects/${projectId}`)
      .then((response) => response.json())
      .then((project) => {
        setProjectName(project.name);
      });
  }, [projectId]);

  return <div>{projectName}</div>;
};
```

Correct:

```tsx
// src/routes/project.$projectId.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

import { getProject } from "#/modules/Project/useCases/getProject";

const useProject = (id: number) => {
  const { data: project } = useSuspenseQuery({
    queryKey: useProject.getKey(id),
    queryFn: ({ signal }) => getProject(id, signal),
  });

  return { project };
};

useProject.getKey = (id: number) => ["project", id];

export const Route = createFileRoute("/project/$projectId")({
  loader: ({ params }) => {
    return {
      projectId: Number(params.projectId),
    };
  },
  component: ProjectPage,
});

const ProjectView = ({ projectId }: { projectId: number }): ReactElement => {
  const { project } = useProject(projectId);

  return <div>{project.name}</div>;
};

const ProjectPage = (): ReactElement => {
  const { projectId } = Route.useLoaderData();

  return <ProjectView projectId={projectId} />;
};
```

Route params and route-entry data belong in the route. Async reads should be handled via the project’s hook/use-case/query architecture, not raw fetch calls in the component body.

### CRITICAL Guard logic inside the page component

Wrong:

```tsx
// src/routes/settings.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactElement, useEffect } from "react";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

const SettingsPage = (): ReactElement => {
  const navigate = useNavigate();

  useEffect(() => {
    const hasAccess = false;

    if (!hasAccess) {
      void navigate({
        to: "/login",
      });
    }
  }, [navigate]);

  return <div>Settings</div>;
};
```

Correct:

```tsx
// src/routes/settings.tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const Route = createFileRoute("/settings")({
  beforeLoad: () => {
    const hasAccess = false;

    if (!hasAccess) {
      throw redirect({
        to: "/login",
      });
    }
  },
  component: SettingsPage,
});

const SettingsPage = (): ReactElement => {
  return <div>Settings</div>;
};
```

Route access checks and redirects belong in `beforeLoad`, not in component effects.

### HIGH Parsing search params manually

Wrong:

```tsx
// src/routes/library.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/library")({
  component: LibraryPage,
});

const LibraryPage = () => {
  const rawSearch = new URLSearchParams(window.location.search);
  const query = rawSearch.get("query") ?? "";
  const tab = rawSearch.get("tab") ?? "all";

  return (
    <div>
      <div>{query}</div>
      <div>{tab}</div>
    </div>
  );
};
```

Correct:

```tsx
// src/routes/library.tsx
import { zodValidator } from "@tanstack/zod-adapter";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const librarySearchSchema = z.object({
  query: z.string().optional().default(""),
  tab: z.enum(["all", "samples", "presets"]).default("all"),
});

export const Route = createFileRoute("/library")({
  validateSearch: zodValidator(librarySearchSchema),
  component: LibraryPage,
});

const LibraryPage = () => {
  const search = Route.useSearch();

  return (
    <div>
      <div>{search.query}</div>
      <div>{search.tab}</div>
    </div>
  );
};
```

Search params must be validated and typed through the route, not parsed manually.

### HIGH Using manual navigation APIs

Wrong:

```tsx
// src/modules/Project/presentations/components/OpenProjectButton.tsx
import { type ReactElement } from "react";

export const OpenProjectButton = ({
  projectId,
}: {
  projectId: number;
}): ReactElement => {
  const handleOpenProject = () => {
    window.location.href = `/project/${projectId}`;
  };

  return (
    <button type="button" onClick={handleOpenProject}>
      Open Project
    </button>
  );
};
```

Correct:

```tsx
// src/modules/Project/presentations/components/OpenProjectButton.tsx
import { useNavigate } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const OpenProjectButton = ({
  projectId,
}: {
  projectId: number;
}): ReactElement => {
  const navigate = useNavigate();

  const handleOpenProject = () => {
    void navigate({
      to: "/project/$projectId",
      params: {
        projectId: String(projectId),
      },
    });
  };

  return (
    <button type="button" onClick={handleOpenProject}>
      Open Project
    </button>
  );
};
```

Always use TanStack Router navigation APIs so routing stays typed and consistent.

### HIGH Putting business logic in route loaders

Wrong:

```tsx
// src/routes/project.$projectId.export.tsx
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/project/$projectId/export")({
  loader: async ({ params }) => {
    const projectId = Number(params.projectId);
    const project = await fetchProject(projectId);
    const stems = await renderStems(project);
    const archive = await zipStems(stems);

    return {
      archive,
    };
  },
  component: ExportPage,
});

const ExportPage = () => {
  const { archive } = Route.useLoaderData();

  return <div>{archive.name}</div>;
};
```

Correct:

```tsx
// src/routes/project.$projectId.export.tsx
import { createFileRoute } from "@tanstack/react-router";
import { type ReactElement } from "react";

export const Route = createFileRoute("/project/$projectId/export")({
  loader: ({ params }) => {
    return {
      projectId: Number(params.projectId),
    };
  },
  component: ExportPage,
});

const ExportPage = (): ReactElement => {
  const { projectId } = Route.useLoaderData();

  return <ExportView projectId={projectId} />;
};

const ExportView = ({ projectId }: { projectId: number }): ReactElement => {
  return <div>Export project {projectId}</div>;
};
```

Route loaders may normalize params and prepare route-entry data, but business workflows belong in use cases and the views/hooks layer.

Source: architecture rules require keeping business logic framework-agnostic and using presentations/hooks as the UI integration layer. :contentReference[oaicite:0]{index=0}
