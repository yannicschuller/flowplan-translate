import { handle } from "@/lib/http";
import { exportRoute } from "@/lib/routes";

export const POST = (request: Request) => handle(() => exportRoute(request));
