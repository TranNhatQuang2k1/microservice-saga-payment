import type { FastifyInstance } from 'fastify'
import { loginSchema, logoutSchema, refreshSchema } from '../../schema/auth.schema'
import { createAuthControllers } from '../../controllers/auth/auth.controller'


export default async function authRoutes(fastify: FastifyInstance) {
  const { login, loginJwtEdDSA, refreshToken, logout } = createAuthControllers(fastify)

  fastify.post('/login', { schema: loginSchema }, login)
  fastify.post('/loginJwtEdDSA', { schema: loginSchema }, loginJwtEdDSA)
  fastify.post('/token/refresh', { schema: refreshSchema }, refreshToken)
  fastify.post('/logout', { schema: logoutSchema, preHandler: fastify.requireAuth }, logout)
}
