import { handle } from "@/lib/http";
import { reviewRoute } from "@/lib/routes";

export const POST = async (request: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  return handle(() => reviewRoute(request, id, "reject"));
};
