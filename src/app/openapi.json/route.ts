import { config } from "@/lib/config";
import { agentOpenApi } from "@/lib/openapi";
export function GET() {
  const env = config();
  return Response.json(agentOpenApi(env.APP_URL, env.APP_NAME));
}
