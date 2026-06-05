const PROD_API_BASE = "https://parallaxe-groundwater-risk-engine-api.edward-vizard.workers.dev";
const SAMPLE_API_BASE = "https://parallaxe-groundwater-risk-engine-api-sample.edward-vizard.workers.dev";
const SAMPLE_SHARDED_API_BASE =
  "https://parallaxe-groundwater-risk-engine-api-sample_sharded.edward-vizard.workers.dev";

const API_MODE = new URLSearchParams(window.location.search).get("api");
const API_BASE =
  API_MODE === "prod"
    ? PROD_API_BASE
    : API_MODE === "sample"
      ? SAMPLE_API_BASE
      : SAMPLE_SHARDED_API_BASE;

const PRIORITY_ORDER = {
  Critical: 0,
  High: 1,
  Elevated: 1,
  Moderate: 2,
  Low: 3,
  Unknown: 4,
};

const state = {
  searchResults: [],
  selectedSites: new Map(),
  latestAnalysis: null,
  coverage: null,
  currentQuery: "",
  eligibleOnly: false,
  isAnalyzing: false,
  expandedCompanies: new Set(),
  inputMode: "search",
  importType: "siret",
};

const els = {
  apiStatus: document.querySelector("#api-status"),
  apiHealthLink: document.querySelector(".meta-link"),
  searchForm: document.querySelector("#search-form"),
  searchInput: document.querySelector("#search-input"),
  searchMeta: document.querySelector("#search-meta"),
  searchResults: document.querySelector("#search-results"),
  eligibleOnly: document.querySelector("#eligible-only"),
  modeTabs: Array.from(document.querySelectorAll("[data-mode-tab]")),
  searchModePane: document.querySelector("#search-mode-pane"),
  importModePane: document.querySelector("#import-mode-pane"),
  importTypeButtons: Array.from(document.querySelectorAll("[data-import-type]")),
  importInput: document.querySelector("#import-input"),
  importFileInput: document.querySelector("#import-file-input"),
  importRun: document.querySelector("#import-run"),
  importMeta: document.querySelector("#import-meta"),
  coverageReferenceSiren: document.querySelector("#coverage-reference-siren"),
  coverageIcpeSites: document.querySelector("#coverage-icpe-sites"),
  coverageIcpeSitesScorable: document.querySelector("#coverage-icpe-sites-scorable"),
  coverageSearchableSiren: document.querySelector("#coverage-searchable-siren"),
  coverageNote: document.querySelector("#coverage-note"),
  selectionList: document.querySelector("#selection-list"),
  clearSelection: document.querySelector("#clear-selection"),
  summaryGrid: document.querySelector("#summary-grid"),
  siteDetail: document.querySelector("#site-detail"),
  exampleButtons: Array.from(document.querySelectorAll("[data-example]")),
  mapEmpty: document.querySelector("#portfolio-map-empty"),
};

let searchDebounce = null;
let map = null;
let portfolioLayer = null;
let lastMapCount = 0;

function setInputMode(mode) {
  state.inputMode = mode;
  for (const button of els.modeTabs) {
    button.classList.toggle("is-active", button.dataset.modeTab === mode);
  }
  els.searchModePane.classList.toggle("is-active", mode === "search");
  els.importModePane.classList.toggle("is-active", mode === "import");
}

