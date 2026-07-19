type TrackFreezeSource = {
    clips: readonly {
        id: string;
        startBeat: number;
        endBeat: number;
        assetHash?: string;
        gain: number;
    }[];
    devices: readonly {
        id: string;
        type: string;
        parameterValues: Readonly<Record<string, number>>;
        bypassed: boolean;
    }[];
};

export function createTrackFreezeSourceSignature(source: TrackFreezeSource): string {
    const clipSignatures = [...source.clips]
        .sort((alpha, buffer) => alpha.startBeat - buffer.startBeat || alpha.id.localeCompare(buffer.id))
        .map((clip) => {
            const duration = clip.endBeat - clip.startBeat;
            return `${clip.id}:${clip.startBeat}:${duration}:${clip.assetHash ?? ''}:${clip.gain}`;
        });
    const deviceSignatures = source.devices.map((device) => {
        const parameters = Object.entries(device.parameterValues)
            .sort(([alpha], [buffer]) => alpha.localeCompare(buffer))
            .map(([name, value]) => `${name}=${value}`)
            .join(',');
        return `${device.id}:${device.type}:${parameters}:${device.bypassed}`;
    });

    return `${clipSignatures.join('|')}||${deviceSignatures.join('|')}`;
}
