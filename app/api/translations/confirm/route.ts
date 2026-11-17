import { handle } from "@/lib/http";
import { confirmRoute } from "@/lib/routes";

export const POST = (request: Request) => handle(() => confirmRoute(request));