function setImportType(type) {
  state.importType = type;
  for (const button of els.importTypeButtons) {
    button.classList.toggle("is-active", button.dataset.importType === type);
  }
  if (els.importInput) {
    els.importInput.placeholder =
      type === "siren"
        ? "Un identifiant par ligne\n312379076\n552100554"
        : "Un identifiant par ligne\n31237907600036\n55210055400013";
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatInteger(value) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return "—";
  return new Intl.NumberFormat("en-US").format(numeric);
}

function formatMaybeNumber(value, digits = 1) {
  if (value === null || value === undefined || value === "") return "n.d.";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return escapeHtml(value);
  return numeric.toFixed(digits);
}

function formatBool(value) {
  if (value === null || value === undefined) return "n.d.";
  return value ? "Oui" : "Non";
}

function normalizeIdentifier(value) {
  return String(value ?? "").replace(/\D+/g, "");
}

function parseImportIdentifiers(raw, type) {
  const expectedLength = type === "siren" ? 9 : 14;
  const tokens = String(raw ?? "")
    .split(/[\s,;|\t]+/g)
    .map(normalizeIdentifier)
    .filter(Boolean);
  const unique = [...new Set(tokens)];
  const valid = unique.filter((value) => value.length === expectedLength);
  const invalid = unique.filter((value) => value.length !== expectedLength);
  return { valid, invalid };
}

function priorityClass(level) {
  return {
    Critical: "priority-critical",
    High: "priority-high",
    Elevated: "priority-high",
    Moderate: "priority-moderate",
    Low: "priority-low",
  }[level] ?? "priority-low";
}

function translatePriority(level) {
  return {
    Critical: "Critique",
    High: "Élevé",
    Elevated: "Élevé",
    Moderate: "Modéré",
    Low: "Faible",
  }[level] ?? (level || "n.d.");
}

function translateDependency(value) {
  return {
    High: "Élevée",
    Probable: "Probable",
    Possible: "Possible",
    Low: "Faible",
    Unknown: "Inconnue",
  }[value] ?? (value || "n.d.");
}

function translateConfidence(value) {
  return {
    High: "Élevée",
    Medium: "Moyenne",
    Low: "Faible",
    Unknown: "Inconnue",
    "Not geolocated": "Non géolocalisé",
  }[value] ?? (value || "n.d.");
}

function translatePortfolioSignal(value) {
  return {
    Critical: "Critique",
    Elevated: "Élevé",
    High: "Élevé",
    Moderate: "Modéré",
    Low: "Faible",
  }[value] ?? (value || "n.d.");
}

function humanPressureLevel(value) {
  return {
    High: "Forte pression locale de prélèvement",
    Low: "Pression locale de prélèvement plus faible",
    Unknown: "Signal de pression indisponible",
  }[value] ?? (value || "n.d.");
}

function humanTrendLevel(value) {
  return {
    "Strong decline": "Forte baisse de nappe",
    "Moderate decline": "Baisse modérée de nappe",
    "Stable to slight rise": "Stabilité à légère hausse",
    "No data": "Aucune donnée de nappe",
  }[value] ?? (value || "n.d.");
}

function methodologyNote(site) {
  const parts = [];
  if (site.dependency_score_1_10 !== null && site.dependency_score_1_10 !== undefined) {
    parts.push(
      `Le score de dépendance ${formatMaybeNumber(site.dependency_score_1_10, 0)}/10 provient de la taxonomie NAF de l’activité du site.`,
    );
  }
  if (site.groundwater_signal_robust === false || site.groundwater_signal_robust === 0) {
    parts.push("Le signal nappe est moins robuste ici car il repose sur peu de stations proches.");
  } else if (site.groundwater_signal_robust) {
    parts.push("Le signal nappe est considéré comme robuste au vu du contexte local de suivi.");
  }
  if (site.geo_score !== null && site.geo_score !== undefined) {
    parts.push(
      `La confiance de géolocalisation repose sur les métadonnées de géocodage source (${site.geo_type || "n.d."}, score ${formatMaybeNumber(site.geo_score, 2)}).`,
    );
  }
  return parts.join(" ");
}

function isPreciseIdentifier(query) {
  const compact = String(query ?? "").replace(/\s+/g, "").trim();
  return /^\d{9}$/.test(compact) || /^\d{14}$/.test(compact);
}

function splitSearchResults(results) {
  const companies = [];
  const sites = [];
  for (const result of results ?? []) {
    if (result.type === "company") companies.push(result);
    else if (result.type === "site") sites.push(result);
  }
  return { companies, sites };
}

function highlightText(value, query) {
  const text = String(value ?? "");
  const tokens = String(query ?? "")
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((token) => token.length >= 2);

  let html = escapeHtml(text);
  for (const token of tokens) {
    const pattern = new RegExp(`(${escapeRegExp(token)})`, "gi");
    html = html.replace(pattern, "<mark>$1</mark>");
  }
  return html;
}

function sortSitesByPriority(a, b) {
  const priorityDelta = (PRIORITY_ORDER[a.priority_level] ?? 99) - (PRIORITY_ORDER[b.priority_level] ?? 99);
  if (priorityDelta !== 0) return priorityDelta;
  return String(a.site_name || "").localeCompare(String(b.site_name || ""), "fr", { sensitivity: "base" });
}

function extractLatLng(site) {
  const latCandidates = [site.latitude, site.lat, site.latitude_wgs84];
  const lonCandidates = [site.longitude, site.lon, site.longitude_wgs84];
  const lat = latCandidates.map(Number).find((value) => Number.isFinite(value));
  const lon = lonCandidates.map(Number).find((value) => Number.isFinite(value));
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return [lat, lon];
}

function priorityMarkerColor(level) {
  return {
    Critical: "#ad2e24",
    High: "#c46f11",
    Elevated: "#c46f11",
    Moderate: "#557321",
    Low: "#315d95",
  }[level] ?? "#315d95";
}

function createMapPopup(site) {
  return `
    <strong>${escapeHtml(site.site_name || "Site")}</strong><br>
    ${escapeHtml(site.company_name || "")}<br>
    ${escapeHtml(site.city || "Ville inconnue")}<br>
    ${escapeHtml(translatePriority(site.priority_level || "Low"))}
  `;
}

function getAnalyzedSites() {
  return state.latestAnalysis?.sites?.length
    ? [...state.latestAnalysis.sites].sort(sortSitesByPriority)
    : [...state.selectedSites.values()].sort(sortSitesByPriority);
}

function groupSitesByCompany(sites) {
  const groups = new Map();
  for (const site of sites) {
    const key = site.siren || site.company_name || site.site_id;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        siren: site.siren || "",
        companyName: site.company_name || "Entreprise inconnue",
        sites: [],
      });
    }
    groups.get(key).sites.push(site);
  }
  return [...groups.values()]
    .map((group) => {
      group.sites.sort(sortSitesByPriority);
      return group;
    })
    .sort((a, b) => {
      const aBest = PRIORITY_ORDER[a.sites[0]?.priority_level] ?? 99;
      const bBest = PRIORITY_ORDER[b.sites[0]?.priority_level] ?? 99;
      if (aBest !== bBest) return aBest - bBest;
      return a.companyName.localeCompare(b.companyName, "fr", { sensitivity: "base" });
    });
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json();
}

