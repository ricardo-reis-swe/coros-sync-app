import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Extensionless: Packager appends .icns or .ico per platform. Regenerate with `npm run icons`.
    icon: 'assets/icon',
    // icon.png rides along for Linux, which resolves it at window creation rather than from a bundle.
    extraResource: ['resources/bin', 'assets/icon.png'],
    // Without the usage string TCC denies the watch's volume silently — no prompt can even fire. (DECISIONS §4, ADR-0045)
    extendInfo: {
      NSRemovableVolumesUsageDescription:
        'Coros Sync needs access to your watch to list and copy music onto it.',
    },
  },
  rebuildConfig: {},
  hooks: {
    // Packager and Fuses both edit the bundle after Electron's own signature, leaving it invalid. (Spike B §4)
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;

      for (const dir of outputPaths) {
        const bundle = readdirSync(dir).find((entry) => entry.endsWith('.app'));
        if (!bundle) continue;

        // Ad-hoc: free, and enough to execute on Apple Silicon. Notarizing is a decision. (ARCHITECTURE §9.3)
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', join(dir, bundle)]);
      }
    },
  },
  makers: [
    new MakerSquirrel({ setupIcon: 'assets/icon.ico' }),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({ options: { icon: 'assets/icon.png' } }),
    new MakerDeb({ options: { icon: 'assets/icon.png' } }),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      // Off Webpack's default 3000, which every other dev server on this machine also wants.
      port: 3010,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      // Playwright attaches over the Node inspector; `package:e2e` sets the variable, a shipped build never does.
      [FuseV1Options.EnableNodeCliInspectArguments]: process.env.E2E_FUSES === '1',
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
