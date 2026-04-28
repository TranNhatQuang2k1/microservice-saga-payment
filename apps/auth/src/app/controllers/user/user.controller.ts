import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ServiceError } from '../../services/erorrs/errors'
import { CreateUserData, CreateUserService, GetUserService } from '../../services/user/user.service'


export function createUserControllers(fastify: FastifyInstance) {
  const registerService = new CreateUserService({ userRepo: fastify.userRepo })
  const getUserService  = new GetUserService({ userRepo: fastify.userRepo, cache: fastify.cache })

  const register = async (
    request: FastifyRequest<{ Body: CreateUserData }>,
    reply: FastifyReply,
  ) => {
    try {
      const user = await registerService.run(request.body)
      return reply.code(201).send({
        status: 'success',
        message: 'User created successfully',
        data: { user },
      })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(409).send({ status: 'error', message: err.message })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  const getProfile = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const uid  = request.authUser.user.uid
      const user = await getUserService.run(uid)
      return reply.code(200).send({ status: 'success', data: { user } })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(404).send({ status: 'error', message: err.message })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  const getTokenProfile = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => {
    try {
      const user = await getUserService.run(request.tokenUID)
      return reply.code(200).send({ status: 'success', data: { user } })
    } catch (err) {
      if (err instanceof ServiceError) {
        return reply.code(404).send({ status: 'error', message: err.message })
      }
      fastify.log.error(err)
      return reply.code(500).send({ status: 'error', message: 'Service temporarily unavailable' })
    }
  }

  return { register, getProfile, getTokenProfile }
}