function ensureMap() {
  if (map || !window.L) return;
  map = window.L.map("portfolio-map", {
    center: [46.6, 2.2],
    zoom: 5.6,
    minZoom: 4,
    zoomSnap: 0.5,
  });

  window.L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    tileSize: 256,
    attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    maxZoom: 20,
  }).addTo(map);

  portfolioLayer = window.L.featureGroup().addTo(map);
}

function renderPortfolioMap() {
  ensureMap();
  if (!map || !portfolioLayer) return;

  portfolioLayer.clearLayers();
  const sites = getAnalyzedSites();
  const withCoords = sites.filter((site) => extractLatLng(site));

  els.mapEmpty.style.display = withCoords.length ? "none" : "flex";

  for (const site of withCoords) {
    const [lat, lon] = extractLatLng(site);
    const marker = window.L.circleMarker([lat, lon], {
      radius: 7,
      stroke: true,
      weight: 1.5,
      color: "#ffffff",
      fillColor: priorityMarkerColor(site.priority_level),
      fillOpacity: 0.9,
    });
    marker.bindPopup(createMapPopup(site));
    marker.on("click", () => renderDetail(site));
    portfolioLayer.addLayer(marker);
  }

  if (withCoords.length) {
    const bounds = portfolioLayer.getBounds();
    if (bounds.isValid() && (lastMapCount === 0 || lastMapCount !== withCoords.length)) {
      map.fitBounds(bounds.pad(0.15), { maxZoom: 11 });
    }
  }
  lastMapCount = withCoords.length;
}

async function checkHealth() {
  try {
    const payload = await request("/health");
    state.coverage = payload.coverage ?? null;
    els.apiStatus.textContent = `API ${payload.storage?.toUpperCase?.() ?? "OK"}`;
    els.apiStatus.style.background = "var(--accent-soft)";
    els.apiStatus.style.color = "var(--accent)";
    if (els.apiHealthLink) els.apiHealthLink.href = `${API_BASE}/health`;
    renderCoverage();
  } catch {
    els.apiStatus.textContent = "API indisponible";
    els.apiStatus.style.background = "#fff2f0";
    els.apiStatus.style.color = "#ad2e24";
    renderCoverage();
  }
}

function renderCoverage() {
  const coverage = state.coverage;
  if (!coverage) {
    els.coverageReferenceSiren.textContent = "—";
    els.coverageIcpeSites.textContent = "—";
    els.coverageIcpeSitesScorable.textContent = "—";
    els.coverageSearchableSiren.textContent = "— recherchables aujourd’hui";
    els.coverageNote.textContent = "Les références de couverture apparaîtront dès que l’API sera joignable.";
    return;
  }

  const searchable = coverage.searchable_active_siren_fr ?? coverage.product_companies;
  els.coverageReferenceSiren.textContent = formatInteger(coverage.reference_active_siren_fr);
  els.coverageIcpeSites.textContent = formatInteger(101609);
  els.coverageIcpeSitesScorable.textContent = formatInteger(93435);
  els.coverageSearchableSiren.textContent = `${formatInteger(searchable)} recherchables aujourd’hui`;
  const share =
    searchable && coverage.reference_active_siren_fr
      ? Math.round((searchable / coverage.reference_active_siren_fr) * 1000) / 10
      : null;
  els.coverageNote.textContent = `Le moteur recherche aujourd’hui dans ${formatInteger(
    searchable,
  )} entreprises France actives (${share ?? "n.d."}%). Le scoring MVP porte sur les sites ICPE. Sur les ${formatInteger(
    101609,
  )} sites ICPE en France intégrés au pipeline source, ${formatInteger(
    93435,
  )} sont aujourd’hui retenus comme pertinents pour une analyse groundwater. Source : ${coverage.reference_label}, ${coverage.reference_date}.`;
}

