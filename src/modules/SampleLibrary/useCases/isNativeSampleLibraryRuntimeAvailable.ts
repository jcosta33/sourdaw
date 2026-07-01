import { isNativeSampleLibraryRuntimeAvailable as readNativeSampleLibraryRuntimeAvailable } from '../repositories/isNativeSampleLibraryRuntimeAvailable';

export function isNativeSampleLibraryRuntimeAvailable(): boolean {
    return readNativeSampleLibraryRuntimeAvailable();
}
