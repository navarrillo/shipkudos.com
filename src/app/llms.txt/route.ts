import { config } from "@/lib/config";
export function GET() {
  const e = config();
  return new Response(
    `# ${e.APP_NAME}\n\nPublic GitHub activity, verified identities and agent-assisted registration.\n\n- Agent guide: ${e.APP_URL}/agents.md\n- API specification: ${e.APP_URL}/openapi.json\n- Methodology: ${e.APP_URL}/methodology\n`,
    { headers: { "Content-Type": "text/plain; charset=utf-8" } },
  );
}
