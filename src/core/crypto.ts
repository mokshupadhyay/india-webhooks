// Hashing through Web Crypto (`crypto.subtle`), which Node 19+, Bun, Deno and
// edge runtimes expose globally. Node 18 only has it on `node:crypto`, so that
// module is loaded lazily, and only when the global is missing. The import
// specifier is passed through a parameter with bundler-ignore hints, so edge
// bundles never try to resolve `node:crypto`.

type DigestName = 'SHA-256' | 'SHA-512';

interface SubtleLike {
  importKey(
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: DigestName },
    extractable: boolean,
    usages: string[],
  ): Promise<unknown>;
  sign(algorithm: 'HMAC', key: unknown, data: Uint8Array): Promise<ArrayBuffer>;
  digest(algorithm: DigestName, data: Uint8Array): Promise<ArrayBuffer>;
}

interface NodeCryptoModule {
  webcrypto?: { subtle?: SubtleLike };
  default?: { webcrypto?: { subtle?: SubtleLike } };
}

interface CryptoGlobals {
  crypto?: { subtle?: SubtleLike };
  process?: { getBuiltinModule?: (id: string) => NodeCryptoModule | undefined };
}

let pending: Promise<SubtleLike> | undefined;

function importModule(specifier: string): Promise<NodeCryptoModule> {
  return import(/* webpackIgnore: true */ /* @vite-ignore */ specifier);
}

async function loadSubtle(): Promise<SubtleLike> {
  const g = globalThis as unknown as CryptoGlobals;
  if (g.crypto && g.crypto.subtle) return g.crypto.subtle;

  const getBuiltin = g.process && g.process.getBuiltinModule;
  if (typeof getBuiltin === 'function') {
    const mod = getBuiltin('node:crypto');
    if (mod && mod.webcrypto && mod.webcrypto.subtle) return mod.webcrypto.subtle;
  }

  if (g.process) {
    const mod = await importModule('node:crypto');
    const webcrypto = mod.webcrypto || (mod.default && mod.default.webcrypto);
    if (webcrypto && webcrypto.subtle) return webcrypto.subtle;
  }
  throw new Error('Web Crypto (crypto.subtle) is not available in this runtime.');
}

function subtle(): Promise<SubtleLike> {
  if (!pending) {
    pending = loadSubtle();
    // Let a later call retry if loading failed.
    pending.catch(() => {
      pending = undefined;
    });
  }
  return pending;
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  const s = await subtle();
  const cryptoKey = await s.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await s.sign('HMAC', cryptoKey, message));
}

export async function digest(algorithm: DigestName, data: Uint8Array): Promise<Uint8Array> {
  const s = await subtle();
  return new Uint8Array(await s.digest(algorithm, data));
}
