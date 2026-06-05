type GeolocConfidenceLabel = "High" | "Medium" | "Low" | "Not geolocated";
type PriorityLevel = "Critical" | "High" | "Moderate" | "Low";
type DependencyProbability = "High" | "Probable" | "Possible" | "Low" | "Unknown";
type ConfidenceLabel = "High" | "Medium" | "Low" | "Unknown";

type Site = {
  site_id: string;
  siren: string;
  siret: string;
  company_name: string;
  site_name: string;
  city: string;
  address_line: string;
  postal_code: string;
  is_icpe: boolean;
  is_geolocated: boolean;
  geo_score: number | null;
  geo_type: string | null;
  geoloc_confidence_label: GeolocConfidenceLabel;
  icpe_category: string | null;
  naf_code?: number | null;
  naf_label?: string | null;
  source_url?: string | null;
  grid_class: string | null;
  pressure_level?: string | null;
  aquifer_trend_level?: string | null;
  aquifer_trend_value_cm_20y?: number | null;
  aquifer_trend_mean_cm_20y?: number | null;
  nearest_station_distance_km?: number | null;
  station_count?: number | null;
  groundwater_signal_robust?: boolean | null;
  priority_level: PriorityLevel;
  dependency_probability: DependencyProbability;
  dependency_score_1_10?: number | null;
  is_water_relevant?: boolean | null;
  within_water_scope?: boolean | null;
  confidence_label: ConfidenceLabel;
  risk_explanation_short: string;
  score_version?: string | null;
  lat: number | null;
  lon: number | null;
};

type SearchResult =
  | {
      type: "company";
      siren: string;
      company_name: string;
      site_count: number;
      is_scorable: boolean;
    }
  | {
      type: "site";
      site_id: string;
      siret: string;
      site_name: string;
      company_name: string;
      city: string;
      is_icpe: boolean;
      is_geolocated: boolean;
    };

type Env = {
  APP_NAME?: string;
  APP_STAGE?: string;
  DB?: D1Database;
  [key: string]: string | D1Database | undefined;
};

const SEARCH_SHARD_COUNT = 8;
const SEARCH_SHARD_BINDINGS = Array.from({ length: SEARCH_SHARD_COUNT }, (_, idx) => `SEARCH_DB_${idx}`);

function getCoverageStats(env: Env) {
  const searchableActiveSirenFr =
    env.APP_STAGE === "sample_sharded" ? 15247062 : env.APP_STAGE === "sample" ? 1000000 : 89307;
  return {
    product_companies: 89307,
    product_sites_raw: 128863,
    product_sites_queryable: 114479,
    reference_active_siren_fr: 15265340,
    reference_active_siret_fr: 16949973,
    searchable_active_siren_fr: searchableActiveSirenFr,
    searchable_active_siret_fr: 114479,
    reference_label: "Sirene StockEtablissement active perimeter",
    reference_date: "2026-06-01",
  };
}

