type HotContext = {
    on: (event: string, listener: (payload: { message: string }) => void) => void;
};

export function createHotContext(ownerPath: string): HotContext;
