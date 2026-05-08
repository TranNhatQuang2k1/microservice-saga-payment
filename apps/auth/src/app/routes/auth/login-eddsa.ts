// login-eddsa.ts — EdDSA login route + JWKS endpoint.
//
// Routes exposed:
//   POST   /v3/login             — same flow as /v2/login, tokens signed with Ed25519
//   POST   /v3/token/refresh     — refresh with EdDSA tokens
//   POST   /v3/logout            — blacklist via Redis
//   GET    /.well-known/jwks.json — public keys for other microservices to verify tokens
//
// Mount in app.ts (keeps old routes untouched):
//   fastify.register(import('./routes/auth/login-eddsa'), { prefix: '/auth' })
//
// Env vars required (generate with: pnpm ts-node apps/auth/scripts/gen-ed25519-keys.ts):
//   JWT_PRIVATE_KEY          PKCS#8 PEM (with \n literals or real newlines)
//   JWT_PUBLIC_KEY           SPKI PEM
//   JWT_REFRESH_PRIVATE_KEY  PKCS#8 PEM
//   JWT_REFRESH_PUBLIC_KEY   SPKI PEM
//   JWT_ISSUER               e.g. https://auth.convoy.internal
//   JWT_AUDIENCE             e.g. https://api.convoy.internal
//   JWT_KEY_ID               e.g. 2025-v1

import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as bcrypt from 'bcrypt'
import { JwtEdDSA, type EdDSAJwtOptions } from '../../helper/realm/jwt/jwt-eddsa'
import { JwtExpiredError, JwtInvalidError } from '../../helper/realm/jwt/jwt'
import { ErrUserNotFound } from '../../repository/user'
import type { LoginUserData, TokenData } from '../../services/user/user.service'

// Extend Fastify types — jwtEdDSA available across the instance after plugin registration
declare module 'fastify' {
  interface FastifyInstance {
    jwtEdDSA: JwtEdDSA
    requireEdDSA: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    decodeEdDSA: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
}

// Resolve PEM from env — supports both "\n" escaped strings and real multiline
function loadPem(envKey: string): string {
  const raw = process.env[envKey]
  if (!raw) throw new Error(`Missing required env var: ${envKey}`)
  return raw.replace(/\\n/g, '\n')
}

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  return parts.length === 2 && parts[0].toLowerCase() === 'bearer' ? parts[1] : null
}

