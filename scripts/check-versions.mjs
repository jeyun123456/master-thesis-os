import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const projectFile = read('experiments/wallpaper-host-poc/WallpaperHostPoc.csproj');
const changelog = read('CHANGELOG.md');
const page = read('app/page.tsx');

const readProjectVersion = (name) => {
  const match = projectFile.match(new RegExp(`<${name}>([^<]+)</${name}>`));
  if (!match) throw new Error(`Missing ${name} in WallpaperHostPoc.csproj`);
  return match[1].trim();
};

const appVersion = packageJson.version;
const wallpaperVersion = readProjectVersion('Version');
const assemblyVersion = readProjectVersion('AssemblyVersion');
const fileVersion = readProjectVersion('FileVersion');

const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
  errors.push(`package.json version is not a stable SemVer triplet: ${appVersion}`);
}
if (!/^\d+\.\d+\.\d+$/.test(wallpaperVersion)) {
  errors.push(`Companion Version is not a stable SemVer triplet: ${wallpaperVersion}`);
}
if (assemblyVersion !== `${wallpaperVersion}.0`) {
  errors.push(`AssemblyVersion ${assemblyVersion} does not match Companion Version ${wallpaperVersion}.0`);
}
if (fileVersion !== `${wallpaperVersion}.0`) {
  errors.push(`FileVersion ${fileVersion} does not match Companion Version ${wallpaperVersion}.0`);
}
if (!page.includes("import appPackage from '../package.json'")) {
  errors.push('app/page.tsx does not read the web-app version from package.json');
}
if (!page.includes('APP_VERSION')) {
  errors.push('app/page.tsx does not use APP_VERSION for displayed metadata');
}
if (!changelog.includes(`## [${appVersion}]`)) {
  errors.push(`CHANGELOG.md has no entry for web-app version ${appVersion}`);
}
if (!changelog.includes(`## [Wallpaper ${wallpaperVersion}]`)) {
  errors.push(`CHANGELOG.md has no entry for Companion version ${wallpaperVersion}`);
}

if (errors.length > 0) {
  console.error('Version check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Version check passed: web app ${appVersion}; Wallpaper Companion ${wallpaperVersion}.`);
