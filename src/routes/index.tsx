import { type ReactElement } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ArrangeView } from "#/modules/Workspace/presentations/views/ArrangeView";
import { ClipView } from "#/modules/Workspace/presentations/views/ClipView";
import { MixView } from "#/modules/Workspace/presentations/views/MixView";
import { useWorkspaceState } from "#/modules/Workspace/presentations/hooks/useWorkspaceState";

export const Route = createFileRoute("/")({
    component: IndexPage,
});

function IndexPage(): ReactElement {
    const { mode } = useWorkspaceState();

    switch (mode) {
        case "arrange":
            return <ArrangeView />;
        case "clip":
            return <ClipView />;
        case "mix":
            return <MixView />;
    }
}