function renderSearchResults() {
  if (!state.searchResults.length) {
    els.searchResults.className = "result-list empty-state";
    if (!state.currentQuery) {
      els.searchResults.textContent = "Tape au moins 2 caractères pour lancer la recherche en direct.";
    } else if (state.currentQuery.length < 2) {
      els.searchResults.textContent = "Continue à taper — la recherche en direct démarre à partir de 2 caractères.";
    } else {
      els.searchResults.textContent = "Aucune entreprise correspondante trouvée dans l’index France actuellement chargé.";
    }
    return;
  }

  const { companies, sites } = splitSearchResults(state.searchResults);
  const showSites = companies.length === 0 || isPreciseIdentifier(state.currentQuery);
  const visibleResults = showSites ? sites : companies;

  if (!visibleResults.length) {
    els.searchResults.className = "result-list empty-state";
    els.searchResults.textContent = showSites
      ? "Aucun établissement correspondant trouvé."
      : "Aucune entreprise correspondante pour l’instant — essaie d’ajouter une ville, un SIREN ou un SIRET.";
    return;
  }

  els.searchResults.className = "result-list";
  els.searchResults.innerHTML = visibleResults
    .map((result) => {
      if (result.type === "company") {
        const isScorable = Boolean(result.is_scorable);
        const siteCountLabel = `${escapeHtml(result.site_count)} établissement${Number(result.site_count) > 1 ? "s" : ""} éligible${Number(result.site_count) > 1 ? "s" : " "}`.trim();
        return `
          <article class="result-card">
            <div class="result-card-head">
              <div>
                <p class="eyebrow">Entreprise</p>
                <h3>${highlightText(result.company_name, state.currentQuery)}</h3>
                <p class="mono">${escapeHtml(result.siren)}</p>
              </div>
              <div class="inline-actions">
                <button type="button" class="${isScorable ? "" : "is-disabled"}" data-action="add-company" data-siren="${escapeHtml(result.siren)}" ${isScorable ? "" : "disabled aria-disabled=\"true\""}>Ajouter les sites</button>
                <button class="ghost-button" type="button" data-action="inspect-company" data-siren="${escapeHtml(result.siren)}">Voir</button>
              </div>
            </div>
            <div class="badge-row">
              <span class="badge ${isScorable ? "badge-eligible" : "badge-ineligible"}">${isScorable ? "Éligible au scoring" : "Non éligible au scoring"}</span>
              <span class="badge">${siteCountLabel}</span>
            </div>
          </article>
        `;
      }

      return `
        <article class="result-card">
          <div class="result-card-head">
            <div>
              <p class="eyebrow">Établissement</p>
              <h3>${highlightText(result.site_name, state.currentQuery)}</h3>
              <p>${highlightText(result.company_name, state.currentQuery)}</p>
            </div>
            <div class="inline-actions">
              <button type="button" data-action="add-site" data-site-id="${escapeHtml(result.site_id)}">Ajouter le site</button>
              <button class="ghost-button" type="button" data-action="inspect-site" data-site-id="${escapeHtml(result.site_id)}">Voir</button>
            </div>
          </div>
          <div class="badge-row">
            <span class="badge mono">${escapeHtml(result.siret)}</span>
            <span class="badge">${escapeHtml(result.city || "Ville inconnue")}</span>
            <span class="badge">${result.is_icpe ? "ICPE" : "Non-ICPE"}</span>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderSummary() {
  const summary = state.latestAnalysis?.summary;
  if (!summary && !state.isAnalyzing) {
    els.summaryGrid.className = "summary-grid empty-state";
    els.summaryGrid.textContent = "Ajoute une première entreprise pour voir le signal portefeuille se construire.";
    return;
  }

  const analyzedSites = state.latestAnalysis?.sites ?? [...state.selectedSites.values()];
  const companyCount = new Set(analyzedSites.map((site) => site.siren).filter(Boolean)).size;

  const items = state.isAnalyzing && !summary
    ? [
        ["Signal portefeuille", "Calcul..."],
        ["Sites analysés", formatInteger(state.selectedSites.size)],
        ["Entreprises analysées", formatInteger(companyCount)],
        ["Sites critiques", "Calcul..."],
      ]
    : [
        ["Signal portefeuille", translatePortfolioSignal(summary?.portfolio_priority_label)],
        ["Sites analysés", formatInteger(summary?.site_count ?? analyzedSites.length)],
        ["Entreprises analysées", formatInteger(companyCount)],
        ["Sites critiques", formatInteger(summary?.critical_count ?? 0)],
      ];

  els.summaryGrid.className = "summary-grid";
  els.summaryGrid.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="summary-card">
          <div class="summary-label">${escapeHtml(label)}</div>
          <div class="summary-value">${escapeHtml(value)}</div>
        </div>
      `,
    )
    .join("");
}

function renderPortfolioList() {
  const sites = getAnalyzedSites();
  if (!sites.length) {
    els.selectionList.className = "scroll-pane portfolio-pane selection-list empty-state";
    els.selectionList.textContent = "Ajoute des sites depuis les résultats de recherche pour construire le portefeuille en direct.";
    return;
  }

  const groups = groupSitesByCompany(sites);
  const companyCount = groups.length;
  const label = state.isAnalyzing ? "Recalcul en cours..." : "Signal mis à jour en direct.";
  els.selectionList.className = "scroll-pane portfolio-pane selection-list";
  els.selectionList.innerHTML = groups
    .map((group) => {
      const bestPriority = group.sites[0]?.priority_level ?? "Low";
      const isExpanded = state.expandedCompanies.has(group.key);
      return `
        <article class="portfolio-group">
          <div class="portfolio-group-head">
            <div class="portfolio-group-title-wrap">
              <button class="toggle-button" type="button" data-action="toggle-company" data-company-key="${escapeHtml(group.key)}">
                <span class="toggle-chevron">${isExpanded ? "▾" : "▸"}</span>
                <span>${escapeHtml(group.companyName)}</span>
              </button>
              <p>${formatInteger(group.sites.length)} site${group.sites.length > 1 ? "s" : ""} dans le portefeuille</p>
            </div>
            <div class="inline-actions">
              <span class="priority-pill ${priorityClass(bestPriority)}">${escapeHtml(translatePriority(bestPriority))}</span>
              <button class="ghost-button" type="button" data-action="remove-company" data-siren="${escapeHtml(group.siren)}">Supprimer l’entreprise</button>
            </div>
          </div>
          <div class="portfolio-group-sites ${isExpanded ? "" : "is-collapsed"}">
            ${group.sites
              .map(
                (site) => `
                  <div class="portfolio-site-row">
                    <div class="portfolio-site-main">
                      <div class="portfolio-site-title">${escapeHtml(site.site_name)}</div>
                      <div class="badge-row">
                        <span class="badge mono">${escapeHtml(site.siret || "Pas de SIRET")}</span>
                        <span class="badge">${escapeHtml(site.city || "Ville inconnue")}</span>
                        <span class="badge">${site.is_icpe ? "ICPE" : "Non-ICPE"}</span>
                        <span class="badge">${escapeHtml(translatePriority(site.priority_level || "Low"))}</span>
                      </div>
                    </div>
                    <div class="portfolio-site-actions">
                      <button class="ghost-button" type="button" data-action="inspect-site-inline" data-site-id="${escapeHtml(site.site_id)}">Voir</button>
                      <button class="icon-button" type="button" data-action="remove-site" data-site-id="${escapeHtml(site.site_id)}" aria-label="Supprimer ce site de l’analyse">×</button>
                    </div>
                  </div>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");

  const headHtml = `
    <div class="portfolio-pane-head">
      <div>
        <div class="section-eyebrow">Portefeuille courant</div>
        <p class="portfolio-pane-meta">${formatInteger(sites.length)} site${sites.length > 1 ? "s" : ""} réparti${sites.length > 1 ? "s" : ""} sur ${formatInteger(companyCount)} entreprise${companyCount > 1 ? "s" : ""}. ${escapeHtml(label)}</p>
      </div>
    </div>
  `;
  els.selectionList.innerHTML = `${headHtml}<div class="portfolio-groups">${els.selectionList.innerHTML}</div>`;
}

function renderDetail(site) {
  if (!site) {
    els.siteDetail.className = "detail-card empty-state";
    els.siteDetail.textContent = "Sélectionne un site depuis la recherche, la carte ou le portefeuille pour consulter sa fiche.";
    return;
  }

  els.siteDetail.className = "detail-card";
  els.siteDetail.innerHTML = `
    <div class="result-card-head">
      <div>
        <p class="eyebrow">Détail du site</p>
        <h3>${escapeHtml(site.site_name)}</h3>
        <p>${escapeHtml(site.company_name)}</p>
      </div>
      <span class="priority-pill ${priorityClass(site.priority_level || "Low")}">${escapeHtml(translatePriority(site.priority_level || "Low"))}</span>
    </div>
    <div class="badge-row">
      <span class="badge mono">${escapeHtml(site.siret || "Pas de SIRET")}</span>
      <span class="badge">${escapeHtml(site.city || "Ville inconnue")}</span>
      <span class="badge">${site.is_icpe ? "ICPE" : "Non-ICPE"}</span>
      <span class="badge">${escapeHtml(translateConfidence(site.geoloc_confidence_label || "Unknown"))}</span>
    </div>
    <div class="detail-grid">
      <div class="detail-item">
        <div class="detail-item-label">Adresse</div>
        <div class="detail-item-value">${escapeHtml(site.address_line || "Non disponible")}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Classe de maille</div>
        <div class="detail-item-value">${escapeHtml(site.grid_class || "Pas de classe de maille robuste")}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Dépendance à l’eau</div>
        <div class="detail-item-value">${escapeHtml(translateDependency(site.dependency_probability || "Unknown"))}</div>
      </div>
      <div class="detail-item">
        <div class="detail-item-label">Confiance globale</div>
        <div class="detail-item-value">${escapeHtml(translateConfidence(site.confidence_label || "Unknown"))}</div>
      </div>
    </div>
    <p style="margin-top: 14px;">${escapeHtml(site.risk_explanation_short || "Aucune explication disponible pour le moment.")}</p>
    <div class="detail-methodology">
      <div class="detail-item-label">Comment ce signal est construit</div>
      <p class="detail-methodology-note">${escapeHtml(methodologyNote(site) || "Ce signal site combine dépendance sectorielle, contexte local de nappe et confiance des données.")}</p>
      <div class="methodology-grid">
        <div class="detail-item">
          <div class="detail-item-label">Activité NAF</div>
          <div class="detail-item-value">${escapeHtml(
            site.naf_code ? `${site.naf_code} — ${site.naf_label || "n.d."}` : site.naf_label || "n.d.",
          )}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Catégorie ICPE eau</div>
          <div class="detail-item-value">${escapeHtml(site.icpe_category || "n.d.")}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Score de dépendance (1–10)</div>
          <div class="detail-item-value">${formatMaybeNumber(site.dependency_score_1_10, 0)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Secteur marqué comme pertinent pour l’eau</div>
          <div class="detail-item-value">${formatBool(site.is_water_relevant)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Dans le périmètre eau</div>
          <div class="detail-item-value">${formatBool(site.within_water_scope)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Méthode de géolocalisation</div>
          <div class="detail-item-value">${escapeHtml(`${site.geo_type || "n.d."} (score ${formatMaybeNumber(site.geo_score, 2)})`)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Tendance de nappe</div>
          <div class="detail-item-value">${escapeHtml(
            `${humanTrendLevel(site.aquifer_trend_level)} (${formatMaybeNumber(site.aquifer_trend_value_cm_20y, 0)} cm / 20y)`,
          )}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Niveau de pression</div>
          <div class="detail-item-value">${escapeHtml(humanPressureLevel(site.pressure_level))}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Stations proches</div>
          <div class="detail-item-value">${escapeHtml(`${formatMaybeNumber(site.station_count, 0)} dans un rayon de 20 km`)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Station la plus proche</div>
          <div class="detail-item-value">${escapeHtml(`${formatMaybeNumber(site.nearest_station_distance_km, 1)} km`)}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Robustesse du signal nappe</div>
          <div class="detail-item-value">${escapeHtml(site.groundwater_signal_robust ? "Signal local robuste" : "Signal local limité")}</div>
        </div>
        <div class="detail-item">
          <div class="detail-item-label">Version du score</div>
          <div class="detail-item-value">${escapeHtml(site.score_version || "n.d.")}</div>
        </div>
      </div>
    </div>
  `;
}

async function runSearch(query, { silent = false } = {}) {
  state.currentQuery = query;
  if (!silent) els.searchMeta.textContent = "Recherche en cours...";
  try {
    const payload = await request(
      `/search?q=${encodeURIComponent(query)}${state.eligibleOnly ? "&eligible_only=1" : ""}`,
    );
    state.searchResults = payload.results ?? [];
    state.coverage = payload.coverage ?? state.coverage;
    const counts = payload.counts ?? {};
    const precise = isPreciseIdentifier(query);
    const eligibleOnly = state.eligibleOnly;

    if (!silent) {
      if (precise && (counts.site_matches ?? 0) > 0) {
        els.searchMeta.textContent = `${formatInteger(counts.site_matches ?? 0)} établissement${(counts.site_matches ?? 0) > 1 ? "s" : ""} correspondant${(counts.site_matches ?? 0) > 1 ? "s" : ""} pour « ${query} ».`;
      } else if ((counts.company_matches ?? 0) === 0 && (counts.site_matches ?? 0) > 0) {
        els.searchMeta.textContent = `${formatInteger(counts.site_matches ?? 0)} établissements correspondants pour « ${query} ». Ajoute un nom d’entreprise, une ville, un SIREN ou un SIRET si besoin.`;
      } else if ((counts.company_matches ?? 0) > 50) {
        els.searchMeta.textContent = `${formatInteger(counts.company_matches ?? 0)} résultat${(counts.company_matches ?? 0) > 1 ? "s" : ""} ${eligibleOnly ? "d’entreprise éligible" : "d’entreprise"} pour « ${query} ». Ajoute des caractères, une ville, un SIREN ou un SIRET pour affiner la recherche. Affichage de ${formatInteger(counts.displayed_companies ?? 0)}.`.replace("  ", " ");
      } else if ((counts.company_matches ?? 0) > 0) {
        els.searchMeta.textContent = `${formatInteger(counts.company_matches ?? 0)} entreprise${(counts.company_matches ?? 0) > 1 ? "s" : ""} ${eligibleOnly ? "éligible " : ""}trouvée${(counts.company_matches ?? 0) > 1 ? "s" : ""} pour « ${query} ».`;
      } else {
        els.searchMeta.textContent = `Aucun résultat ${eligibleOnly ? "d’entreprise éligible" : "entreprise"} pour « ${query} ». Essaie un nom plus précis, une ville, un SIREN ou un SIRET.`;
      }
    }

    renderCoverage();
    renderSearchResults();
  } catch (error) {
    state.searchResults = [];
    els.searchMeta.textContent = error.message;
    renderCoverage();
    renderSearchResults();
  }
}

function renderPortfolio() {
  renderSummary();
  renderPortfolioList();
  renderPortfolioMap();
}

async function syncPortfolioAnalysis({ focusSiteId = null } = {}) {
  const siteIds = Array.from(state.selectedSites.keys());
  if (!siteIds.length) {
    state.isAnalyzing = false;
    state.latestAnalysis = null;
    renderPortfolio();
    renderDetail(null);
    return;
  }

  state.isAnalyzing = true;
  renderPortfolio();

  try {
    const payload = await request("/portfolio/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ site_ids: siteIds }),
    });
    state.latestAnalysis = payload;
    if (focusSiteId) {
      const focusSite = payload.sites?.find((site) => site.site_id === focusSiteId);
      if (focusSite) renderDetail(focusSite);
    }
  } catch (error) {
    els.selectionMeta.textContent = error.message;
  } finally {
    state.isAnalyzing = false;
    renderPortfolio();
  }
}

async function addCompanySites(siren) {
  const payload = await request(`/company/${encodeURIComponent(siren)}?limit=25`);
  if (!(payload.sites ?? []).length) {
    els.searchMeta.textContent = "Entreprise reconnue, mais aucun établissement éligible au score n’est disponible pour le moment.";
    return;
  }
  for (const site of payload.sites ?? []) state.selectedSites.set(site.site_id, site);
  await syncPortfolioAnalysis({ focusSiteId: payload.sites?.[0]?.site_id ?? null });
}

async function addImportedSirens(sirens) {
  let addedSiteCount = 0;
  let matchedCompanyCount = 0;
  const missing = [];

  for (const siren of sirens) {
    try {
      const payload = await request(`/company/${encodeURIComponent(siren)}?limit=25`);
      if (!(payload.sites ?? []).length) {
        missing.push(siren);
        continue;
      }
      matchedCompanyCount += 1;
      for (const site of payload.sites ?? []) {
        const before = state.selectedSites.size;
        state.selectedSites.set(site.site_id, site);
        if (state.selectedSites.size > before) addedSiteCount += 1;
      }
    } catch {
      missing.push(siren);
    }
  }

  return { addedSiteCount, matchedCompanyCount, missing };
}

async function addImportedSirets(sirets) {
  let addedSiteCount = 0;
  let matchedSiteCount = 0;
  const missing = [];

  for (const siret of sirets) {
    try {
      const payload = await request(`/search?q=${encodeURIComponent(siret)}`);
      const exactSite = (payload.results ?? []).find(
        (result) => result.type === "site" && normalizeIdentifier(result.siret) === siret,
      );
      if (!exactSite?.site_id) {
        missing.push(siret);
        continue;
      }
      const site = await request(`/site/${encodeURIComponent(exactSite.site_id)}`);
      matchedSiteCount += 1;
      const before = state.selectedSites.size;
      state.selectedSites.set(site.site_id, site);
      if (state.selectedSites.size > before) addedSiteCount += 1;
    } catch {
      missing.push(siret);
    }
  }

  return { addedSiteCount, matchedSiteCount, missing };
}

async function runImport() {
  const { valid, invalid } = parseImportIdentifiers(els.importInput.value, state.importType);
  if (!valid.length) {
    els.importMeta.textContent = `Aucun ${state.importType.toUpperCase()} valide détecté.`;
    return;
  }

  els.importMeta.textContent = `Import de ${formatInteger(valid.length)} ${state.importType.toUpperCase()} en cours...`;
  els.importRun.disabled = true;

  try {
    const result =
      state.importType === "siren" ? await addImportedSirens(valid) : await addImportedSirets(valid);

    const notFoundCount = result.missing.length;
    const invalidCount = invalid.length;
    if (state.selectedSites.size) {
      await syncPortfolioAnalysis();
    } else {
      renderPortfolio();
    }

    const matchedLabel =
      state.importType === "siren"
        ? `${formatInteger(result.matchedCompanyCount)} entreprise${result.matchedCompanyCount > 1 ? "s" : ""} reconnue${result.matchedCompanyCount > 1 ? "s" : ""}`
        : `${formatInteger(result.matchedSiteCount)} site${result.matchedSiteCount > 1 ? "s" : ""} reconnu${result.matchedSiteCount > 1 ? "s" : ""}`;

    const parts = [
      `${matchedLabel}`,
      `${formatInteger(result.addedSiteCount)} site${result.addedSiteCount > 1 ? "s" : ""} ajouté${result.addedSiteCount > 1 ? "s" : ""} au portefeuille`,
    ];
    if (notFoundCount) parts.push(`${formatInteger(notFoundCount)} non trouvé${notFoundCount > 1 ? "s" : ""}`);
    if (invalidCount) parts.push(`${formatInteger(invalidCount)} invalide${invalidCount > 1 ? "s" : ""}`);
    els.importMeta.textContent = parts.join(" · ");
  } finally {
    els.importRun.disabled = false;
  }
}

async function addSingleSite(siteId) {
  const site = await request(`/site/${encodeURIComponent(siteId)}`);
  state.selectedSites.set(site.site_id, site);
  renderDetail(site);
  await syncPortfolioAnalysis({ focusSiteId: site.site_id });
}

function removeCompanySites(siren) {
  for (const [siteId, site] of state.selectedSites.entries()) {
    if (site.siren === siren) state.selectedSites.delete(siteId);
  }
  if (siren) state.expandedCompanies.delete(siren);
}

async function inspectCompany(siren) {
  const payload = await request(`/company/${encodeURIComponent(siren)}?limit=10`);
  if ((payload.sites ?? [])[0]) {
    renderDetail(payload.sites[0]);
  } else {
    els.searchMeta.textContent = "Entreprise reconnue, mais aucun établissement éligible au score n’est disponible pour le moment.";
  }
}

async function inspectSite(siteId) {
  const localSite = state.latestAnalysis?.sites?.find((site) => site.site_id === siteId) ?? state.selectedSites.get(siteId);
  if (localSite?.address_line || localSite?.risk_explanation_short) {
    renderDetail(localSite);
    return;
  }
  const site = await request(`/site/${encodeURIComponent(siteId)}`);
  renderDetail(site);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action], [data-example]");
  if (!target) return;

  if (target.dataset.example) {
    els.searchInput.value = target.dataset.example;
    await runSearch(target.dataset.example);
    return;
  }

  const action = target.dataset.action;
  try {
    if (action === "add-company") {
      await addCompanySites(target.dataset.siren);
    } else if (action === "inspect-company") {
      await inspectCompany(target.dataset.siren);
    } else if (action === "add-site") {
      await addSingleSite(target.dataset.siteId);
    } else if (action === "inspect-site" || action === "inspect-site-inline") {
      await inspectSite(target.dataset.siteId);
    } else if (action === "remove-site") {
      state.selectedSites.delete(target.dataset.siteId);
      await syncPortfolioAnalysis();
    } else if (action === "remove-company") {
      removeCompanySites(target.dataset.siren);
      await syncPortfolioAnalysis();
    } else if (action === "toggle-company") {
      const key = target.dataset.companyKey;
      if (state.expandedCompanies.has(key)) state.expandedCompanies.delete(key);
      else state.expandedCompanies.add(key);
      renderPortfolioList();
    }
  } catch (error) {
    renderDetail({
      site_name: "Action impossible",
      company_name: "",
      priority_level: "Low",
      risk_explanation_short: error.message,
      geoloc_confidence_label: "Unknown",
      confidence_label: "Unknown",
      dependency_probability: "Unknown",
      address_line: "",
      city: "",
      siret: "",
      is_icpe: false,
      grid_class: "",
    });
  }
});

