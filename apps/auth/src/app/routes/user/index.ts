import type { FastifyInstance } from 'fastify'
import { registerSchema } from '../../schema/auth.schema'
import { createUserControllers } from '../../controllers/user/user.controller'

export default async function userRoutes(fastify: FastifyInstance) {
  const { register, getProfile, getTokenProfile } = createUserControllers(fastify)

  fastify.post('/register', { schema: registerSchema }, register)
  fastify.get('/me', { preHandler: fastify.requireAuth }, getProfile)
  fastify.get('/profile', { preHandler: fastify.decodeAuth }, getTokenProfile)
}
