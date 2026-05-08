import fp from 'fastify-plugin'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { CredentialType } from '../interfaces/auth'
import type { AuthenticatedUser } from '../interfaces/auth'
import type { UserRepository } from '../interfaces/user'
import { Jwt } from '../helper/realm/jwt/jwt'
import { JwtRealm } from '../helper/realm/jwt/jwt-realm'

declare module 'fastify' {
  interface FastifyInstance {
    jwtAuth: Jwt
    jwtRealm: JwtRealm
    userRepo: UserRepository
    requireAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    // Lighter preHandler — verify JWT signature only, no blacklist check, no DB lookup.
    // Sets request.tokenUID. Trade-off: revoked tokens remain valid until expiry.
    decodeAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
  }
  interface FastifyRequest {
    authUser: AuthenticatedUser
    tokenUID: string
  }
}

export interface RequireAuthPluginOptions {
  userRepo?: UserRepository
  jwtOptions?: {
    privateKey?: string
    publicKey?: string
    expiry?: number
    refreshPrivateKey?: string
    refreshPublicKey?: string
    refreshExpiry?: number
  }
}

// extractBearerToken mirrors GetAuthFromRequest in middleware.go
// Parses "Authorization: Bearer <token>" header
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const parts = authHeader.split(' ')
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1]
  }
  return null
}

export default fp(async function requireAuthPlugin(
  fastify: FastifyInstance,
  opts: RequireAuthPluginOptions
) {
  // fastify.cache is provided by the 'cache' plugin (must be registered before this)
  const jwt = new Jwt(opts.jwtOptions ?? {}, fastify.cache)
  const jwtRealm = new JwtRealm(fastify.userRepo, jwt)

  fastify.decorate('jwtAuth', jwt)
  fastify.decorate('jwtRealm', jwtRealm)
  fastify.decorateRequest('authUser', null as unknown as AuthenticatedUser)
  fastify.decorateRequest('tokenUID', '')

  // requireAuth is a preHandler that can be applied to any protected route:
  //   { preHandler: fastify.requireAuth, handler: ... }
  fastify.decorate(
    'requireAuth',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const token = extractBearerToken(request.headers['authorization'])
      if (!token) {
        return reply.code(401).send({ message: 'Authorization header with Bearer token required' })
      }

      try {
        const authUser = await jwtRealm.authenticate({
          type: CredentialType.JWT,
          token,
        })
        request.authUser = authUser
      } catch {
        return reply.code(401).send({ message: 'Unauthorized' })
      }
    }
  )
  fastify.decorate(
    'decodeAuth',
    async function (request: FastifyRequest, reply: FastifyReply) {
      const token = extractBearerToken(request.headers['authorization'])
      if (!token) {
        return reply.code(401).send({ message: 'Authorization header with Bearer token required' })
      }
      try {
        const verified = jwt.verifyOnly(token)
        request.tokenUID = verified.userID
      } catch {
        return reply.code(401).send({ message: 'Unauthorized' })
      }
    }
  )
}, {
  name: 'require-auth',
  dependencies: ['cache'],
})
