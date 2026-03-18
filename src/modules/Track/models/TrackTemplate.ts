import { type Device, type Send, type TrackKind } from './Track';

export type TrackTemplate = {
    id: string;
    name: string;
    category: string;
    trackKind: TrackKind;
    devices: Device[];
    sends: Send[];
    gain: number;
    pan: number;
    color: string;
    createdAt: number;
};
