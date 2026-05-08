import * as jwtLib from 'jsonwebtoken'
import type { Cache } from '@org/caches'
import {
  JWT_DEFAULT_PRIVATE_KEY,
  JWT_DEFAULT_PUBLIC_KEY,
  JWT_DEFAULT_REFRESH_PRIVATE_KEY,
  JWT_DEFAULT_REFRESH_PUBLIC_KEY,
  JWT_DEFAULT_EXPIRY,
  JWT_DEFAULT_REFRESH_EXPIRY,
  TOKEN_CACHE_KEY_PREFIX,
} from '../../../constant/jwt'

export interface Token {
  access_token: string
  refresh_token: string
}

export interface VerifiedToken {
  userID: string
  expiry: number // unix timestamp in seconds
}

export interface JwtOptions {
  privateKey: string
  publicKey: string
  expiry: number
  refreshPrivateKey: string
  refreshPublicKey: string
  refreshExpiry: number
}

// Mirrors jwt.ErrTokenExpired from Go - carries expiry so RefreshTokenService
// can apply the 5-minute grace period without a second decode call
export class JwtExpiredError extends Error {
  readonly verifiedToken: VerifiedToken

  constructor(verifiedToken: VerifiedToken) {
    super('expired token')
    this.name = 'JwtExpiredError'
    this.verifiedToken = verifiedToken
  }
}

export class JwtInvalidError extends Error {
  constructor() {
    super('invalid token')
    this.name = 'JwtInvalidError'
  }
}

export class Jwt {
  readonly privateKey: string
  readonly publicKey: string
  readonly expiry: number
  readonly refreshPrivateKey: string
  readonly refreshPublicKey: string
  readonly refreshExpiry: number
  private readonly cache: Cache

  constructor(opts: Partial<JwtOptions>, cache: Cache) {
    this.privateKey = opts.privateKey || JWT_DEFAULT_PRIVATE_KEY
    this.publicKey = opts.publicKey || JWT_DEFAULT_PUBLIC_KEY
    this.expiry = opts.expiry || JWT_DEFAULT_EXPIRY
    this.refreshPrivateKey = opts.refreshPrivateKey || JWT_DEFAULT_REFRESH_PRIVATE_KEY
    this.refreshPublicKey = opts.refreshPublicKey || JWT_DEFAULT_REFRESH_PUBLIC_KEY
    this.refreshExpiry = opts.refreshExpiry || JWT_DEFAULT_REFRESH_EXPIRY
    this.cache = cache
  }

  generateToken(user: { uid: string }): Token {
    const now = Math.floor(Date.now() / 1000)
    const accessToken = jwtLib.sign(
      { sub: user.uid, iat: now },
      this.privateKey,
      { algorithm: 'RS256', expiresIn: this.expiry }
    )
    const refreshToken = jwtLib.sign(
      { sub: user.uid, iat: now },
      this.refreshPrivateKey,
      { algorithm: 'RS256', expiresIn: this.refreshExpiry }
    )

    return { access_token: accessToken, refresh_token: refreshToken }
  }

  async validateAccessToken(accessToken: string): Promise<VerifiedToken> {
    return this.validateToken(accessToken, this.publicKey)
  }

  // verifyOnly — verify signature + expiry only, NO blacklist check.
  // Faster than validateAccessToken; trade-off: revoked tokens still pass until natural expiry.
  verifyOnly(token: string): VerifiedToken {
    try {
      const payload = jwtLib.verify(token, this.publicKey, { algorithms: ['RS256'] }) as jwtLib.JwtPayload
      return {
        userID: payload['sub'] as string,
        expiry: payload['exp'] as number,
      }
    } catch (err) {
      if (err instanceof jwtLib.TokenExpiredError) {
        const decoded = jwtLib.decode(token) as jwtLib.JwtPayload | null
        throw new JwtExpiredError({ userID: '', expiry: decoded?.['exp'] ?? 0 })
      }
      throw new JwtInvalidError()
    }
  }

  async validateRefreshToken(refreshToken: string): Promise<VerifiedToken> {
    return this.validateToken(refreshToken, this.refreshPublicKey)
  }

  // Mirrors BlacklistToken: stores base64(token) in cache with remaining TTL
  async blacklistToken(verified: VerifiedToken, token: string): Promise<void> {
    const ttl = verified.expiry - Math.floor(Date.now() / 1000)
    if (ttl <= 0) return
    const key = this.buildCacheKey(token)
    await this.cache.set(key, verified.userID, ttl)
  }

  encodeToken(token: string): string {
    return Buffer.from(token).toString('base64')
  }

  private buildCacheKey(token: string): string {
    return `${TOKEN_CACHE_KEY_PREFIX}${this.encodeToken(token)}`
  }

  // Mirrors isTokenBlacklisted: key exists in cache means blacklisted
  private async isTokenBlacklisted(token: string): Promise<boolean> {
    const key = this.buildCacheKey(token)
    const exists = await this.cache.get<string>(key, true) // always read from Redis — stale L1 must not grant access to blacklisted tokens
    return exists !== null
  }

  private async validateToken(token: string, publicKey: string): Promise<VerifiedToken> {
    const isBlacklisted = await this.isTokenBlacklisted(token)
    if (isBlacklisted) throw new JwtInvalidError()

    try {
      const payload = jwtLib.verify(token, publicKey, {
        algorithms: ['RS256'],
      }) as jwtLib.JwtPayload

      return {
        userID: payload['sub'] as string,
        expiry: payload['exp'] as number,
      }
    } catch (err) {
      if (err instanceof jwtLib.TokenExpiredError) {
        // Mirrors Go: return VerifiedToken{Expiry} + ErrTokenExpired
        // so the caller (RefreshTokenService) can apply the grace period
        const decoded = jwtLib.decode(token) as jwtLib.JwtPayload | null
        throw new JwtExpiredError({ userID: '', expiry: decoded?.['exp'] ?? 0 })
      }
      throw new JwtInvalidError()
    }
  }
}
