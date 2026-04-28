export interface User {
  uid: string
  firstName: string
  lastName: string
  email: string
  password: string
}

export interface UserRepository {
  findUserByEmail(email: string): Promise<User>
  findUserByID(id: string): Promise<User>
  // Thêm hàm này: Omit để bỏ qua uid vì DB sẽ tự generate
  createUser(data: Omit<User, 'uid'>): Promise<User>
}
