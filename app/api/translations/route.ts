import { handle } from "@/lib/http";
import { saveRoute } from "@/lib/routes";

export const POST = (request: Request) => handle(() => saveRoute(request));
