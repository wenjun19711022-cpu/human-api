/**
 * Google Maps presence check via the Places API (New) Text Search.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 * Without GOOGLE_MAPS_API_KEY the tool tells the model to fall back to web search.
 */

const FIELDS = [
  "places.displayName",
  "places.formattedAddress",
  "places.rating",
  "places.userRatingCount",
  "places.businessStatus",
  "places.googleMapsUri",
  "places.websiteUri",
  "places.primaryType",
  "places.nationalPhoneNumber",
  "places.regularOpeningHours.weekdayDescriptions",
].join(",");

interface PlacesResponse {
  places?: Array<{
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    userRatingCount?: number;
    businessStatus?: string;
    googleMapsUri?: string;
    websiteUri?: string;
    primaryType?: string;
    nationalPhoneNumber?: string;
    regularOpeningHours?: { weekdayDescriptions?: string[] };
  }>;
}

export async function googlePlacesLookup(query: string): Promise<unknown> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    return {
      error: "GOOGLE_MAPS_API_KEY is not configured on this server.",
      fallback: "Use web_search for the business name + city + 'Google reviews', and web_fetch its Maps or Yelp page.",
    };
  }
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": FIELDS,
    },
    body: JSON.stringify({ textQuery: query, pageSize: 3 }),
  });
  if (!res.ok) return { error: `Places API ${res.status}: ${(await res.text()).slice(0, 300)}` };
  const data = (await res.json()) as PlacesResponse;
  return {
    results: (data.places ?? []).map((p) => ({
      name: p.displayName?.text,
      address: p.formattedAddress,
      rating: p.rating ?? null,
      reviewCount: p.userRatingCount ?? null,
      status: p.businessStatus ?? null,
      type: p.primaryType ?? null,
      phone: p.nationalPhoneNumber ?? null,
      website: p.websiteUri ?? null,
      mapsUrl: p.googleMapsUri ?? null,
      hours: p.regularOpeningHours?.weekdayDescriptions ?? null,
    })),
  };
}
