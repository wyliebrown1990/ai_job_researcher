// Local city lookup backed by the MIT-licensed countries-states-cities dataset.
// The dataset stays on this machine; the browser receives only its current matches.

import { getCountries, getStates, searchCity } from "@anrivera/countries-states-cities-database";
import type { City, Country, State } from "@anrivera/countries-states-cities-database";

export type LocationOption = {
  id: number;
  label: string;
  city: string;
  region: string;
  regionCode: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
};

const countriesByCode = new Map<string, Country>();
const statesById = new Map<number, State>();
const locationsByLabel = new Map<string, LocationOption>();

function initializeReferenceData(): void {
  if (countriesByCode.size) return;
  for (const country of getCountries()) countriesByCode.set(country.iso2, country);
  for (const state of getStates()) statesById.set(state.id, state);
}

function optionFor(city: City & { countryIso2: string }): LocationOption | null {
  initializeReferenceData();
  const state = statesById.get(city.stateId);
  const country = countriesByCode.get(city.countryIso2);
  if (!country) return null;
  const region = state?.name ?? country.name;
  const regionCode = state?.stateCode ?? country.iso2;
  const option = {
    id: city.id,
    label: `${city.name}, ${regionCode}, ${country.name}`,
    city: city.name,
    region,
    regionCode,
    country: country.name,
    countryCode: country.iso2,
    latitude: Number(city.latitude),
    longitude: Number(city.longitude),
  };
  locationsByLabel.set(option.label, option);
  return option;
}

function priority(option: LocationOption, query: string): number {
  const city = option.city.toLowerCase();
  const exact = city === query ? 0 : city.startsWith(query) ? 1 : 2;
  const capital = countriesByCode.get(option.countryCode)?.capital.toLowerCase() === city ? 0 : 1;
  const preferredMarket = ["US", "CA", "GB", "IE", "AU", "SG"].includes(option.countryCode) ? 0 : 1;
  return exact * 100 + capital * 10 + preferredMarket;
}

/** Return a small, deterministic list for the type-ahead picker. */
export function searchLocations(query: string, limit = 12): LocationOption[] {
  const terms = query.trim().replace(/\s+/g, " ").toLowerCase().split(",").map((term) => term.trim()).filter(Boolean);
  const [term, ...qualifiers] = terms;
  if (!term || term.length < 2) return [];
  return searchCity(term)
    .map(optionFor)
    .filter((option): option is LocationOption => Boolean(option))
    .filter((option) => qualifiers.every((qualifier) => {
      const countryAliases = option.countryCode === "GB" ? ["uk", "united kingdom"]
        : option.countryCode === "US" ? ["us", "usa", "united states"]
        : [option.countryCode.toLowerCase(), option.country.toLowerCase()];
      return `${option.label} ${option.region}`.toLowerCase().includes(qualifier) || countryAliases.includes(qualifier);
    }))
    .sort((a, b) => priority(a, term) - priority(b, term) || a.label.localeCompare(b.label))
    .slice(0, limit);
}

/** Resolve and re-emit the canonical label; unknown strings are rejected. */
export function canonicalLocationLabel(label: string): string | null {
  const cleaned = label.trim().replace(/\s+/g, " ");
  const cached = locationsByLabel.get(cleaned);
  if (cached) return cached.label;
  const city = cleaned.split(",", 1)[0]?.trim();
  if (!city) return null;
  return searchLocations(city, 100).find((option) => option.label === cleaned)?.label ?? null;
}

/** Migrate the small hand-authored list that existed before local city search. */
export function migrateLegacyLocation(label: string): string {
  const aliases: Record<string, string> = {
    "new york": "New York City, NY, United States",
    "new york, ny": "New York City, NY, United States",
  };
  const canonical = canonicalLocationLabel(label);
  if (canonical) return canonical;
  const alias = aliases[label.trim().toLowerCase()];
  return alias && canonicalLocationLabel(alias) ? alias : label;
}

function cityVariants(city: string): string[] {
  const normalized = city.toLowerCase();
  return [normalized, normalized.replace(/\s+city$/, "")].filter(Boolean);
}

/** Match canonical selection metadata against the inconsistent labels supplied by ATS boards. */
export function matchesSelectedLocation(jobLocation: string, selectedLabel: string): boolean {
  const option = locationsByLabel.get(selectedLabel)
    ?? (canonicalLocationLabel(selectedLabel) ? locationsByLabel.get(selectedLabel) : undefined);
  if (!option) return jobLocation.toLowerCase().includes(selectedLabel.toLowerCase());
  const job = jobLocation.toLowerCase();
  if (!cityVariants(option.city).some((city) => job.includes(city))) return false;
  const countryAliases = option.countryCode === "GB" ? ["gb", "uk", "united kingdom"]
    : option.countryCode === "US" ? ["us", "usa", "united states"]
    : [option.countryCode.toLowerCase(), option.country.toLowerCase()];
  return [option.regionCode.toLowerCase(), option.region.toLowerCase(), ...countryAliases]
    .some((qualifier) => qualifier.length > 1 && job.includes(qualifier));
}