export default fp(
  async function loginEdDSAPlugin(fastify: FastifyInstance, opts: Partial<EdDSAJwtOptions>) {
    // Load key material from env (or from opts for testing)
    const resolvedOpts: EdDSAJwtOptions = {
      privateKeyPem:        opts.privateKeyPem        ?? loadPem('JWT_PRIVATE_KEY'),
      publicKeyPem:         opts.publicKeyPem         ?? loadPem('JWT_PUBLIC_KEY'),
      refreshPrivateKeyPem: opts.refreshPrivateKeyPem ?? loadPem('JWT_REFRESH_PRIVATE_KEY'),
      refreshPublicKeyPem:  opts.refreshPublicKeyPem  ?? loadPem('JWT_REFRESH_PUBLIC_KEY'),
      issuer:               opts.issuer               ?? (process.env['JWT_ISSUER']   ?? 'http://auth.convoy.internal'),
      audience:             opts.audience             ?? (process.env['JWT_AUDIENCE'] ?? 'http://api.convoy.internal'),
      keyId:                opts.keyId               ?? (process.env['JWT_KEY_ID']   ?? 'default'),
      expiry:               opts.expiry               ?? 1800,
      refreshExpiry:        opts.refreshExpiry        ?? 86400,
    }

    const jwtEdDSA = new JwtEdDSA(resolvedOpts, fastify.cache)

    fastify.decorate('jwtEdDSA', jwtEdDSA)

    // ── requireEdDSA ─────────────────────────────────────────────────────────
    // Full validation: Redis blacklist check + EdDSA sync verify + DB lookup.
    fastify.decorate(
      'requireEdDSA',
      async function (request: FastifyRequest, reply: FastifyReply) {
        const token = extractBearer(request.headers['authorization'])
        if (!token) {
          return reply.code(401).send({ message: 'Authorization header with Bearer token required' })
        }
        try {
          const verified = await jwtEdDSA.validateAccessToken(token)
          const user = await fastify.userRepo.findUserByID(verified.userID)
          request.authUser = {
            authenticatedByRealm: 'eddsa_realm',
            credential: { type: 'jwt' as any, token },
            user,
          }
        } catch {
          return reply.code(401).send({ message: 'Unauthorized' })
        }
      }
    )

    // ── decodeEdDSA ───────────────────────────────────────────────────────────
    // Lightweight: sync LRU verify only — ~0.005ms cached, no Redis, no DB.
    // Use for high-throughput read-only endpoints (GET /products, GET /orders, etc.)
    fastify.decorate(
      'decodeEdDSA',
      async function (request: FastifyRequest, reply: FastifyReply) {
        const token = extractBearer(request.headers['authorization'])
        if (!token) {
          return reply.code(401).send({ message: 'Authorization header with Bearer token required' })
        }
        try {
          const verified = jwtEdDSA.verifyOnly(token)
          request.tokenUID = verified.userID
        } catch {
          return reply.code(401).send({ message: 'Unauthorized' })
        }
      }
    )

    // ── JWKS endpoint ─────────────────────────────────────────────────────────
    // Standard URL used by OAuth2 / OIDC ecosystem.
    // Other microservices (Order, Payment) call this on startup to fetch the public key.
    // On key rotation: bump JWT_KEY_ID, deploy new keys → services auto-discover via kid.
    fastify.get('/.well-known/jwks.json', async (_request, reply) => {
      return reply
        .code(200)
        .header('Cache-Control', 'public, max-age=3600') // clients cache for 1 hour
        .send(jwtEdDSA.getJwks())
    })

    // ── POST /v3/login ────────────────────────────────────────────────────────
    fastify.post<{ Body: LoginUserData }>(
      '/v3/login',
      {
        schema: {
          body: {
            type: 'object',
            required: ['username', 'password'],
            properties: {
              username: { type: 'string', format: 'email' },
              password: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      async (request, reply) => {
        const { username, password } = request.body

        let user
        try {
          user = await fastify.userRepo.findUserByEmail(username)
        } catch (err) {
          if (err instanceof ErrUserNotFound) {
            return reply.code(403).send({ status: 'error', message: 'Invalid credentials' })
          }
          fastify.log.error(err)
          return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
        }

        const match = await bcrypt.compare(password, user.password)
        if (!match) {
          return reply.code(403).send({ status: 'error', message: 'Invalid credentials' })
        }

        // generateToken is sync — Ed25519 sign (~0.1ms), pure CPU, no await
        const token = jwtEdDSA.generateToken(user)

        return reply.code(200).send({
          status: 'success',
          message: 'Login successful',
          data: {
            user: {
              uid:       user.uid,
              firstName: user.firstName,
              lastName:  user.lastName,
              email:     user.email,
            },
            token,
          },
        })
      }
    )

    // ── POST /v3/token/refresh ─────────────────────────────────────────────────
    fastify.post<{ Body: TokenData }>(
      '/v3/token/refresh',
      {
        schema: {
          body: {
            type: 'object',
            required: ['access_token', 'refresh_token'],
            properties: {
              access_token:  { type: 'string' },
              refresh_token: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const { access_token, refresh_token } = request.body

        // Allow expired access token within 5-minute grace period (same logic as original)
        try {
          await jwtEdDSA.validateAccessToken(access_token)
        } catch (err) {
          if (err instanceof JwtExpiredError) {
            const gracePeriod = new Date((err.verifiedToken.expiry + 5 * 60) * 1000)
            if (new Date() > gracePeriod) {
              return reply.code(401).send({ status: 'error', message: 'Access token grace period expired' })
            }
            // Within grace → allow refresh to proceed
          } else if (err instanceof JwtInvalidError) {
            return reply.code(401).send({ status: 'error', message: 'Invalid access token' })
          } else {
            fastify.log.error(err)
            return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
          }
        }

        let verified
        try {
          verified = await jwtEdDSA.validateRefreshToken(refresh_token)
        } catch {
          return reply.code(401).send({ status: 'error', message: 'Invalid or expired refresh token' })
        }

        let user
        try {
          user = await fastify.userRepo.findUserByID(verified.userID)
        } catch (err) {
          if (err instanceof ErrUserNotFound) {
            return reply.code(401).send({ status: 'error', message: 'User not found' })
          }
          fastify.log.error(err)
          return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
        }

        const newToken = jwtEdDSA.generateToken(user)

        try {
          await jwtEdDSA.blacklistToken(verified, refresh_token)
        } catch (err) {
          fastify.log.error(err)
          return reply.code(500).send({ status: 'error', message: 'Failed to rotate refresh token' })
        }

        return reply.code(200).send({
          status: 'success',
          message: 'Token refresh successful',
          data: newToken,
        })
      }
    )

    // ── POST /v3/logout ───────────────────────────────────────────────────────
    fastify.post(
      '/v3/logout',
      { preHandler: fastify.requireEdDSA },
      async (request, reply) => {
        const token = extractBearer(request.headers['authorization'])!
        try {
          const verified = await jwtEdDSA.validateAccessToken(token)
          await jwtEdDSA.blacklistToken(verified, token)
        } catch (err) {
          if (err instanceof JwtInvalidError) {
            return reply.code(401).send({ status: 'error', message: 'Invalid token' })
          }
          fastify.log.error(err)
          return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
        }
        return reply.code(200).send({ status: 'success', message: 'Logout successful' })
      }
    )
  },
  {
    name: 'login-eddsa',
    dependencies: ['cache'],
  }
)
