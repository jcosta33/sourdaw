export type ElectronReleaseTarget = {
    platform: 'darwin' | 'linux' | 'win32';
    arch: 'arm64' | 'x64';
    archive: string;
    sha256: string;
    noticesSha256: string;
};

export type ElectronRuntimeContract = {
    schemaVersion: 1;
    package: 'electron';
    version: string;
    specifier: string;
    integrity: string;
    license: 'MIT';
    repository: string;
    revision: string;
    licenseSha256: string;
    chromium: {
        version: string;
        repository: string;
        revision: string;
    };
    node: {
        version: string;
        repository: string;
        revision: string;
    };
    ffmpeg: {
        repository: string;
        revision: string;
        license: 'LGPL-2.1-or-later';
    };
    targets: ElectronReleaseTarget[];
};

export const ELECTRON_RUNTIME_CONTRACT: ElectronRuntimeContract = {
    schemaVersion: 1,
    package: 'electron',
    version: '44.9.1',
    specifier: '44.9.1',
    integrity: 'sha512-x/tECFFDa2OFNjMObFH0EGKWrCnFZPOR1wP2iMIVt0STecGl8FmDXdaiaryY0kf8mtw9kSLP2yK8dfdaWkfDmw==',
    license: 'MIT',
    repository: 'https://github.com/electron/electron',
    revision: 'e02265be96c5e13ae43644ef482b718e1e800499',
    licenseSha256: '5154e165bd6c2cc0cfbcd8916498c7abab0497923bafcd5cb07673fe8480087d',
    chromium: {
        version: '152.0.7977.167',
        repository: 'https://chromium.googlesource.com/chromium/src',
        revision: 'dd78960ccd8a03a2fe1f629543d27783885b78e9',
    },
    node: {
        version: 'v24.22.0',
        repository: 'https://github.com/nodejs/node',
        revision: 'f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93',
    },
    ffmpeg: {
        repository: 'https://chromium.googlesource.com/chromium/third_party/ffmpeg',
        revision: '2b68d2babae73714846961fb0ee47e3b3d2e39a9',
        license: 'LGPL-2.1-or-later',
    },
    targets: [
        {
            platform: 'darwin',
            arch: 'arm64',
            archive: 'electron-v44.9.1-darwin-arm64.zip',
            sha256: 'ff597552c9c7b0b16c39a7fb93a346ee7148afbd372ebcf0c18415482c49fbea',
            noticesSha256: '3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353',
        },
        {
            platform: 'linux',
            arch: 'arm64',
            archive: 'electron-v44.9.1-linux-arm64.zip',
            sha256: '16e1f8f7993ca45bc3c2594d75da9d0f3bbd66d691f8cc408747e135c49cb1ad',
            noticesSha256: '3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353',
        },
        {
            platform: 'linux',
            arch: 'x64',
            archive: 'electron-v44.9.1-linux-x64.zip',
            sha256: '994bc3664cc3ac55b50c21a58d345cf8322003d37f5439a81801e3267e6145e2',
            noticesSha256: '3375e2a9bd7bc631738fde10be6548a76efe8cf5e4b8826b8140ba8b0c4d6353',
        },
        {
            platform: 'win32',
            arch: 'x64',
            archive: 'electron-v44.9.1-win32-x64.zip',
            sha256: '41bd7900bd42d0f49110a81617876137041fbbf473466920248ddb076349ef91',
            noticesSha256: 'e6e6b1f9cb0f32235412be113de7716333e88121f9159a0ea0ff3be652021af7',
        },
    ],
};

const ARCH_NAMES: Readonly<Record<number, string>> = {
    0: 'ia32',
    1: 'x64',
    2: 'armv7l',
    3: 'arm64',
    4: 'universal',
};

export function electronReleaseTarget(
    platform: string,
    arch: number,
    contract: ElectronRuntimeContract = ELECTRON_RUNTIME_CONTRACT
): ElectronReleaseTarget | undefined {
    const archName = ARCH_NAMES[arch];
    return contract.targets.find((target) => target.platform === platform && target.arch === archName);
}
