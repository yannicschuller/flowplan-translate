import { handle } from "@/lib/http";
import { syncRoute } from "@/lib/routes";

export const POST = (request: Request) => handle(() => syncRoute(request));
