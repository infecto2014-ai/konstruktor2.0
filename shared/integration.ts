import { z } from "zod";
export const initSchema = z
  .object({
    channel: z.literal("souvenir-constructor"),
    version: z.literal(1),
    type: z.literal("host:init"),
    payload: z
      .object({
        productId: z.string().max(64),
        colorId: z.string().max(64).optional(),
        size: z.string().max(16).optional(),
      })
      .strict(),
  })
  .strict();
export function trustedMessage(
  origin: string,
  source: unknown,
  parent: unknown,
  allowed: string[],
  data: unknown,
) {
  return (
    source === parent &&
    allowed.includes(origin) &&
    initSchema.safeParse(data).success
  );
}
