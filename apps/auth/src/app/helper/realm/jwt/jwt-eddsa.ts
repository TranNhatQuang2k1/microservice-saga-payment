// jwt-eddsa.ts — Production JWT using Ed25519 asymmetric key pair (EdDSA algorithm).
//
// WHY EdDSA over HS256:
//   HS256 = shared secret → every microservice that verifies tokens must hold the secret.
//           If one service is compromised, all tokens can be forged.
//   EdDSA = private key signs (Auth only) + public key verifies (any service, safely distributed).
//           Compromise of Order/Payment service ≠ ability to forge new tokens.
//
// Performance (fast-jwt, warm LRU cache):
//   EdDSA sign:          ~0.1ms  (Ed25519 is the fastest asymmetric algo in Node crypto)
//   EdDSA verify cold:   ~0.05ms (faster than RSA-256 ~1ms, comparable to HS256 ~0.1ms)
//   EdDSA verify cached: ~0.005ms (LRU hit — identical to HS256 cached, algo doesn't matter)
//
// Key distribution for microservices:
//   Auth service:            holds JWT_PRIVATE_KEY + JWT_REFRESH_PRIVATE_KEY
//   Order/Payment services:  only need JWT_PUBLIC_KEY (read from env or JWKS endpoint)
//
// JWKS endpoint (GET /.well-known/jwks.json):
//   Call getPublicJwk() to build the response. Services auto-discover keys via standard URL.
//   On key rotation: update JWKS → zero downtime (services re-fetch on 401 + unknown kid).
//
// Same public API as Jwt / JwtFast — swap in require-auth.ts with one line change.

 
import { createSigner, createVerifier } from 'fast-jwt'
import { createPublicKey, type KeyObject } from 'crypto'
import type { Cache } from '@org/caches'
import { TOKEN_CACHE_KEY_PREFIX } from '../../../constant/jwt'
import { JwtExpiredError, JwtInvalidError, type Token, type VerifiedToken } from './jwt'

const FAST_JWT_EXPIRED = 'FAST_JWT_EXPIRED'

// ── Option types ─────────────────────────────────────────────────────────────

export interface EdDSAJwtOptions {
  // PKCS#8 PEM — Auth service ONLY. Never share. Load from secrets manager / env.
  privateKeyPem: string
  // SPKI PEM — Safe to distribute to any microservice that needs to verify tokens.
  publicKeyPem: string
  // Separate key pair for refresh tokens — rotation of access keys doesn't invalidate refreshes
  refreshPrivateKeyPem: string
  refreshPublicKeyPem: string

  expiry?: number        // seconds, default 1800 (30 min)
  refreshExpiry?: number // seconds, default 86400 (24 h)

  // iss claim — identifies who issued this token. Verifier rejects unknown issuers.
  issuer: string   // e.g. 'https://auth.convoy.internal'
  // aud claim — identifies intended recipients. Verifier rejects wrong audiences.
  audience: string // e.g. 'https://api.convoy.internal'

  // kid — key ID embedded in the JWT header. Services use this to select the right
  // key from JWKS when you have multiple keys in rotation.
  keyId?: string // e.g. '2025-v1'
}

// ── JWKS types ────────────────────────────────────────────────────────────────

// PublicJwk — shape returned by GET /.well-known/jwks.json
export interface PublicJwk {
  kty: 'OKP'        // Octet Key Pair (Ed25519 family)
  crv: 'Ed25519'
  x: string         // base64url-encoded 32-byte public key
  use: 'sig'
  alg: 'EdDSA'
  kid: string
}

export interface JwksResponse {
  keys: PublicJwk[]
}

// ── Internal payload ──────────────────────────────────────────────────────────

interface EdDSAPayload {
  sub: string
  exp: number
  iat: number
  iss: string
  aud: string | string[]
}

// ── JwtEdDSA class ────────────────────────────────────────────────────────────

export class JwtEdDSA {
  private readonly signAccess: (payload: object) => string
  private readonly verifyAccess: (token: string) => EdDSAPayload
  private readonly signRefresh: (payload: object) => string
  private readonly verifyRefresh: (token: string) => EdDSAPayload

  // Kept as KeyObject so getPublicJwk() can export in JWK format without re-parsing
  private readonly publicKey: KeyObject
  private readonly publicRefreshKey: KeyObject

  private readonly expiry: number
  private readonly refreshExpiry: number
  private readonly issuer: string
  private readonly audience: string
  private readonly keyId: string
  private readonly cache: Cache

