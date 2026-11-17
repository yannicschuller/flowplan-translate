import { handle } from "@/lib/http";
import { glossaryRoute } from "@/lib/routes";

export const POST = (request: Request) => handle(() => glossaryRoute(request));
