/**
 * Faithful reproduction of Tauri v2's own IPC serializer
 * (`tauri/scripts/process-ipc-message-fn.js`): a message that *is* an
 * ArrayBuffer / typed-array view / Array crosses as `application/octet-stream`
 * untransformed; anything else is `JSON.stringify`d with a replacer that turns
 * every **nested** `Uint8Array`/`ArrayBuffer` into a boxed `number[]` via
 * `Array.from`.
 *
 * Shared by every spec that measures what a payload actually costs on the wire,
 * so the OE-5 / WB-5 / M-109 inflation is proved against one reproduction rather
 * than a per-spec paraphrase of it.
 */

export type SerializedIpcMessage = {
    contentType: string;
    byteLength: number;
};

export function serializeLikeTauri(message: unknown): SerializedIpcMessage {
    if (message instanceof ArrayBuffer) {
        return { contentType: 'application/octet-stream', byteLength: message.byteLength };
    }
    if (ArrayBuffer.isView(message)) {
        return { contentType: 'application/octet-stream', byteLength: message.byteLength };
    }
    if (Array.isArray(message)) {
        return { contentType: 'application/octet-stream', byteLength: message.length };
    }

    const json = JSON.stringify(message, (_key, value: unknown) => {
        if (value instanceof Uint8Array) {
            return Array.from(value);
        }
        if (value instanceof ArrayBuffer) {
            return Array.from(new Uint8Array(value));
        }
        return value;
    });

    return { contentType: 'application/json', byteLength: new TextEncoder().encode(json).length };
}