const SEARCH_STOPWORDS = new Set([
  "A",
  "AU",
  "AUX",
  "COMPAGNIE",
  "CO",
  "DE",
  "DEL",
  "DELA",
  "DES",
  "DU",
  "ET",
  "GROUPE",
  "HOLDING",
  "L",
  "LA",
  "LE",
  "LES",
  "SARL",
  "SAS",
  "SASU",
  "SA",
  "SCI",
  "SCOP",
  "SCEA",
  "SOCIETE",
  "STE",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const mockSites: Site[] = [
  {
    site_id: "site_sg_001",
    siren: "552039484",
    siret: "55203948400040",
    company_name: "COMPAGNIE DE SAINT-GOBAIN",
    site_name: "Saint-Gobain Tour CBX",
    city: "Courbevoie",
    address_line: "1 Terrasse Bellini",
    postal_code: "92400",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.96,
    geo_type: "housenumber",
    geoloc_confidence_label: "High",
    icpe_category: null,
    grid_class: "Faible pression + nappe non baissière",
    priority_level: "Low",
    dependency_probability: "Low",
    confidence_label: "High",
    risk_explanation_short:
      "Low signal — non-declining aquifer context and low nearby withdrawal pressure.",
    lat: 48.8942,
    lon: 2.2469,
  },
  {
    site_id: "site_sg_002",
    siren: "552039484",
    siret: "55203948400107",
    company_name: "COMPAGNIE DE SAINT-GOBAIN",
    site_name: "Saint-Gobain Vitrage France",
    city: "Salaise-sur-Sanne",
    address_line: "Zone industrielle portuaire",
    postal_code: "38150",
    is_icpe: true,
    is_geolocated: true,
    geo_score: 0.91,
    geo_type: "housenumber",
    geoloc_confidence_label: "High",
    icpe_category: "Santé, chimie, produits de synthèse",
    grid_class: "Forte pression + nappe en baisse",
    priority_level: "Critical",
    dependency_probability: "Probable",
    confidence_label: "High",
    risk_explanation_short:
      "Critical signal — declining aquifer and high local withdrawal pressure near an industrial site.",
    lat: 45.345,
    lon: 4.815,
  },
  {
    site_id: "site_sg_003",
    siren: "552039484",
    siret: "55203948400123",
    company_name: "COMPAGNIE DE SAINT-GOBAIN",
    site_name: "Saint-Gobain Distribution Bâtiment France",
    city: "Reims",
    address_line: "12 rue du Val Clair",
    postal_code: "51100",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.88,
    geo_type: "street",
    geoloc_confidence_label: "Medium",
    icpe_category: null,
    grid_class: "Faible pression + nappe en baisse",
    priority_level: "Moderate",
    dependency_probability: "Possible",
    confidence_label: "Medium",
    risk_explanation_short:
      "Moderate signal — declining aquifer context but lower local withdrawal pressure.",
    lat: 49.233,
    lon: 4.031,
  },
  {
    site_id: "site_teg_001",
    siren: "442395448",
    siret: "44239544800057",
    company_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    site_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE - Siège",
    city: "Paris",
    address_line: "2 B Rue Louis Armand",
    postal_code: "75015",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.64,
    geo_type: "housenumber",
    geoloc_confidence_label: "Low",
    icpe_category: null,
    grid_class: "Faible pression + nappe non baissière",
    priority_level: "Low",
    dependency_probability: "Unknown",
    confidence_label: "Low",
    risk_explanation_short:
      "Low signal — site recognized and mapped, but with low geolocation confidence.",
    lat: 48.8428,
    lon: 2.2822,
  },
  {
    site_id: "site_teg_002",
    siren: "442395448",
    siret: "44239544800065",
    company_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    site_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE - Saint-Herblain",
    city: "Saint-Herblain",
    address_line: "Le Solet 5 Impasse de l'Esperanto",
    postal_code: "44800",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.77,
    geo_type: "street",
    geoloc_confidence_label: "Medium",
    icpe_category: null,
    grid_class: "Faible pression + nappe non baissière",
    priority_level: "Low",
    dependency_probability: "Unknown",
    confidence_label: "Medium",
    risk_explanation_short:
      "Low signal — recognized site with medium geolocation confidence and no strong groundwater alert.",
    lat: 47.219,
    lon: -1.622,
  },
  {
    site_id: "site_teg_003",
    siren: "442395448",
    siret: "44239544800073",
    company_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    site_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE - Saint-Priest",
    city: "Saint-Priest",
    address_line: "117 Allée des Parcs",
    postal_code: "69800",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.86,
    geo_type: "housenumber",
    geoloc_confidence_label: "High",
    icpe_category: null,
    grid_class: "Faible pression + nappe en baisse",
    priority_level: "Moderate",
    dependency_probability: "Possible",
    confidence_label: "High",
    risk_explanation_short:
      "Moderate signal — declining aquifer context with mapped corporate site nearby.",
    lat: 45.697,
    lon: 4.942,
  },
  {
    site_id: "site_teg_004",
    siren: "442395448",
    siret: "44239544800099",
    company_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    site_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE - Béziers",
    city: "Béziers",
    address_line: "ZAC de Mazeran 74 Rue Lieutenant de Montcabrier",
    postal_code: "34500",
    is_icpe: false,
    is_geolocated: true,
    geo_score: 0.96,
    geo_type: "housenumber",
    geoloc_confidence_label: "High",
    icpe_category: null,
    grid_class: "Forte pression + nappe en baisse",
    priority_level: "High",
    dependency_probability: "Possible",
    confidence_label: "High",
    risk_explanation_short:
      "High signal — strong groundwater pressure and declining aquifer in the local screening cell.",
    lat: 43.334,
    lon: 3.246,
  },
];

const mockCompanies = [
  {
    siren: "552039484",
    company_name: "COMPAGNIE DE SAINT-GOBAIN",
    normalized_name: "COMPAGNIE DE SAINT GOBAIN",
    site_count: 3,
  },
  {
    siren: "442395448",
    company_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    normalized_name: "TOTALENERGIES ELECTRICITE ET GAZ FRANCE",
    site_count: 4,
  },
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function buildSearchName(value: string): string {
  const tokens = normalizeText(value)
    .split(/\s+/)
    .filter((token) => token && !SEARCH_STOPWORDS.has(token));
  return tokens.join(" ");
}

function normalizeDigits(value: string): string {
  return (value || "").replace(/\D+/g, "");
}

function extractSirenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/company\/(\d{9})$/);
  return match?.[1] ?? null;
}

function extractSiteIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/site\/([^/]+)$/);
  return match?.[1] ?? null;
}

function prioritySortValue(level: PriorityLevel): number {
  return { Critical: 0, High: 1, Moderate: 2, Low: 3 }[level];
}

