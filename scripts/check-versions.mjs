import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const read = (relativePath) => readFileSync(join(root, relativePath), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const changelog = read('CHANGELOG.md');
const page = read('app/page.tsx');

const appVersion = packageJson.version;

const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
  errors.push(`package.json version is not a stable SemVer triplet: ${appVersion}`);
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

if (errors.length > 0) {
  console.error('Version check failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Version check passed: web app ${appVersion}.`);
