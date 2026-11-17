import { handle } from "@/lib/http";
import { webhookRoute } from "@/lib/routes";

// Checked by its signature instead of the Origin (it comes from GitHub).
export const POST = (request: Request) => handle(() => webhookRoute(request));
