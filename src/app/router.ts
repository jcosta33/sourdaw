import { createRouter } from "@tanstack/react-router";
import { routeTree } from "#/routeTree.gen";
import { queryClient } from "./queryClient";

export type AppRouterContext = {
    queryClient: typeof queryClient;
};

export const router = createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
    context: {
        queryClient,
    },
});

declare module "@tanstack/react-router" {
    interface Register {
        router: typeof router;
    }
}
