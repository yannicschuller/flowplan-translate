// Links within a component's list, keeping filter, search and page. Client-safe.
export type ListState = { filter: string; q: string; page: number };

export function listHref(componentId: string, lang: string, state: Partial<ListState>, entryId?: number) {
  const params = new URLSearchParams();
  if (state.filter && state.filter !== "missing") params.set("filter", state.filter);
  if (state.q) params.set("q", state.q);
  if (state.page && state.page > 1) params.set("page", String(state.page));
  const query = params.toString();
  return `/c/${encodeURIComponent(componentId)}/${lang}${entryId ? `/${entryId}` : ""}${query ? `?${query}` : ""}`;
}
