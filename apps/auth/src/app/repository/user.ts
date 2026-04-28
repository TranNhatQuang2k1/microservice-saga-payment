export class ErrUserNotFound extends Error {
  constructor() {
    super('user not found')
    this.name = 'ErrUserNotFound'
  }
}
