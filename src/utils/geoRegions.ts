/**
 * Geographic Regions, Continents, and Hotspot Definitions for Camera & Event Director
 */

export interface GeoRegionDef {
  id: string;
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
  centerLat: number;
  centerLon: number;
}

export interface GeoContinentDef {
  code: string;
  name: string;
  centerLat: number;
  centerLon: number;
  defaultDistance: number;
}

export interface CountryMeta {
  name: string;
  iso?: string;
  lat: number;
  lon: number;
  minLat?: number;
  maxLat?: number;
  minLon?: number;
  maxLon?: number;
  continent?: string;
}

export const CONTINENTS: GeoContinentDef[] = [
  { code: 'AF', name: 'Africa', centerLat: 2.0, centerLon: 20.0, defaultDistance: 270 },
  { code: 'AS', name: 'Asia', centerLat: 35.0, centerLon: 95.0, defaultDistance: 290 },
  { code: 'EU', name: 'Europe', centerLat: 50.0, centerLon: 15.0, defaultDistance: 240 },
  { code: 'NA', name: 'North America', centerLat: 40.0, centerLon: -100.0, defaultDistance: 280 },
  { code: 'SA', name: 'South America', centerLat: -15.0, centerLon: -60.0, defaultDistance: 270 },
  { code: 'OC', name: 'Oceania', centerLat: -25.0, centerLon: 135.0, defaultDistance: 260 },
  { code: 'AQ', name: 'Antarctica', centerLat: -80.0, centerLon: 0.0, defaultDistance: 260 }
];

export const REGIONS: GeoRegionDef[] = [
  {
    id: 'mediterranean',
    name: 'Mediterranean Basin',
    minLat: 28,
    maxLat: 46,
    minLon: -6,
    maxLon: 36,
    centerLat: 36.0,
    centerLon: 18.0
  },
  {
    id: 'middle_east',
    name: 'Middle East',
    minLat: 12,
    maxLat: 42,
    minLon: 34,
    maxLon: 62,
    centerLat: 29.0,
    centerLon: 45.0
  },
  {
    id: 'congo',
    name: 'Congo Basin',
    minLat: -12,
    maxLat: 6,
    minLon: 10,
    maxLon: 32,
    centerLat: -1.0,
    centerLon: 23.0
  },
  {
    id: 'southeast_asia',
    name: 'Southeast Asia',
    minLat: -10,
    maxLat: 25,
    minLon: 95,
    maxLon: 142,
    centerLat: 5.0,
    centerLon: 110.0
  },
  {
    id: 'caribbean',
    name: 'Caribbean & Gulf',
    minLat: 10,
    maxLat: 32,
    minLon: -98,
    maxLon: -58,
    centerLat: 18.0,
    centerLon: -75.0
  },
  {
    id: 'great_plains',
    name: 'Great Plains',
    minLat: 28,
    maxLat: 50,
    minLon: -106,
    maxLon: -88,
    centerLat: 38.0,
    centerLon: -98.0
  },
  {
    id: 'pampas',
    name: 'South American Pampas',
    minLat: -38,
    maxLat: -18,
    minLon: -68,
    maxLon: -52,
    centerLat: -28.0,
    centerLon: -60.0
  },
  {
    id: 'maracaibo',
    name: 'Catatumbo Hotspot',
    minLat: 8.5,
    maxLat: 11.5,
    minLon: -72.5,
    maxLon: -70.5,
    centerLat: 9.8,
    centerLon: -71.5
  },
  {
    id: 'central_europe',
    name: 'Central & Western Europe',
    minLat: 42,
    maxLat: 58,
    minLon: -5,
    maxLon: 25,
    centerLat: 49.0,
    centerLon: 10.0
  }
];

