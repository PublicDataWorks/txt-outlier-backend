export const createMessageUrl = "https://public.missiveapp.com/v1/drafts";
export const headers = {
  "Content-Type": "application/json",
  "Authorization": `Bearer ${Deno.env.get("MISSIVE_SECRET")}`,
};

export default {
  createMessageUrl,
  headers,
} as const;