function portfolioSummary(selectedSites: Site[]) {
  const countBy = (level: PriorityLevel) => selectedSites.filter((site) => site.priority_level === level).length;
  const critical = countBy("Critical");
  const high = countBy("High");
  const moderate = countBy("Moderate");
  const low = countBy("Low");

  return {
    site_count: selectedSites.length,
    mapped_site_count: selectedSites.filter((site) => site.is_geolocated).length,
    recognized_not_geolocated_count: selectedSites.filter((site) => !site.is_geolocated).length,
    not_found_count: 0,
    critical_count: critical,
    high_count: high,
    moderate_count: moderate,
    low_count: low,
    portfolio_priority_label: critical > 0 ? "Critical" : high > 0 ? "Elevated" : moderate > 0 ? "Moderate" : "Low",
  };
}

async function querySearchD1(
  env: Env,
  query: string,
  eligibleOnly = false,
): Promise<{
  results: SearchResult[];
  counts: {
    company_matches: number;
    site_matches: number;
    displayed_companies: number;
    displayed_sites: number;
  };
}> {
  const q = query.trim();
  const normalizedText = normalizeText(q);
  const searchName = buildSearchName(q) || normalizedText;
  const searchTokens = searchName.split(/\s+/).filter(Boolean).slice(0, 4);
  const prefix = `${normalizedText}%`;
  const digitsOnly = normalizeDigits(q);
  const hasDigits = digitsOnly.length > 0;
  const companySearch = eligibleOnly
    ? await queryEligibleCompaniesLayer(env, {
        normalizedText,
        searchName,
        searchTokens,
        digitsOnly,
        hasDigits,
        limitPerSource: 50,
      })
    : await queryCompaniesLayer(env, {
        normalizedText,
        searchName,
        searchTokens,
        digitsOnly,
        hasDigits,
        limitPerSource: 50,
      });
  const companyCount = companySearch.count;
  const companyPreviewLimit = companyCount > 50 ? 10 : 50;

  const siteTokenClauses = searchTokens.map((_, idx) => `(s.search_name LIKE ?${idx * 2 + 1} OR s.search_name LIKE ?${idx * 2 + 2})`);
  const tokenBindings = searchTokens.flatMap((token) => [`${token}%`, `% ${token}%`]);
  const siteTokenWhere = siteTokenClauses.length ? siteTokenClauses.join(" AND ") : "1=1";
  const siteWhere = hasDigits
    ? `
      (
        ${siteTokenWhere} OR
        UPPER(site_name) LIKE ?${tokenBindings.length + 1} OR
        UPPER(company_name) LIKE ?${tokenBindings.length + 1} OR
        UPPER(city) LIKE ?${tokenBindings.length + 1} OR
        siret LIKE ?${tokenBindings.length + 2} OR
        siren LIKE ?${tokenBindings.length + 2}
      )
    `
    : `
      (
        ${siteTokenWhere} OR
        UPPER(site_name) LIKE ?${tokenBindings.length + 1} OR
        UPPER(company_name) LIKE ?${tokenBindings.length + 1} OR
        UPPER(city) LIKE ?${tokenBindings.length + 1}
      )
    `;
  const siteOrder = hasDigits
    ? `
      CASE
        WHEN siret = ?${tokenBindings.length + 2} THEN 0
        WHEN siren = ?${tokenBindings.length + 2} THEN 1
        WHEN s.search_name = ?${tokenBindings.length + 3} THEN 2
        WHEN (${siteTokenWhere}) THEN 3
        WHEN UPPER(company_name) LIKE ?${tokenBindings.length + 5} THEN 4
        WHEN UPPER(site_name) LIKE ?${tokenBindings.length + 5} THEN 5
        ELSE 6
      END,
      is_icpe DESC,
      site_name ASC
    `
    : `
      CASE
        WHEN s.search_name = ?${tokenBindings.length + 2} THEN 0
        WHEN (${siteTokenWhere}) THEN 1
        WHEN UPPER(company_name) LIKE ?${tokenBindings.length + 4} THEN 2
        WHEN UPPER(site_name) LIKE ?${tokenBindings.length + 4} THEN 3
        WHEN UPPER(city) LIKE ?${tokenBindings.length + 4} THEN 4
        ELSE 5
      END,
      is_icpe DESC,
      site_name ASC
    `;
  const siteBindings = hasDigits
    ? [...tokenBindings, `%${normalizedText}%`, digitsOnly, searchName, `${searchName}%`, prefix]
    : [...tokenBindings, `%${normalizedText}%`, searchName, `${searchName}%`, prefix];
  const siteWhereBindings = hasDigits ? [...tokenBindings, `%${normalizedText}%`, digitsOnly] : [...tokenBindings, `%${normalizedText}%`];

  const siteCountRow = await env.DB!
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM sites s
        WHERE ${siteWhere}
      `,
    )
    .bind(...siteWhereBindings)
    .first<{ count: number | string }>();

  const siteCount = Number(siteCountRow?.count ?? 0);

  const sites = await env.DB!
    .prepare(
      `
        SELECT site_id, siret, site_name, company_name, city, is_icpe, is_geolocated
        FROM sites s
        WHERE ${siteWhere}
        ORDER BY ${siteOrder}
        LIMIT 10
      `,
    )
    .bind(...siteBindings)
    .all();

  const companySiteCounts = await getSiteCountsForSirens(
    env,
    companySearch.results.map((row) => row.siren),
  );
  const rankedCompanyRows = [...companySearch.results].sort((a, b) =>
    compareCompanyResults(
      a,
      b,
      { normalizedText, searchName, searchTokens, digitsOnly, hasDigits },
      companySiteCounts,
    ),
  );
  const companyResults = rankedCompanyRows.slice(0, companyPreviewLimit).map((row) => ({
    type: "company" as const,
    siren: row.siren,
    company_name: row.company_name,
    site_count: companySiteCounts.get(row.siren) ?? 0,
    is_scorable: (companySiteCounts.get(row.siren) ?? 0) > 0,
  }));
  const siteResults = ((sites.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
    type: "site" as const,
    site_id: String(row.site_id),
    siret: String(row.siret),
    site_name: String(row.site_name),
    company_name: String(row.company_name),
    city: String(row.city ?? ""),
    is_icpe: Boolean(Number(row.is_icpe ?? 0)),
    is_geolocated: Boolean(Number(row.is_geolocated ?? 0)),
  }));

  return {
    results: [...companyResults, ...siteResults],
    counts: {
      company_matches: companyCount,
      site_matches: siteCount,
      displayed_companies: companyResults.length,
      displayed_sites: siteResults.length,
    },
  };
}

function getSearchShardDbs(env: Env): D1Database[] {
  return SEARCH_SHARD_BINDINGS.map((binding) => env[binding]).filter(
    (value): value is D1Database => Boolean(value && typeof value === "object" && "prepare" in value),
  );
}

function getSirenShardBucket(siren: string): number {
  const digits = normalizeDigits(siren);
  if (!digits) return 0;
  const tail = digits.slice(-2);
  return Number(tail) % SEARCH_SHARD_COUNT;
}

function buildCompanySearchSql(searchTokens: string[], hasDigits: boolean) {
  const companyTokenClauses = searchTokens.map((_, idx) => `(c.search_name LIKE ?${idx * 2 + 1} OR c.search_name LIKE ?${idx * 2 + 2})`);
  const tokenBindings = searchTokens.flatMap((token) => [`${token}%`, `% ${token}%`]);
  const companyTokenWhere = companyTokenClauses.length ? companyTokenClauses.join(" AND ") : "1=1";
  const companyWhere = hasDigits
    ? `(${companyTokenWhere} OR c.siren LIKE ?${tokenBindings.length + 1})`
    : `(${companyTokenWhere})`;
  return { tokenBindings, companyTokenWhere, companyWhere };
}

async function queryCompaniesFromDb(
  db: D1Database,
  params: {
    normalizedText: string;
    searchName: string;
    searchTokens: string[];
    digitsOnly: string;
    hasDigits: boolean;
    limit: number;
    tableName?: "companies" | "companies_france";
  },
): Promise<{ count: number; results: Array<{ siren: string; company_name: string }> }> {
  const tableName = params.tableName ?? "companies_france";
  const { tokenBindings, companyTokenWhere, companyWhere } = buildCompanySearchSql(params.searchTokens, params.hasDigits);
  const companyBindings = params.hasDigits
    ? [...tokenBindings, params.digitsOnly, params.searchName, `${params.searchName}%`, `%${params.normalizedText}%`]
    : [...tokenBindings, params.searchName, `${params.searchName}%`, `%${params.normalizedText}%`];
  const companyWhereBindings = params.hasDigits ? [...tokenBindings, params.digitsOnly] : [...tokenBindings];
  const companyOrder = params.hasDigits
    ? `
      CASE
        WHEN c.siren = ?${tokenBindings.length + 1} THEN 0
        WHEN c.search_name = ?${tokenBindings.length + 2} THEN 1
        WHEN (${companyTokenWhere}) THEN 2
        WHEN c.normalized_name LIKE ?${tokenBindings.length + 4} THEN 3
        ELSE 4
      END,
      c.company_name ASC
    `
    : `
      CASE
        WHEN c.search_name = ?${tokenBindings.length + 1} THEN 0
        WHEN (${companyTokenWhere}) THEN 1
        WHEN c.normalized_name LIKE ?${tokenBindings.length + 3} THEN 2
        ELSE 3
      END,
      c.company_name ASC
    `;

  const companyCountRow = await db
    .prepare(
      `
        SELECT COUNT(*) AS count
        FROM (
          SELECT c.siren
          FROM ${tableName} c
          WHERE ${companyWhere}
          GROUP BY c.siren, c.company_name
        )
      `,
    )
    .bind(...companyWhereBindings)
    .first<{ count: number | string }>();

  const companies = await db
    .prepare(
      `
        SELECT c.siren, c.company_name
        FROM ${tableName} c
        WHERE ${companyWhere}
        GROUP BY c.siren, c.company_name
        ORDER BY ${companyOrder}
        LIMIT ?${companyBindings.length + 1}
      `,
    )
    .bind(...companyBindings, params.limit)
    .all();

  return {
    count: Number(companyCountRow?.count ?? 0),
    results: ((companies.results ?? []) as Array<Record<string, unknown>>).map((row) => ({
      siren: String(row.siren),
      company_name: String(row.company_name),
    })),
  };
}

function rankCompanyCandidate(
  candidate: { siren: string; company_name: string },
  params: {
    normalizedText: string;
    searchName: string;
    searchTokens: string[];
    digitsOnly: string;
    hasDigits: boolean;
  },
): number {
  const normalizedName = normalizeText(candidate.company_name);
  const candidateSearchName = buildSearchName(candidate.company_name) || normalizedName;
  if (params.hasDigits && candidate.siren === params.digitsOnly) return 0;
  if (candidateSearchName === params.searchName) return 1;
  const tokenMatch = params.searchTokens.every(
    (token) => candidateSearchName.startsWith(token) || candidateSearchName.includes(` ${token}`),
  );
  if (tokenMatch) return 2;
  if (normalizedName.includes(params.normalizedText)) return 3;
  return 4;
}

function compareCompanyResults(
  a: { siren: string; company_name: string },
  b: { siren: string; company_name: string },
  params: {
    normalizedText: string;
    searchName: string;
    searchTokens: string[];
    digitsOnly: string;
    hasDigits: boolean;
  },
  siteCounts: Map<string, number>,
): number {
  const rankDiff = rankCompanyCandidate(a, params) - rankCompanyCandidate(b, params);
  if (rankDiff !== 0) return rankDiff;

  const aSiteCount = siteCounts.get(a.siren) ?? 0;
  const bSiteCount = siteCounts.get(b.siren) ?? 0;
  if (aSiteCount !== bSiteCount) return bSiteCount - aSiteCount;

  const aSearchName = buildSearchName(a.company_name) || normalizeText(a.company_name);
  const bSearchName = buildSearchName(b.company_name) || normalizeText(b.company_name);
  const aStartsWithSearch = aSearchName.startsWith(params.searchName);
  const bStartsWithSearch = bSearchName.startsWith(params.searchName);
  if (aStartsWithSearch !== bStartsWithSearch) return aStartsWithSearch ? -1 : 1;

  const firstToken = params.searchTokens[0] ?? "";
  const aStartsWithFirstToken = firstToken ? aSearchName.startsWith(firstToken) : false;
  const bStartsWithFirstToken = firstToken ? bSearchName.startsWith(firstToken) : false;
  if (aStartsWithFirstToken !== bStartsWithFirstToken) return aStartsWithFirstToken ? -1 : 1;

  if (aSearchName.length !== bSearchName.length) return aSearchName.length - bSearchName.length;

  return a.company_name.localeCompare(b.company_name, "fr");
}

async function queryCompaniesLayer(
  env: Env,
  params: {
    normalizedText: string;
    searchName: string;
    searchTokens: string[];
    digitsOnly: string;
    hasDigits: boolean;
    limitPerSource: number;
  },
): Promise<{ count: number; results: Array<{ siren: string; company_name: string }> }> {
  const shardDbs = getSearchShardDbs(env);
  const sources = shardDbs.length > 0 ? shardDbs : env.DB ? [env.DB] : [];
  if (!sources.length) return { count: 0, results: [] };

  const shardResults = await Promise.all(
    sources.map((db) =>
      queryCompaniesFromDb(db, {
        ...params,
        limit: params.limitPerSource,
        tableName: "companies_france",
      }),
    ),
  );

  const totalCount = shardResults.reduce((sum, item) => sum + item.count, 0);
  const deduped = new Map<string, { siren: string; company_name: string }>();
  for (const shard of shardResults) {
    for (const candidate of shard.results) {
      if (!deduped.has(candidate.siren)) deduped.set(candidate.siren, candidate);
    }
  }

  const merged = Array.from(deduped.values()).sort((a, b) => {
    const rankDiff = rankCompanyCandidate(a, params) - rankCompanyCandidate(b, params);
    if (rankDiff !== 0) return rankDiff;
    return a.company_name.localeCompare(b.company_name, "fr");
  });

  return { count: totalCount, results: merged };
}

async function queryEligibleCompaniesLayer(
  env: Env,
  params: {
    normalizedText: string;
    searchName: string;
    searchTokens: string[];
    digitsOnly: string;
    hasDigits: boolean;
    limitPerSource: number;
  },
): Promise<{ count: number; results: Array<{ siren: string; company_name: string }> }> {
  if (!env.DB) return { count: 0, results: [] };
  return queryCompaniesFromDb(env.DB, {
    ...params,
    limit: params.limitPerSource,
    tableName: "companies",
  });
}

async function getSiteCountsForSirens(env: Env, sirens: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!env.DB || sirens.length === 0) return counts;
  const uniqueSirens = Array.from(new Set(sirens));
  const chunkSize = 90;

  for (let start = 0; start < uniqueSirens.length; start += chunkSize) {
    const chunk = uniqueSirens.slice(start, start + chunkSize);
    const placeholders = chunk.map((_, idx) => `?${idx + 1}`).join(", ");
    const rows = await env.DB
      .prepare(`SELECT siren, COUNT(*) AS site_count FROM sites WHERE siren IN (${placeholders}) GROUP BY siren`)
      .bind(...chunk)
      .all();

    for (const row of (rows.results ?? []) as Array<Record<string, unknown>>) {
      counts.set(String(row.siren), Number(row.site_count ?? 0));
    }
  }
  return counts;
}

async function getCompanyIdentity(
  env: Env,
  siren: string,
): Promise<{ siren: string; company_name: string } | null> {
  if (!env.DB) return null;
  const fromScoringDb = await env.DB
    .prepare(
      `
      SELECT company_name, siren FROM companies WHERE siren = ?1
      UNION
      SELECT company_name, siren FROM companies_france WHERE siren = ?1
      LIMIT 1
      `,
    )
    .bind(siren)
    .first<{ siren: string; company_name: string }>();
  if (fromScoringDb) return { siren: String(fromScoringDb.siren), company_name: String(fromScoringDb.company_name) };

  const shardDbs = getSearchShardDbs(env);
  if (!shardDbs.length) return null;
  const shardDb = shardDbs[getSirenShardBucket(siren)];
  if (!shardDb) return null;
  const fromShard = await shardDb
    .prepare(`SELECT siren, company_name FROM companies_france WHERE siren = ?1 LIMIT 1`)
    .bind(siren)
    .first<{ siren: string; company_name: string }>();
  if (!fromShard) return null;
  return { siren: String(fromShard.siren), company_name: String(fromShard.company_name) };
}

function mockSearch(query: string): {
  results: SearchResult[];
  counts: {
    company_matches: number;
    site_matches: number;
    displayed_companies: number;
    displayed_sites: number;
  };
} {
  const normalized = normalizeText(query);
  const searchName = buildSearchName(query) || normalized;
  const searchTokens = searchName.split(/\s+/).filter(Boolean);
  const digits = normalizeDigits(query);
  const allCompanyResults = mockCompanies
    .filter((company) => {
      const companySearchName = buildSearchName(company.company_name) || company.normalized_name;
      const tokenMatch = searchTokens.every(
        (token) =>
          companySearchName.startsWith(token) || companySearchName.includes(` ${token}`),
      );
      return tokenMatch || company.normalized_name.includes(normalized) || (digits && company.siren.startsWith(digits));
    })
    .map((company) => ({
      type: "company" as const,
      siren: company.siren,
      company_name: company.company_name,
      site_count: company.site_count,
      is_scorable: company.site_count > 0,
    }));
  const allSiteResults = mockSites
    .filter(
      (site) =>
        searchTokens.every((token) => {
          const siteSearchName = buildSearchName(site.company_name || site.site_name);
          return siteSearchName.startsWith(token) || siteSearchName.includes(` ${token}`);
        }) ||
        normalizeText(site.site_name).includes(normalized) ||
        normalizeText(site.company_name).includes(normalized) ||
        normalizeText(site.city).includes(normalized) ||
        (digits && (site.siren.startsWith(digits) || site.siret.startsWith(digits))),
    )
    .map((site) => ({
      type: "site" as const,
      site_id: site.site_id,
      siret: site.siret,
      site_name: site.site_name,
      company_name: site.company_name,
      city: site.city,
      is_icpe: site.is_icpe,
      is_geolocated: site.is_geolocated,
    }));
  const companyResults = allCompanyResults.slice(0, allCompanyResults.length > 50 ? 10 : 50);
  const siteResults = allSiteResults.slice(0, 10);
  return {
    results: [...companyResults, ...siteResults],
    counts: {
      company_matches: allCompanyResults.length,
      site_matches: allSiteResults.length,
      displayed_companies: companyResults.length,
      displayed_sites: siteResults.length,
    },
  };
}

async function getCompanySites(
  env: Env,
  siren: string,
  limit?: number,
): Promise<{ siren: string; company_name: string; total_site_count: number; sites: Site[] } | null> {
  if (env.DB) {
    const company = await getCompanyIdentity(env, siren);
    if (!company) return null;
    const totalCountRow = await env.DB
      .prepare(`SELECT COUNT(*) AS count FROM sites WHERE siren = ?1`)
      .bind(siren)
      .first<{ count: number | string }>();
    const resolvedLimit = Math.max(1, Math.min(limit ?? 50, 200));
    const rows = await env.DB.prepare(
      `
      SELECT
        s.site_id, s.siren, s.siret, s.company_name, s.site_name, s.city, s.address_line, s.postal_code,
        s.is_icpe, s.is_geolocated, s.geo_score, s.geo_type, s.geoloc_confidence_label, s.icpe_category,
        s.naf_code, s.naf_label, s.source_url,
        s.lat, s.lon,
        h.grid_class, h.pressure_level, h.aquifer_trend_level, h.aquifer_trend_value_cm_20y,
        h.aquifer_trend_mean_cm_20y, h.nearest_station_distance_km, h.station_count, h.groundwater_signal_robust,
        r.priority_level, r.dependency_probability, r.confidence_label, r.risk_explanation_short,
        r.dependency_score_1_10, r.is_water_relevant, r.within_water_scope, r.score_version
      FROM sites s
      LEFT JOIN site_hydro_context h ON h.site_id = s.site_id
      LEFT JOIN site_risk_scores r ON r.site_id = s.site_id
      WHERE s.siren = ?1
      ORDER BY
        CASE r.priority_level
          WHEN 'Critical' THEN 0
          WHEN 'High' THEN 1
          WHEN 'Moderate' THEN 2
          ELSE 3
        END,
        s.is_icpe DESC,
        s.site_name ASC
      LIMIT ?2
      `,
    )
      .bind(siren, resolvedLimit)
      .all();
    return {
      siren,
      company_name: String(company.company_name),
      total_site_count: Number(totalCountRow?.count ?? 0),
      sites: (rows.results ?? []) as unknown as Site[],
    };
  }
  const sites = mockSites.filter((site) => site.siren === siren);
  if (!sites.length) return null;
  const resolvedLimit = Math.max(1, Math.min(limit ?? 50, 200));
  return {
    siren,
    company_name: sites[0].company_name,
    total_site_count: sites.length,
    sites: sites.slice(0, resolvedLimit),
  };
}

async function getSiteDetail(env: Env, siteId: string): Promise<Site | null> {
  if (env.DB) {
    const row = await env.DB.prepare(
      `
      SELECT
        s.site_id, s.siren, s.siret, s.company_name, s.site_name, s.city, s.address_line, s.postal_code,
        s.is_icpe, s.is_geolocated, s.geo_score, s.geo_type, s.geoloc_confidence_label, s.icpe_category,
        s.naf_code, s.naf_label, s.source_url,
        s.lat, s.lon,
        h.grid_class, h.pressure_level, h.aquifer_trend_level, h.aquifer_trend_value_cm_20y,
        h.aquifer_trend_mean_cm_20y, h.nearest_station_distance_km, h.station_count, h.groundwater_signal_robust,
        r.priority_level, r.dependency_probability, r.confidence_label, r.risk_explanation_short,
        r.dependency_score_1_10, r.is_water_relevant, r.within_water_scope, r.score_version
      FROM sites s
      LEFT JOIN site_hydro_context h ON h.site_id = s.site_id
      LEFT JOIN site_risk_scores r ON r.site_id = s.site_id
      WHERE s.site_id = ?1
      `,
    )
      .bind(siteId)
      .first();
    return (row as Site | null) ?? null;
  }
  return mockSites.find((site) => site.site_id === siteId) ?? null;
}

async function resolveInputToSites(env: Env, input: { type: string; value: string }): Promise<Site[]> {
  const value = input.value.trim();
  if (!value) return [];

  if (env.DB) {
    if (input.type === "site_id") {
      const site = await getSiteDetail(env, value);
      return site ? [site] : [];
    }
    if (input.type === "siret") {
      const rows = await env.DB.prepare(
        `
        SELECT
          s.site_id, s.siren, s.siret, s.company_name, s.site_name, s.city, s.address_line, s.postal_code,
          s.is_icpe, s.is_geolocated, s.geo_score, s.geo_type, s.geoloc_confidence_label, s.icpe_category,
          s.naf_code, s.naf_label, s.source_url,
          s.lat, s.lon,
          h.grid_class, h.pressure_level, h.aquifer_trend_level, h.aquifer_trend_value_cm_20y,
          h.aquifer_trend_mean_cm_20y, h.nearest_station_distance_km, h.station_count, h.groundwater_signal_robust,
          r.priority_level, r.dependency_probability, r.confidence_label, r.risk_explanation_short,
          r.dependency_score_1_10, r.is_water_relevant, r.within_water_scope, r.score_version
        FROM sites s
        LEFT JOIN site_hydro_context h ON h.site_id = s.site_id
        LEFT JOIN site_risk_scores r ON r.site_id = s.site_id
        WHERE s.siret = ?1
        `,
      )
        .bind(normalizeDigits(value))
        .all();
      return (rows.results ?? []) as unknown as Site[];
    }
    if (input.type === "siren") {
      const company = await getCompanySites(env, normalizeDigits(value));
      return company?.sites ?? [];
    }
    if (input.type === "company_name") {
      const normalized = normalizeText(value);
      const searchName = buildSearchName(value) || normalized;
      const searchTokens = searchName.split(/\s+/).filter(Boolean).slice(0, 4);
      const companyMatches = await queryCompaniesLayer(env, {
        normalizedText: normalized,
        searchName,
        searchTokens,
        digitsOnly: normalizeDigits(value),
        hasDigits: false,
        limitPerSource: 5,
      });

      const sirens = companyMatches.results.map((row) => row.siren).filter(Boolean);

      if (sirens.length > 0) {
        const siteRows: Site[] = [];
        for (const siren of sirens) {
          const company = await getCompanySites(env, siren, 50);
          if (company) siteRows.push(...company.sites);
        }
        return siteRows;
      }

      const rows = await env.DB.prepare(
        `
          SELECT
            s.site_id, s.siren, s.siret, s.company_name, s.site_name, s.city, s.address_line, s.postal_code,
            s.is_icpe, s.is_geolocated, s.geo_score, s.geo_type, s.geoloc_confidence_label, s.icpe_category,
            s.naf_code, s.naf_label, s.source_url,
            s.lat, s.lon,
            h.grid_class, h.pressure_level, h.aquifer_trend_level, h.aquifer_trend_value_cm_20y,
            h.aquifer_trend_mean_cm_20y, h.nearest_station_distance_km, h.station_count, h.groundwater_signal_robust,
            r.priority_level, r.dependency_probability, r.confidence_label, r.risk_explanation_short,
            r.dependency_score_1_10, r.is_water_relevant, r.within_water_scope, r.score_version
          FROM sites s
          LEFT JOIN site_hydro_context h ON h.site_id = s.site_id
          LEFT JOIN site_risk_scores r ON r.site_id = s.site_id
          WHERE UPPER(s.company_name) LIKE ?1 OR UPPER(s.site_name) LIKE ?1
          ORDER BY s.is_icpe DESC, s.site_name ASC
          LIMIT 50
        `,
      )
        .bind(`%${normalized}%`)
        .all();
      return (rows.results ?? []) as unknown as Site[];
    }
    return [];
  }

  if (input.type === "site_id") return mockSites.filter((site) => site.site_id === value);
  if (input.type === "siret") return mockSites.filter((site) => site.siret === normalizeDigits(value));
  if (input.type === "siren") return mockSites.filter((site) => site.siren === normalizeDigits(value));
  if (input.type === "company_name") {
    const normalized = normalizeText(value);
    return mockSites.filter(
      (site) =>
        normalizeText(site.company_name).includes(normalized) || normalizeText(site.site_name).includes(normalized),
    );
  }
  return [];
}

export default {
  async fetch(request: Request, env: Env) {
    const coverage = getCoverageStats(env);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        ok: true,
        service: env.APP_NAME ?? "parallaxe-groundwater-risk-engine-api",
        stage: env.APP_STAGE ?? "mvp",
        storage: env.DB ? "d1" : "mock",
        coverage,
        endpoints: ["/health", "/search?q=", "/company/:siren", "/site/:id", "/portfolio/analyze"],
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: env.APP_NAME ?? "parallaxe-groundwater-risk-engine-api",
        stage: env.APP_STAGE ?? "mvp",
        storage: env.DB ? "d1" : "mock",
        coverage,
      });
    }

    if (request.method === "GET" && url.pathname === "/search") {
      const q = url.searchParams.get("q")?.trim() ?? "";
      const eligibleOnly = url.searchParams.get("eligible_only") === "1";
      if (!q) return json({ query: q, results: [] });
      const payload = env.DB ? await querySearchD1(env, q, eligibleOnly) : mockSearch(q);
      return json({ query: q, ...payload, coverage, storage: env.DB ? "d1" : "mock" });
    }

    if (request.method === "GET") {
      const siren = extractSirenFromPath(url.pathname);
      if (siren) {
        const requestedLimit = Number(url.searchParams.get("limit") ?? "50");
        const result = await getCompanySites(env, siren, requestedLimit);
        if (!result) return json({ error: "Company not found" }, 404);
        return json({ ...result, storage: env.DB ? "d1" : "mock" });
      }
    }

    if (request.method === "GET") {
      const siteId = extractSiteIdFromPath(url.pathname);
      if (siteId) {
        const result = await getSiteDetail(env, siteId);
        if (!result) return json({ error: "Site not found" }, 404);
        return json({ ...result, storage: env.DB ? "d1" : "mock" });
      }
    }

    if (request.method === "POST" && url.pathname === "/portfolio/analyze") {
      let body: { inputs?: Array<{ type: string; value: string }>; site_ids?: string[] };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }

      let selectedSites: Site[] = [];

      if (Array.isArray(body.site_ids) && body.site_ids.length > 0) {
        const siteDetails = await Promise.all(body.site_ids.map((siteId) => getSiteDetail(env, siteId)));
        selectedSites = siteDetails.filter(Boolean) as Site[];
      } else if (Array.isArray(body.inputs) && body.inputs.length > 0) {
        const resolved = await Promise.all(body.inputs.map((input) => resolveInputToSites(env, input)));
        selectedSites = resolved.flat();
      } else {
        return json({ error: "No site_ids or inputs provided" }, 400);
      }

      const dedupedSites = Array.from(new Map(selectedSites.map((site) => [site.site_id, site])).values()).sort(
        (a, b) => prioritySortValue(a.priority_level) - prioritySortValue(b.priority_level),
      );

      return json({
        portfolio_id: "demo_portfolio",
        storage: env.DB ? "d1" : "mock",
        summary: portfolioSummary(dedupedSites),
        sites: dedupedSites,
      });
    }

    return json({ error: "Not found" }, 404);
  },
};
