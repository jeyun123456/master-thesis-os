import { createRequire } from 'node:module';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

const require = createRequire(import.meta.url);

export const deniedNetworkAttempts: string[] = [];
export const storageAccesses: string[] = [];
export const fakeStorageValues = new Map<string, string>();
const restoreSafetyGuards: Array<() => void> = [];
const allowedStorageKeys = new Set(['chocomintLab.inbox.v1', 'thesisBridgeToken']);
let failInboxStorageWrites = false;

export const fakeStorage = {
  getItem(key: string) {
    storageAccesses.push(`get:${key}`);
    if (!allowedStorageKeys.has(key)) throw new Error(`Unexpected localStorage key: ${key}`);
    return fakeStorageValues.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    storageAccesses.push(`set:${key}`);
    if (!allowedStorageKeys.has(key)) throw new Error(`Unexpected localStorage key: ${key}`);
    if (failInboxStorageWrites && key === 'chocomintLab.inbox.v1') throw new Error('fake storage full');
    fakeStorageValues.set(key, String(value));
  },
};

export const fakeWindow = { localStorage: fakeStorage };

export function failInboxStorageWritesForTest(shouldFail: boolean) {
  failInboxStorageWrites = shouldFail;
}

export function denyNetwork(label: string): never {
  deniedNetworkAttempts.push(label);
  throw new Error(`Blocked network capability: ${label}`);
}

export function assertNoDeniedAttempts() {
  if (deniedNetworkAttempts.length) throw new Error(`Denied network attempts: ${deniedNetworkAttempts.join(', ')}`);
}

function replaceProperty(target: object, key: PropertyKey, value: unknown) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: descriptor?.enumerable ?? false,
    writable: true,
    value,
  });
  restoreSafetyGuards.push(() => {
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as Record<PropertyKey, unknown>)[key];
  });
}

function patchMethod(target: object, key: string, label: string) {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (!descriptor || typeof descriptor.value !== 'function') return;
  replaceProperty(target, key, (..._args: unknown[]) => denyNetwork(label));
}

function patchGlobalConstructor(name: 'XMLHttpRequest' | 'WebSocket') {
  function BlockedCapability(this: unknown, ..._args: unknown[]): never {
    return denyNetwork(`globalThis.${name}`);
  }
  replaceProperty(globalThis, name, BlockedCapability);
}

function installSafetyGuards() {
  replaceProperty(globalThis, 'fetch', (..._args: unknown[]) => denyNetwork('globalThis.fetch'));
  patchGlobalConstructor('XMLHttpRequest');
  patchGlobalConstructor('WebSocket');
  replaceProperty(globalThis, 'localStorage', fakeStorage);
  replaceProperty(globalThis, 'window', fakeWindow);

  const modules: Array<[string, string[]]> = [
    ['node:http', ['request', 'get']],
    ['node:https', ['request', 'get']],
    ['node:http2', ['connect']],
    ['node:net', ['connect', 'createConnection']],
    ['node:tls', ['connect']],
    ['node:dgram', ['createSocket']],
    ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']],
    ['node:dns/promises', ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']],
  ];
  for (const [id, methods] of modules) {
    const module = require(id) as object;
    for (const method of methods) patchMethod(module, method, `${id}.${method}`);
  }

  const dnsModule = require('node:dns') as {
    Resolver?: { prototype: object };
    promises?: { Resolver?: { prototype: object } };
  };
  const dnsPromisesModule = require('node:dns/promises') as { Resolver?: { prototype: object } };
  const resolverMethods = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse'];
  for (const [label, prototype] of [
    ['node:dns.Resolver', dnsModule.Resolver?.prototype],
    ['node:dns.promises.Resolver', dnsModule.promises?.Resolver?.prototype],
    ['node:dns/promises.Resolver', dnsPromisesModule.Resolver?.prototype],
  ] as const) {
    if (!prototype) continue;
    for (const method of resolverMethods) patchMethod(prototype, method, `${label}.${method}`);
  }
  const netModule = require('node:net') as { Socket?: { prototype: object } };
  if (netModule.Socket) patchMethod(netModule.Socket.prototype, 'connect', 'node:net.Socket.prototype.connect');
}

function restoreGuards() {
  for (const restore of restoreSafetyGuards.reverse()) restore();
  restoreSafetyGuards.length = 0;
}

beforeAll(installSafetyGuards);
afterEach(() => {
  assertNoDeniedAttempts();
  expect(storageAccesses.every((access) => allowedStorageKeys.has(access.slice(access.indexOf(':') + 1)))).toBe(true);
  expect(globalThis.localStorage).toBe(fakeStorage);
  expect(globalThis.window.localStorage).toBe(fakeStorage);
  deniedNetworkAttempts.length = 0;
  storageAccesses.length = 0;
  fakeStorageValues.clear();
  failInboxStorageWrites = false;
});
afterAll(() => {
  try {
    assertNoDeniedAttempts();
    expect(storageAccesses.every((access) => allowedStorageKeys.has(access.slice(access.indexOf(':') + 1)))).toBe(true);
  } finally {
    restoreGuards();
  }
});
