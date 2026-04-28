import type { FastifyInstance } from 'fastify'
import { loginSchema, refreshSchema } from '../../schema/auth.schema'
import { createAuthControllers } from '../../controllers/auth/auth.controller'

export default async function authRoutes(fastify: FastifyInstance) {
  const { login, refreshToken, logout } = createAuthControllers(fastify)

  fastify.post('/login', { schema: loginSchema }, login)
  fastify.post('/token/refresh', { schema: refreshSchema }, refreshToken)
  fastify.post('/logout', { preHandler: fastify.requireAuth }, logout)
}