export const POPULAR_COUNTRIES: CountryMeta[] = [
  { name: 'Turkey', iso: 'TR', lat: 39.0, lon: 35.0, minLat: 35.8, maxLat: 42.1, minLon: 25.6, maxLon: 44.8, continent: 'EU' },
  { name: 'United States', iso: 'US', lat: 38.0, lon: -97.0, minLat: 24.5, maxLat: 49.4, minLon: -125.0, maxLon: -66.9, continent: 'NA' },
  { name: 'Argentina', iso: 'AR', lat: -34.0, lon: -64.0, minLat: -55.0, maxLat: -21.8, minLon: -73.6, maxLon: -53.6, continent: 'SA' },
  { name: 'Brazil', iso: 'BR', lat: -10.0, lon: -53.0, minLat: -33.7, maxLat: 5.3, minLon: -73.9, maxLon: -34.8, continent: 'SA' },
  { name: 'DR Congo', iso: 'CD', lat: -2.5, lon: 23.5, minLat: -13.5, maxLat: 5.4, minLon: 12.2, maxLon: 31.3, continent: 'AF' },
  { name: 'Japan', iso: 'JP', lat: 36.0, lon: 138.0, minLat: 30.0, maxLat: 45.5, minLon: 128.0, maxLon: 146.0, continent: 'AS' },
  { name: 'Australia', iso: 'AU', lat: -25.0, lon: 134.0, minLat: -43.6, maxLat: -10.0, minLon: 113.0, maxLon: 153.6, continent: 'OC' },
  { name: 'India', iso: 'IN', lat: 21.0, lon: 78.0, minLat: 8.0, maxLat: 35.5, minLon: 68.0, maxLon: 97.4, continent: 'AS' },
  { name: 'Indonesia', iso: 'ID', lat: -2.0, lon: 118.0, minLat: -11.0, maxLat: 6.0, minLon: 95.0, maxLon: 141.0, continent: 'AS' },
  { name: 'Mexico', iso: 'MX', lat: 23.0, lon: -102.0, minLat: 14.5, maxLat: 32.7, minLon: -117.1, maxLon: -86.7, continent: 'NA' },
  { name: 'Germany', iso: 'DE', lat: 51.0, lon: 10.0, minLat: 47.3, maxLat: 55.0, minLon: 5.9, maxLon: 15.0, continent: 'EU' },
  { name: 'France', iso: 'FR', lat: 46.5, lon: 2.5, minLat: 41.3, maxLat: 51.1, minLon: -4.8, maxLon: 9.6, continent: 'EU' },
  { name: 'Italy', iso: 'IT', lat: 42.5, lon: 12.5, minLat: 36.6, maxLat: 47.1, minLon: 6.6, maxLon: 18.5, continent: 'EU' },
  { name: 'Spain', iso: 'ES', lat: 40.0, lon: -3.5, minLat: 36.0, maxLat: 43.8, minLon: -9.3, maxLon: 3.3, continent: 'EU' },
  { name: 'Greece', iso: 'GR', lat: 39.0, lon: 22.0, minLat: 34.8, maxLat: 41.7, minLon: 19.3, maxLon: 29.6, continent: 'EU' },
  { name: 'Colombia', iso: 'CO', lat: 4.0, lon: -73.0, minLat: -4.2, maxLat: 12.5, minLon: -79.0, maxLon: -67.0, continent: 'SA' },
  { name: 'Venezuela', iso: 'VE', lat: 7.0, lon: -66.0, minLat: 0.6, maxLat: 12.2, minLon: -73.4, maxLon: -59.8, continent: 'SA' },
  { name: 'China', iso: 'CN', lat: 35.0, lon: 103.0, minLat: 18.0, maxLat: 53.5, minLon: 73.5, maxLon: 135.0, continent: 'AS' },
  { name: 'Russia', iso: 'RU', lat: 60.0, lon: 95.0, minLat: 41.2, maxLat: 81.8, minLon: 19.6, maxLon: 180.0, continent: 'EU' },
  { name: 'South Africa', iso: 'ZA', lat: -29.0, lon: 24.0, minLat: -34.8, maxLat: -22.1, minLon: 16.5, maxLon: 32.9, continent: 'AF' },
  { name: 'United Kingdom', iso: 'GB', lat: 54.0, lon: -2.0, minLat: 49.8, maxLat: 59.0, minLon: -8.2, maxLon: 1.8, continent: 'EU' },
  { name: 'Canada', iso: 'CA', lat: 56.0, lon: -106.0, minLat: 41.7, maxLat: 83.1, minLon: -141.0, maxLon: -52.6, continent: 'NA' },
  { name: 'Norway', iso: 'NO', lat: 60.5, lon: 8.5, minLat: 57.9, maxLat: 71.2, minLon: 4.5, maxLon: 31.1, continent: 'EU' },
  { name: 'Sweden', iso: 'SE', lat: 60.0, lon: 15.0, minLat: 55.3, maxLat: 69.1, minLon: 11.0, maxLon: 24.2, continent: 'EU' },
  { name: 'Finland', iso: 'FI', lat: 64.0, lon: 26.0, minLat: 59.7, maxLat: 70.1, minLon: 20.5, maxLon: 31.6, continent: 'EU' },
  { name: 'Denmark', iso: 'DK', lat: 56.0, lon: 10.0, minLat: 54.5, maxLat: 57.8, minLon: 8.0, maxLon: 12.8, continent: 'EU' },
  { name: 'Poland', iso: 'PL', lat: 52.0, lon: 19.0, minLat: 49.0, maxLat: 54.9, minLon: 14.1, maxLon: 24.2, continent: 'EU' },
  { name: 'Netherlands', iso: 'NL', lat: 52.3, lon: 5.5, minLat: 50.7, maxLat: 53.6, minLon: 3.3, maxLon: 7.2, continent: 'EU' },
  { name: 'Belgium', iso: 'BE', lat: 50.8, lon: 4.5, minLat: 49.5, maxLat: 51.5, minLon: 2.5, maxLon: 6.4, continent: 'EU' },
  { name: 'Switzerland', iso: 'CH', lat: 46.8, lon: 8.2, minLat: 45.8, maxLat: 47.8, minLon: 5.9, maxLon: 10.5, continent: 'EU' },
  { name: 'Austria', iso: 'AT', lat: 47.5, lon: 14.5, minLat: 46.4, maxLat: 49.0, minLon: 9.5, maxLon: 17.2, continent: 'EU' },
  { name: 'Portugal', iso: 'PT', lat: 39.5, lon: -8.0, minLat: 36.9, maxLat: 42.2, minLon: -9.5, maxLon: -6.2, continent: 'EU' },
  { name: 'Ireland', iso: 'IE', lat: 53.4, lon: -8.0, minLat: 51.4, maxLat: 55.4, minLon: -10.5, maxLon: -5.9, continent: 'EU' },
  { name: 'Iceland', iso: 'IS', lat: 64.9, lon: -19.0, minLat: 63.3, maxLat: 66.6, minLon: -24.6, maxLon: -13.5, continent: 'EU' },
  { name: 'Egypt', iso: 'EG', lat: 26.8, lon: 30.8, minLat: 22.0, maxLat: 31.7, minLon: 24.7, maxLon: 36.9, continent: 'AF' },
  { name: 'Morocco', iso: 'MA', lat: 31.8, lon: -7.1, minLat: 27.6, maxLat: 35.9, minLon: -13.2, maxLon: -1.0, continent: 'AF' },
  { name: 'Nigeria', iso: 'NG', lat: 9.1, lon: 8.7, minLat: 4.2, maxLat: 13.9, minLon: 2.7, maxLon: 14.7, continent: 'AF' },
  { name: 'Kenya', iso: 'KE', lat: -0.0, lon: 37.9, minLat: -4.7, maxLat: 5.0, minLon: 33.9, maxLon: 41.9, continent: 'AF' },
  { name: 'Saudi Arabia', iso: 'SA', lat: 23.9, lon: 45.1, minLat: 16.4, maxLat: 32.2, minLon: 34.5, maxLon: 55.7, continent: 'AS' },
  { name: 'South Korea', iso: 'KR', lat: 35.9, lon: 127.8, minLat: 33.1, maxLat: 38.6, minLon: 124.6, maxLon: 130.9, continent: 'AS' },
  { name: 'Philippines', iso: 'PH', lat: 12.9, lon: 121.8, minLat: 4.6, maxLat: 21.1, minLon: 116.9, maxLon: 126.6, continent: 'AS' },
  { name: 'New Zealand', iso: 'NZ', lat: -40.9, lon: 174.9, minLat: -47.3, maxLat: -34.4, minLon: 166.4, maxLon: 178.6, continent: 'OC' },
  { name: 'Chile', iso: 'CL', lat: -35.7, lon: -71.5, minLat: -56.0, maxLat: -17.5, minLon: -75.6, maxLon: -66.9, continent: 'SA' },
  { name: 'Peru', iso: 'PE', lat: -9.2, lon: -75.0, minLat: -18.4, maxLat: -0.0, minLon: -81.3, maxLon: -68.7, continent: 'SA' }
];

