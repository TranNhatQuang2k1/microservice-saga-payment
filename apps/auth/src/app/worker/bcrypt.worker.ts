// file: path/to/bcrypt.worker.ts
import * as bcrypt from '@node-rs/bcrypt'

export function compareWorker(data: { plain: string; hash: string }): boolean {
  // Dùng Sync để vắt kiệt 100% CPU của luồng độc lập này
  return bcrypt.compareSync(data.plain, data.hash)
}

export function hashWorker(data: { plain: string; rounds: number }): string {
  return bcrypt.hashSync(data.plain, data.rounds)
}