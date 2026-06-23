import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import path from "node:path";
import url from "node:url";
import json from '@rollup/plugin-json';
import { glob } from 'glob';
import fs from 'node:fs';

const isWatching = !!process.env.ROLLUP_WATCH;
const flexPlugin = "com.michikora.smtcplugin.plugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
  input: "src/plugin.js",
  output: {
    file: `${flexPlugin}/backend/plugin.cjs`,
    format: "cjs",
    sourcemap: isWatching,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
    },
  },
  plugins: [
    json(),
    {
      name: "watch-externals",
      buildStart: function () {
        this.addWatchFile(`${flexPlugin}/manifest.json`);
        const vueFiles = glob.sync(`${flexPlugin}/ui/*.vue`);
        vueFiles.forEach((file) => {
          this.addWatchFile(file);
        });
      },
    },
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true
    }),
    commonjs({
      ignoreDynamicRequires: true
    }),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({ fileName: "package.json", source: `{ "type": "commonjs" }`, type: "asset" });
      }
    },
    {
      name: "copy-package-json",
      writeBundle: async () => {
        try {
          const packageJson = {
            "name": "plugin-backend",
            "version": "1.0.0",
            "private": true,
            "type": "commonjs",
            "dependencies": {
              "@napi-rs/canvas": "*",
              "@eniac/flexdesigner": "*",
              "node-vibrant": "*"
            }
          };
          const packageJsonPath = path.join(flexPlugin, 'backend', 'package.json');
          fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
          console.log('\\n[Package] Generated backend/package.json with production dependencies.');
        } catch (err) {
          console.error('Error generating package.json:', err);
        }
      }
    },
    {
      name: "copy-native-bindings",
      writeBundle: async () => {
        // Custom copy step for native node bindings
        // Load from local vendor folder where we manually compiled the rust code
        const nodeFileName = 'windows-smtc-monitor.win32-x64-msvc.node';
        
        let sourcePath = path.resolve('vendor/node-windows-smtc-monitor', nodeFileName);
        
        // Fallback to node_modules if we don't have it locally
        if (!fs.existsSync(sourcePath)) {
          const nodeModuleName = '@coooookies/windows-smtc-monitor-win32-x64-msvc';
          sourcePath = path.resolve('node_modules', nodeModuleName, nodeFileName);
        }
        
        const destDir = path.resolve(flexPlugin, 'backend');
        const destPath = path.resolve(destDir, nodeFileName);
        
        if (fs.existsSync(sourcePath)) {
          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }
          try {
            fs.copyFileSync(sourcePath, destPath);
            console.log(`\n[Native Binding] Copied ${nodeFileName} to backend/`);
          } catch (err) {
            if (err.code === 'EBUSY') {
              console.log(`\n[Native Binding] File ${nodeFileName} is locked (EBUSY), skipping copy.`);
            } else {
              throw err;
            }
          }
        } else {
          console.warn(`\n[Native Binding Warning] Could not find ${sourcePath}. If you are on x64 Windows, make sure the optional dependency is installed.`);
        }
        
        // Copy native-sound-mixer.node
        const soundMixerNodeName = 'win-sound-mixer.node';
        const soundMixerSourcePath = path.resolve('node_modules/native-sound-mixer/dist/addons', soundMixerNodeName);
        const soundMixerDestDir = path.resolve(destDir, 'addons');
        const soundMixerDestPath = path.resolve(soundMixerDestDir, soundMixerNodeName);
        
        if (fs.existsSync(soundMixerSourcePath)) {
          if (!fs.existsSync(soundMixerDestDir)) {
            fs.mkdirSync(soundMixerDestDir, { recursive: true });
          }
          try {
            fs.copyFileSync(soundMixerSourcePath, soundMixerDestPath);
            console.log(`\n[Native Binding] Copied ${soundMixerNodeName} to backend/addons/`);
          } catch (err) {
            if (err.code === 'EBUSY') {
              console.log(`\n[Native Binding] File ${soundMixerNodeName} is locked (EBUSY), skipping copy.`);
            } else {
              throw err;
            }
          }
        } else {
          console.warn(`\n[Native Binding Warning] Could not find ${soundMixerSourcePath}. Did native-sound-mixer compile successfully?`);
        }
      }
    }
  ],
  external: id => id.endsWith('.node') || id === '@eniac/flexdesigner' || id.startsWith('node-vibrant'),
};

export default config;