  constructor(opts: EdDSAJwtOptions, cache: Cache) {
    this.expiry       = opts.expiry        ?? 1800
    this.refreshExpiry = opts.refreshExpiry ?? 86400
    this.issuer       = opts.issuer
    this.audience     = opts.audience
    this.keyId        = opts.keyId ?? 'default'
    this.cache        = cache

    // Parse PEM → KeyObject once at startup — NOT per-request.
    // createPrivateKey / createPublicKey are O(1) parsing, not crypto operations.

    this.publicKey          = createPublicKey({ key: opts.publicKeyPem,          format: 'pem' })
    this.publicRefreshKey   = createPublicKey({ key: opts.refreshPublicKeyPem,   format: 'pem' })

    // Signer — sync, pure CPU (Node crypto EdDSA ~0.1ms).
    // kid in header lets JWKS consumers rotate without breaking existing tokens.
    this.signAccess = createSigner({
      key:       opts.privateKeyPem,
      algorithm: 'EdDSA',
      expiresIn: this.expiry * 1000, // fast-jwt uses milliseconds
      header:    { alg: 'EdDSA', kid: this.keyId },
    })
    this.signRefresh = createSigner({
      key:       opts.refreshPrivateKeyPem,
      algorithm: 'EdDSA',
      expiresIn: this.refreshExpiry * 1000,
      header:    { alg: 'EdDSA', kid: `${this.keyId}-refresh` },
    })

    // Verifier — sync + LRU cache.
    //   allowedIss / allowedAud: reject tokens not meant for this system
    //   cache: 1000            : up to 1000 tokens cached in-process (LRU eviction)
    //   cacheTTL               : each slot lives at most expiry ms — prevents stale hits
    //                            for tokens whose payload changed (e.g. after key rotation)
    this.verifyAccess = createVerifier({
      key:        opts.publicKeyPem,
      algorithms: ['EdDSA'],
      cache:      1000,
      cacheTTL:   this.expiry * 1000,
      allowedIss: this.issuer,
      allowedAud: this.audience,
    })
    this.verifyRefresh = createVerifier({
      key:        opts.refreshPublicKeyPem,
      algorithms: ['EdDSA'],
      cache:      1000,
      cacheTTL:   this.refreshExpiry * 1000,
      allowedIss: this.issuer,
      allowedAud: this.audience,
    })
  }

  // generateToken — sync. Both signers are pure CPU (no I/O, no await).
  generateToken(user: { uid: string }): Token {
    const now = Math.floor(Date.now() / 1000)
    const base = {
      sub: user.uid,
      iat: now,
      iss: this.issuer,
      aud: this.audience,
    }
    // Bắt đầu bấm giờ
    return {
      access_token:  this.signAccess(base),
      refresh_token: this.signRefresh(base),
    }
  }

  // verifyOnly — sync LRU verify, NO blacklist check.
  // Use for read-only endpoints where revocation window is acceptable.
  // Latency: ~0.005ms cached, ~0.05ms cold (EdDSA verify).
  verifyOnly(token: string): VerifiedToken {
    try {
      const p = this.verifyAccess(token)
      return { userID: p.sub, expiry: p.exp }
    } catch (err: any) {
      if (err.code === FAST_JWT_EXPIRED) {
        throw new JwtExpiredError({ userID: '', expiry: err.payload?.exp ?? 0 })
      }
      throw new JwtInvalidError()
    }
  }

  // validateAccessToken — Redis blacklist check + sync LRU verify.
  // Use for write operations where revoked tokens must be rejected immediately.
  async validateAccessToken(token: string): Promise<VerifiedToken> {
    const isBlacklisted = await this.isTokenBlacklisted(token)
    if (isBlacklisted) throw new JwtInvalidError()
    return this.verifyOnly(token) // sync — LRU hit costs ~0.005ms
  }

  async validateRefreshToken(refreshToken: string): Promise<VerifiedToken> {
    const isBlacklisted = await this.isTokenBlacklisted(refreshToken)
    if (isBlacklisted) throw new JwtInvalidError()
    try {
      const p = this.verifyRefresh(refreshToken)
      return { userID: p.sub, expiry: p.exp }
    } catch (err: any) {
      if (err.code === FAST_JWT_EXPIRED) {
        throw new JwtExpiredError({ userID: '', expiry: err.payload?.exp ?? 0 })
      }
      throw new JwtInvalidError()
    }
  }

  async blacklistToken(verified: VerifiedToken, token: string): Promise<void> {
    const ttl = verified.expiry - Math.floor(Date.now() / 1000)
    if (ttl <= 0) return
    await this.cache.set(this.buildCacheKey(token), verified.userID, ttl)
  }

  // getPublicJwk — expose via GET /.well-known/jwks.json so other microservices
  // can fetch the public key without needing shared env vars.
  // Call on GET /.well-known/jwks.json: reply.send({ keys: [jwtEdDSA.getPublicJwk()] })
  getPublicJwk(): PublicJwk {
    const jwk = this.publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string }
    return {
      kty: 'OKP',
      crv: 'Ed25519',
      x:   jwk.x,
      use: 'sig',
      alg: 'EdDSA',
      kid: this.keyId,
    }
  }

  // getJwks — convenience method returning full JWKS document with both keys
  getJwks(): JwksResponse {
    const accessJwk = this.getPublicJwk()
    const refreshRaw = this.publicRefreshKey.export({ format: 'jwk' }) as { x: string }
    return {
      keys: [
        accessJwk,
        {
          ...accessJwk,
          x:   refreshRaw.x,
          kid: `${this.keyId}-refresh`,
        },
      ],
    }
  }

  encodeToken(token: string): string {
    return Buffer.from(token).toString('base64')
  }

  private buildCacheKey(token: string): string {
    return `${TOKEN_CACHE_KEY_PREFIX}${this.encodeToken(token)}`
  }

  private async isTokenBlacklisted(token: string): Promise<boolean> {
    const exists = await this.cache.get<string>(this.buildCacheKey(token), true)
    return exists !== null
  }
}