export class GeoIndex {
  private static registeredCountries: Map<string, CountryMeta> = new Map();

  static {
    for (const c of POPULAR_COUNTRIES) {
      this.registeredCountries.set(c.name.toLowerCase(), c);
      if (c.iso) this.registeredCountries.set(c.iso.toLowerCase(), c);
    }
    // Turkish & international aliases for seamless cross-language matching
    const aliases: Record<string, string> = {
      'türkiye': 'TR', 'turkey': 'TR',
      'amerika birleşik devletleri': 'US', 'abd': 'US', 'usa': 'US', 'united states': 'US',
      'arjantin': 'AR', 'argentina': 'AR',
      'brezilya': 'BR', 'brazil': 'BR',
      'demokratik kongo cumhuriyeti': 'CD', 'kongo': 'CD', 'congo': 'CD', 'dr congo': 'CD',
      'japonya': 'JP', 'japan': 'JP',
      'avustralya': 'AU', 'australia': 'AU',
      'hindistan': 'IN', 'india': 'IN',
      'endonezya': 'ID', 'indonesia': 'ID',
      'meksika': 'MX', 'mexico': 'MX',
      'almanya': 'DE', 'germany': 'DE',
      'fransa': 'FR', 'france': 'FR',
      'italya': 'IT', 'italy': 'IT',
      'ispanya': 'ES', 'spain': 'ES',
      'yunanistan': 'GR', 'greece': 'GR',
      'kolombiya': 'CO', 'colombia': 'CO',
      'venezuela': 'VE',
      'çin': 'CN', 'china': 'CN',
      'rusya': 'RU', 'russia': 'RU',
      'güney afrika': 'ZA', 'south africa': 'ZA',
      'kanada': 'CA', 'canada': 'CA',
      'ingiltere': 'GB', 'united kingdom': 'GB', 'uk': 'GB',
      'norveç': 'NO', 'norway': 'NO',
      'isveç': 'SE', 'sweden': 'SE',
      'finlandiya': 'FI', 'finland': 'FI',
      'danimarka': 'DK', 'denmark': 'DK',
      'polonya': 'PL', 'poland': 'PL',
      'hollanda': 'NL', 'netherlands': 'NL',
      'belçika': 'BE', 'belgium': 'BE',
      'isviçre': 'CH', 'switzerland': 'CH',
      'avusturya': 'AT', 'austria': 'AT',
      'portekiz': 'PT', 'portugal': 'PT',
      'irlanda': 'IE', 'ireland': 'IE',
      'izlanda': 'IS', 'iceland': 'IS',
      'mısır': 'EG', 'egypt': 'EG',
      'fas': 'MA', 'morocco': 'MA',
      'nijerya': 'NG', 'nigeria': 'NG',
      'kenya': 'KE',
      'suudi arabistan': 'SA', 'saudi arabia': 'SA',
      'güney kore': 'KR', 'kore': 'KR', 'south korea': 'KR', 'korea': 'KR',
      'filipinler': 'PH', 'philippines': 'PH',
      'yeni zelanda': 'NZ', 'new zealand': 'NZ',
      'şili': 'CL', 'chile': 'CL',
      'peru': 'PE'
    };
    for (const [alias, iso] of Object.entries(aliases)) {
      const country = POPULAR_COUNTRIES.find((c) => c.iso === iso);
      if (country) {
        this.registeredCountries.set(alias.toLowerCase(), country);
      }
    }
  }

