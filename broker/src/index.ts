import { handle, type BrokerEnv } from './facebook-oauth'

export default {
  fetch(request: Request, env: BrokerEnv) { return handle(request, env) }
}
