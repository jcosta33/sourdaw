import { type IFaustCompiler } from '@grame/faustwasm';

import currentSound from './faustCurrentSound.lib?raw';

type FaustLibraryWriter = Pick<ReturnType<IFaustCompiler['fs']>, 'writeFile'>;

/** Install explicit stock device laws before this compiler is published as ready. */
export function installFaustCurrentSound(compiler: { fs(): FaustLibraryWriter }): void {
    compiler.fs().writeFile('/usr/share/faust/sourdaw-current-sound.lib', currentSound);
}
