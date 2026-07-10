export function getAudioParamKeyForPedal(isPost: boolean, pedalType: string, paramKey: string): string | null {
    const prefix = isPost ? 'post' : 'pre';
    let pedalName: string;

    switch (pedalType) {
        case 'compressor':
            pedalName = 'Compressor';
            break;
        case 'overdrive':
        case 'boost':
            pedalName = 'Overdrive';
            break;
        case 'distortion':
            pedalName = 'Distortion';
            break;
        case 'fuzz':
            pedalName = 'Fuzz';
            break;
        default:
            return null;
    }

    const capitalizedParam = paramKey.charAt(0).toUpperCase() + paramKey.slice(1);
    return `${prefix}${pedalName}${capitalizedParam}`;
}
