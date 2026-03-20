import { Elysia } from 'elysia'

const app = new Elysia()
  .get('/health', () => ({ ok: true }))
  .listen(7705)

console.log('cqueue server running on port 7705')
