import { agentGuide } from "@/lib/agent-guide";
export function GET() {
  return new Response(agentGuide(), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public,max-age=300",
    },
  });
}
