import type { SyncMessage } from "../models/CollaborationTypes";

type TransportCallbacks = {
    onMessage: (msg: SyncMessage) => void;
    onConnect: () => void;
    onDisconnect: () => void;
    onError: (error: string) => void;
};

let ws: WebSocket | null = null;
let activeCallbacks: TransportCallbacks | null = null;

export const getCallbacks = (): TransportCallbacks | null => activeCallbacks;

export const connect = (url: string, cbs: TransportCallbacks): void => {
    activeCallbacks = cbs;
    try {
        ws = new WebSocket(url);
        ws.onopen = () => {
            cbs.onConnect();
        };
        ws.onclose = () => {
            cbs.onDisconnect();
        };
        ws.onerror = () => {
            cbs.onError("WebSocket connection failed");
        };
        ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data as string) as SyncMessage;
                cbs.onMessage(msg);
            } catch {
                /* malformed message — skip */
            }
        };
    } catch {
        cbs.onError("Failed to create WebSocket connection");
    }
};

export const send = (msg: SyncMessage): void => {
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
};

export const disconnect = (): void => {
    ws?.close();
    ws = null;
    activeCallbacks = null;
};

export const isConnected = (): boolean => ws?.readyState === WebSocket.OPEN;
