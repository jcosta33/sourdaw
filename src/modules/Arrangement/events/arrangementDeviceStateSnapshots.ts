/** Wire mirror of the `DeviceStateChunk` model, which never crosses the module boundary. */
export type DeviceStateValueSnapshot =
    string | number | boolean | null | DeviceStateValueSnapshot[] | { [key: string]: DeviceStateValueSnapshot };

export type DeviceStateChunkSnapshot = {
    readonly version: number;
    readonly data: { readonly [key: string]: DeviceStateValueSnapshot };
};