  public static registerCountry(meta: CountryMeta): void {
    const existing = this.registeredCountries.get(meta.name.toLowerCase());
    if (existing && (existing.lat !== 0 || existing.lon !== 0 || existing.minLat !== undefined)) {
      // Do not overwrite high-fidelity calibrated country metadata with dummy (0,0) stubs
      if (meta.lat === 0 && meta.lon === 0 && meta.minLat === undefined) {
        return;
      }
    }
    this.registeredCountries.set(meta.name.toLowerCase(), meta);
    if (meta.iso) this.registeredCountries.set(meta.iso.toLowerCase(), meta);
  }

  public static getCountryList(): CountryMeta[] {
    const list: CountryMeta[] = [];
    const seen = new Set<string>();
    for (const c of this.registeredCountries.values()) {
      if (!seen.has(c.name)) {
        seen.add(c.name);
        list.push(c);
      }
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, 'tr'));
  }

  public static getCountry(nameOrIso: string): CountryMeta | undefined {
    return this.registeredCountries.get(nameOrIso.toLowerCase());
  }

  public static getContinent(code: string): GeoContinentDef | undefined {
    return CONTINENTS.find((c) => c.code.toUpperCase() === code.toUpperCase());
  }

  public static getRegion(id: string): GeoRegionDef | undefined {
    return REGIONS.find((r) => r.id === id);
  }

  public static isCoordInContinent(lat: number, lon: number, continentCode: string): boolean {
    const code = continentCode.toUpperCase();
    if (code === 'NA') return lat >= 12 && lat <= 85 && lon >= -170 && lon <= -50;
    if (code === 'SA') return lat >= -60 && lat < 14 && lon >= -90 && lon <= -30;
    if (code === 'EU') return lat >= 35 && lat <= 75 && lon >= -25 && lon <= 45;
    if (code === 'AF') return lat >= -35 && lat < 37 && lon >= -20 && lon <= 52;
    if (code === 'AS') return lat >= -10 && lat <= 80 && lon >= 45 && lon <= 180;
    if (code === 'OC') return lat >= -50 && lat < 0 && lon >= 100 && lon <= 180;
    if (code === 'AQ') return lat <= -60;
    return false;
  }

  public static isCoordInRegion(lat: number, lon: number, regionId: string): boolean {
    const reg = REGIONS.find((r) => r.id === regionId);
    if (!reg) return false;
    return lat >= reg.minLat && lat <= reg.maxLat && lon >= reg.minLon && lon <= reg.maxLon;
  }

  public static isCoordInCountry(lat: number, lon: number, countryNameOrIso: string): boolean {
    const country = this.registeredCountries.get(countryNameOrIso.toLowerCase());
    if (!country) return false;
    if (
      country.minLat !== undefined &&
      country.maxLat !== undefined &&
      country.minLon !== undefined &&
      country.maxLon !== undefined
    ) {
      return (
        lat >= country.minLat &&
        lat <= country.maxLat &&
        lon >= country.minLon &&
        lon <= country.maxLon
      );
    }
    // Fallback: Proximity to centroid (< 350km)
    const dLat = (lat - country.lat) * 111;
    const dLon = (lon - country.lon) * 111 * Math.cos((lat * Math.PI) / 180);
    return Math.sqrt(dLat * dLat + dLon * dLon) <= 350;
  }

  public static matchesFilter(
    lat: number,
    lon: number,
    continents: string[],
    regions: string[],
    countries: string[]
  ): boolean {
    const hasContinents = continents && continents.length > 0;
    const hasRegions = regions && regions.length > 0;
    const hasCountries = countries && countries.length > 0;

    // If no geographic filter is specified, matches all
    if (!hasContinents && !hasRegions && !hasCountries) {
      return true;
    }

    // OR logic across geographic categories
    if (hasContinents) {
      for (const cont of continents) {
        if (this.isCoordInContinent(lat, lon, cont)) return true;
      }
    }

    if (hasRegions) {
      for (const reg of regions) {
        if (this.isCoordInRegion(lat, lon, reg)) return true;
      }
    }

    if (hasCountries) {
      for (const c of countries) {
        if (this.isCoordInCountry(lat, lon, c)) return true;
      }
    }

    return false;
  }

  public static getSubregionName(lat: number, lon: number, countryName: string): string {
    const cNorm = countryName.toLowerCase();
    if (cNorm === 'united states' || cNorm === 'amerika birleşik devletleri' || cNorm === 'usa' || cNorm === 'abd') {
      if (lat < 31.5 && lon > -87.5) return 'USA (Florida / Southeast)';
      if (lat < 36 && lon >= -106 && lon <= -88) return 'USA (Texas / Gulf)';
      if (lat >= 36 && lat <= 44 && lon >= -104 && lon <= -90) return 'USA (Great Plains)';
      if (lat >= 38 && lon >= -90 && lon <= -79) return 'USA (Midwest)';
      if (lat >= 32 && lon > -79) return 'USA (East Coast / Atlantic)';
      if (lat >= 32 && lat <= 45 && lon >= -114 && lon <= -104) return 'USA (Rocky Mountains)';
      if (lat < 36 && lon >= -118 && lon < -106) return 'USA (Southwest)';
      if (lat >= 42 && lon < -116) return 'USA (Pacific Northwest)';
      if (lat < 42 && lon < -116) return 'USA (California)';
      return 'USA (North America)';
    }

    if (cNorm === 'turkey' || cNorm === 'türkiye') {
      if (lat < 38 && lon < 33) return 'Turkey (Mediterranean)';
      if (lat > 40 && lon < 30) return 'Turkey (Marmara)';
      if (lat > 40 && lon >= 30) return 'Turkey (Black Sea)';
      if (lat >= 38 && lat <= 40 && lon >= 30 && lon <= 36) return 'Turkey (Central Anatolia)';
      if (lat < 38 && lon >= 36) return 'Turkey (Southeastern Anatolia)';
      if (lat >= 38 && lon >= 38) return 'Turkey (Eastern Anatolia)';
      if (lon < 30) return 'Turkey (Aegean)';
      return 'Turkey';
    }

    if (cNorm === 'brazil' || cNorm === 'brezilya') {
      if (lat > -10 && lon < -52) return 'Brazil (Amazon / North)';
      if (lat <= -18) return 'Brazil (Southeast / Sao Paulo)';
      if (lon >= -45) return 'Brazil (East Coast)';
      return 'Brazil (Central Basin)';
    }

    if (cNorm === 'australia' || cNorm === 'avustralya') {
      if (lon < 125) return 'Australia (Western)';
      if (lat > -22) return 'Australia (Northern / Tropical)';
      if (lon >= 140 && lat <= -28) return 'Australia (Southeast)';
      if (lon >= 140 && lat > -28) return 'Australia (Queensland)';
      return 'Australia (Inland Basin)';
    }

    if (cNorm === 'canada' || cNorm === 'kanada') {
      if (lon < -115) return 'Canada (Pacific / West)';
      if (lon > -80) return 'Canada (East Coast)';
      return 'Canada (Great Plains)';
    }

    if (cNorm === 'russia' || cNorm === 'rusya') {
      if (lon > 100) return 'Russia (Far East / Siberia)';
      if (lon > 60) return 'Russia (Siberia)';
      return 'Russia (European Sector)';
    }

    return `${countryName} Skies`;
  }

  public static getThematicLocation(lat: number, lon: number): { name: string; flag: string } {
    // 1. Check known countries
    for (const country of POPULAR_COUNTRIES) {
      if (this.isCoordInCountry(lat, lon, country.name)) {
        const continentIcons: Record<string, string> = {
          EU: '🌍', AF: '🌍', NA: '🌎', SA: '🌎', AS: '🌏', OC: '🌏'
        };
        const flag = (country.continent && continentIcons[country.continent]) ? continentIcons[country.continent] : '⚡';
        const subName = this.getSubregionName(lat, lon, country.name);
        return { name: subName, flag };
      }
    }

    // 2. Check known meteorological regions / hotspots
    for (const reg of REGIONS) {
      if (this.isCoordInRegion(lat, lon, reg.id)) {
        return { name: `${reg.name} Skies`, flag: '⚡' };
      }
    }

    // 3. Oceanic and Polar Resolution
    if (lat > 66) return { name: 'Arctic Circle', flag: '❄️' };
    if (lat < -60) return { name: 'Antarctic Ice Sheet', flag: '❄️' };

    // Atlantic Ocean
    if (lon >= -70 && lon <= -10) {
      if (lat > 15) return { name: 'North Atlantic Basin', flag: '🌊' };
      if (lat <= 15) return { name: 'South Atlantic Basin', flag: '🌊' };
    }

    // Pacific Ocean
    if (lon <= -100 || lon >= 140) {
      if (lat > 10) return { name: 'North Pacific Ocean', flag: '🌊' };
      if (lat <= 10) return { name: 'South Pacific Ocean', flag: '🌊' };
    }

    // Indian Ocean
    if (lat <= 25 && lat >= -45 && lon >= 45 && lon <= 110) {
      return { name: 'Indian Ocean Basin', flag: '🌊' };
    }

    // Fallback based on continent bounding
    if (this.isCoordInContinent(lat, lon, 'EU')) return { name: 'European Skies', flag: '🌍' };
    if (this.isCoordInContinent(lat, lon, 'AF')) return { name: 'African Skies', flag: '🌍' };
    if (this.isCoordInContinent(lat, lon, 'AS')) return { name: 'Asian Skies', flag: '🌏' };
    if (this.isCoordInContinent(lat, lon, 'NA')) return { name: 'North American Basin', flag: '🌎' };
    if (this.isCoordInContinent(lat, lon, 'SA')) return { name: 'South American Basin', flag: '🌎' };
    if (this.isCoordInContinent(lat, lon, 'OC')) return { name: 'Oceania & Pacific', flag: '🌏' };

    return { name: 'Open Ocean / Global Focus', flag: '🌐' };
  }
}
