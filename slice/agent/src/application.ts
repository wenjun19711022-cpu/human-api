import { z } from "zod";

/** What a merchant submits when applying to put a business on-chain. */
export const Application = z.object({
  business: z.object({
    name: z.string().min(1),
    category: z.string(),
    description: z.string().default(""),
    country: z.string(),
    city: z.string(),
    address: z.string().optional(),
    website: z.string().optional(),
    googleMapsUrl: z.string().optional(),
    instagram: z.string().optional(),
    links: z.array(z.string()).default([]),
  }),
  owner: z.object({
    fullName: z.string().min(1),
    role: z.string().default("owner"),
  }),
  registry: z.object({
    entityName: z.string(),
    jurisdiction: z.string().describe("OpenCorporates code, e.g. us_ca, gb, sg, jp"),
    registrationNumber: z.string().optional(),
  }),
  financials: z
    .object({
      claimedMonthlyRevenue: z.number().optional(),
      monthlyDeposits: z.array(z.object({ period: z.string(), amount: z.number() })).default([]),
      depositTransactions: z.array(z.number()).default([]),
    })
    .default({ monthlyDeposits: [], depositTransactions: [] }),
  offering: z.object({
    instrument: z.enum(["equity", "dividend_rights", "revenue_share"]),
    percentOffered: z.number(),
    targetRaise: z.number(),
    dividendPerPeriod: z.number(),
    periodDays: z.number(),
  }),
  documents: z
    .array(
      z.object({
        label: z.string(),
        mediaType: z.enum(["application/pdf", "image/png", "image/jpeg", "image/webp"]),
        data: z.string().describe("base64, no data: prefix"),
      }),
    )
    .default([]),
  reportLanguage: z.enum(["zh", "en"]).default("zh"),
});

export type Application = z.infer<typeof Application>;
