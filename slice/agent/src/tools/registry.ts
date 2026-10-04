/**
 * Company-registry lookup via OpenCorporates (covers 140+ jurisdictions).
 * https://api.opencorporates.com/documentation/API-Reference
 * Without OPENCORPORATES_API_TOKEN the tool points the model at the official registry for the jurisdiction.
 */

const OFFICIAL_REGISTRIES: Record<string, string> = {
  us_ca: "https://bizfileonline.sos.ca.gov/search/business",
  us_ny: "https://apps.dos.ny.gov/publicInquiry/",
  us_tx: "https://mycpa.cpa.state.tx.us/coa/",
  us_de: "https://icis.corp.delaware.gov/ecorp/entitysearch/namesearch.aspx",
  gb: "https://find-and-update.company-information.service.gov.uk/",
  sg: "https://www.bizfile.gov.sg/",
  jp: "https://www.houjin-bangou.nta.go.jp/",
  hk: "https://www.icris.cr.gov.hk/",
  ae_du: "https://www.dubaided.gov.ae/",
  au: "https://abr.business.gov.au/",
  cn: "https://www.gsxt.gov.cn/",
};

interface OCSearch {
  results?: {
    companies?: Array<{
      company: {
        name: string;
        company_number: string;
        jurisdiction_code: string;
        current_status: string | null;
        incorporation_date: string | null;
        dissolution_date: string | null;
        company_type: string | null;
        registered_address_in_full: string | null;
        opencorporates_url: string;
        officers?: Array<{ officer: { name: string; position: string; end_date: string | null } }>;
      };
    }>;
  };
}

export async function businessRegistrySearch(name: string, jurisdiction: string): Promise<unknown> {
  const code = jurisdiction.toLowerCase();
  const token = process.env.OPENCORPORATES_API_TOKEN;
  if (!token) {
    return {
      error: "OPENCORPORATES_API_TOKEN is not configured on this server.",
      fallback: "Search the official registry with web_search / web_fetch.",
      officialRegistry: OFFICIAL_REGISTRIES[code] ?? null,
    };
  }
  const url = new URL("https://api.opencorporates.com/v0.4/companies/search");
  url.searchParams.set("q", name);
  if (code) url.searchParams.set("jurisdiction_code", code);
  url.searchParams.set("api_token", token);
  const res = await fetch(url);
  if (!res.ok) return { error: `OpenCorporates ${res.status}` };
  const data = (await res.json()) as OCSearch;
  return {
    results: (data.results?.companies ?? []).slice(0, 5).map(({ company: c }) => ({
      name: c.name,
      number: c.company_number,
      jurisdiction: c.jurisdiction_code,
      status: c.current_status,
      incorporated: c.incorporation_date,
      dissolved: c.dissolution_date,
      type: c.company_type,
      address: c.registered_address_in_full,
      url: c.opencorporates_url,
      officers: (c.officers ?? []).map((o) => ({
        name: o.officer.name,
        position: o.officer.position,
        ended: o.officer.end_date,
      })),
    })),
    officialRegistry: OFFICIAL_REGISTRIES[code] ?? null,
  };
}
