/** Bound by the app; Crumbs never imports the document owner to authorize presentation work. */
export const crumbsSampleProjectAccess: { current: ((deviceId: string) => number | null) | null } = {
    current: null,
};