els.searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const query = els.searchInput.value.trim();
  if (!query) return;
  await runSearch(query);
});

els.searchInput.addEventListener("input", () => {
  const query = els.searchInput.value.trim();
  state.currentQuery = query;

  if (searchDebounce) clearTimeout(searchDebounce);

  if (query.length === 0) {
    state.searchResults = [];
    els.searchMeta.textContent = "Pas encore de recherche.";
    renderSearchResults();
    return;
  }

  if (query.length < 2) {
    state.searchResults = [];
    els.searchMeta.textContent = "Tape au moins 2 caractères pour lancer la recherche en direct.";
    renderSearchResults();
    return;
  }

  searchDebounce = setTimeout(() => {
    runSearch(query, { silent: false });
  }, 180);
});

els.eligibleOnly?.addEventListener("change", () => {
  state.eligibleOnly = Boolean(els.eligibleOnly.checked);
  const query = els.searchInput.value.trim();
  if (!query) {
    els.searchMeta.textContent = "Pas encore de recherche.";
    state.searchResults = [];
    renderSearchResults();
    return;
  }
  if (query.length < 2) {
    renderSearchResults();
    return;
  }
  runSearch(query);
});

for (const button of els.modeTabs) {
  button.addEventListener("click", () => setInputMode(button.dataset.modeTab));
}

for (const button of els.importTypeButtons) {
  button.addEventListener("click", () => setImportType(button.dataset.importType));
}

els.importFileInput?.addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const text = await file.text();
  els.importInput.value = text;
  els.importMeta.textContent = `${file.name} chargé. Vérifie le type d’identifiant puis lance l’ajout.`;
  event.target.value = "";
});

els.importRun?.addEventListener("click", runImport);

els.clearSelection.addEventListener("click", async () => {
  state.selectedSites.clear();
  state.latestAnalysis = null;
  state.expandedCompanies.clear();
  await syncPortfolioAnalysis();
});

checkHealth();
setInputMode("search");
setImportType("siret");
renderSearchResults();
renderPortfolio();
renderDetail(null);
