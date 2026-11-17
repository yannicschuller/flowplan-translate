import { handle } from "@/lib/http";
import { badgeRoute } from "@/lib/routes";

export const dynamic = "force-dynamic";
// Public, cacheable, no cookies: README badges (lib/badge.ts).
export const GET = (request: Request) => handle(() => badgeRoute(request));
