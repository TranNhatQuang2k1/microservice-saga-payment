export class ServiceError extends Error {
  readonly code?: string

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
  }
}
