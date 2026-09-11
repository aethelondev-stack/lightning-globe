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
  { code: 'AF', name: 'Afrika', centerLat: 2.0, centerLon: 20.0, defaultDistance: 270 },
  { code: 'AS', name: 'Asya', centerLat: 35.0, centerLon: 95.0, defaultDistance: 290 },
  { code: 'EU', name: 'Avrupa', centerLat: 50.0, centerLon: 15.0, defaultDistance: 240 },
  { code: 'NA', name: 'Kuzey Amerika', centerLat: 40.0, centerLon: -100.0, defaultDistance: 280 },
  { code: 'SA', name: 'Güney Amerika', centerLat: -15.0, centerLon: -60.0, defaultDistance: 270 },
  { code: 'OC', name: 'Okyanusya', centerLat: -25.0, centerLon: 135.0, defaultDistance: 260 },
  { code: 'AQ', name: 'Antarktika', centerLat: -80.0, centerLon: 0.0, defaultDistance: 260 }
];

export const REGIONS: GeoRegionDef[] = [
  {
    id: 'mediterranean',
    name: 'Akdeniz Havzası',
    minLat: 28,
    maxLat: 46,
    minLon: -6,
    maxLon: 36,
    centerLat: 36.0,
    centerLon: 18.0
  },
  {
    id: 'middle_east',
    name: 'Orta Doğu',
    minLat: 12,
    maxLat: 42,
    minLon: 34,
    maxLon: 62,
    centerLat: 29.0,
    centerLon: 45.0
  },
  {
    id: 'congo',
    name: 'Kongo Havzası',
    minLat: -12,
    maxLat: 6,
    minLon: 10,
    maxLon: 32,
    centerLat: -1.0,
    centerLon: 23.0
  },
  {
    id: 'southeast_asia',
    name: 'Güneydoğu Asya',
    minLat: -10,
    maxLat: 25,
    minLon: 95,
    maxLon: 142,
    centerLat: 5.0,
    centerLon: 110.0
  },
  {
    id: 'caribbean',
    name: 'Karayipler & Körfez',
    minLat: 10,
    maxLat: 32,
    minLon: -98,
    maxLon: -58,
    centerLat: 18.0,
    centerLon: -75.0
  },
  {
    id: 'great_plains',
    name: 'Kuzey Amerika Ovaları',
    minLat: 28,
    maxLat: 50,
    minLon: -106,
    maxLon: -88,
    centerLat: 38.0,
    centerLon: -98.0
  },
  {
    id: 'pampas',
    name: 'Güney Amerika Pampas',
    minLat: -38,
    maxLat: -18,
    minLon: -68,
    maxLon: -52,
    centerLat: -28.0,
    centerLon: -60.0
  },
  {
    id: 'maracaibo',
    name: 'Maracaibo Feneri',
    minLat: 8.5,
    maxLat: 11.5,
    minLon: -72.5,
    maxLon: -70.5,
    centerLat: 9.8,
    centerLon: -71.5
  },
  {
    id: 'central_europe',
    name: 'Orta & Batı Avrupa',
    minLat: 42,
    maxLat: 58,
    minLon: -5,
    maxLon: 25,
    centerLat: 49.0,
    centerLon: 10.0
  }
];

export const POPULAR_COUNTRIES: CountryMeta[] = [
  { name: 'Türkiye', iso: 'TR', lat: 39.0, lon: 35.0, minLat: 35.8, maxLat: 42.1, minLon: 25.6, maxLon: 44.8, continent: 'EU' },
  { name: 'Amerika Birleşik Devletleri', iso: 'US', lat: 38.0, lon: -97.0, minLat: 24.5, maxLat: 49.4, minLon: -125.0, maxLon: -66.9, continent: 'NA' },
  { name: 'Arjantin', iso: 'AR', lat: -34.0, lon: -64.0, minLat: -55.0, maxLat: -21.8, minLon: -73.6, maxLon: -53.6, continent: 'SA' },
  { name: 'Brezilya', iso: 'BR', lat: -10.0, lon: -53.0, minLat: -33.7, maxLat: 5.3, minLon: -73.9, maxLon: -34.8, continent: 'SA' },
  { name: 'Demokratik Kongo Cumhuriyeti', iso: 'CD', lat: -2.5, lon: 23.5, minLat: -13.5, maxLat: 5.4, minLon: 12.2, maxLon: 31.3, continent: 'AF' },
  { name: 'Japonya', iso: 'JP', lat: 36.0, lon: 138.0, minLat: 30.0, maxLat: 45.5, minLon: 128.0, maxLon: 146.0, continent: 'AS' },
  { name: 'Avustralya', iso: 'AU', lat: -25.0, lon: 134.0, minLat: -43.6, maxLat: -10.0, minLon: 113.0, maxLon: 153.6, continent: 'OC' },
  { name: 'Hindistan', iso: 'IN', lat: 21.0, lon: 78.0, minLat: 8.0, maxLat: 35.5, minLon: 68.0, maxLon: 97.4, continent: 'AS' },
  { name: 'Endonezya', iso: 'ID', lat: -2.0, lon: 118.0, minLat: -11.0, maxLat: 6.0, minLon: 95.0, maxLon: 141.0, continent: 'AS' },
  { name: 'Meksika', iso: 'MX', lat: 23.0, lon: -102.0, minLat: 14.5, maxLat: 32.7, minLon: -117.1, maxLon: -86.7, continent: 'NA' },
  { name: 'Almanya', iso: 'DE', lat: 51.0, lon: 10.0, minLat: 47.3, maxLat: 55.0, minLon: 5.9, maxLon: 15.0, continent: 'EU' },
  { name: 'Fransa', iso: 'FR', lat: 46.5, lon: 2.5, minLat: 41.3, maxLat: 51.1, minLon: -4.8, maxLon: 9.6, continent: 'EU' },
  { name: 'İtalya', iso: 'IT', lat: 42.5, lon: 12.5, minLat: 36.6, maxLat: 47.1, minLon: 6.6, maxLon: 18.5, continent: 'EU' },
  { name: 'İspanya', iso: 'ES', lat: 40.0, lon: -3.5, minLat: 36.0, maxLat: 43.8, minLon: -9.3, maxLon: 3.3, continent: 'EU' },
  { name: 'Yunanistan', iso: 'GR', lat: 39.0, lon: 22.0, minLat: 34.8, maxLat: 41.7, minLon: 19.3, maxLon: 29.6, continent: 'EU' },
  { name: 'Kolombiya', iso: 'CO', lat: 4.0, lon: -73.0, minLat: -4.2, maxLat: 12.5, minLon: -79.0, maxLon: -67.0, continent: 'SA' },
  { name: 'Venezuela', iso: 'VE', lat: 7.0, lon: -66.0, minLat: 0.6, maxLat: 12.2, minLon: -73.4, maxLon: -59.8, continent: 'SA' },
  { name: 'Çin', iso: 'CN', lat: 35.0, lon: 103.0, minLat: 18.0, maxLat: 53.5, minLon: 73.5, maxLon: 135.0, continent: 'AS' },
  { name: 'Rusya', iso: 'RU', lat: 60.0, lon: 95.0, minLat: 41.2, maxLat: 81.8, minLon: 19.6, maxLon: 180.0, continent: 'EU' },
  { name: 'Güney Afrika', iso: 'ZA', lat: -29.0, lon: 24.0, minLat: -34.8, maxLat: -22.1, minLon: 16.5, maxLon: 32.9, continent: 'AF' }
];

export class GeoIndex {
  private static registeredCountries: Map<string, CountryMeta> = new Map();

  static {
    for (const c of POPULAR_COUNTRIES) {
      this.registeredCountries.set(c.name.toLowerCase(), c);
      if (c.iso) this.registeredCountries.set(c.iso.toLowerCase(), c);
    }
  }

  public static registerCountry(meta: CountryMeta): void {
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

  public static getThematicLocation(lat: number, lon: number): { name: string; flag: string } {
    // 1. Check known countries
    for (const country of POPULAR_COUNTRIES) {
      if (this.isCoordInCountry(lat, lon, country.name)) {
        const continentIcons: Record<string, string> = {
          EU: '🌍', AF: '🌍', NA: '🌎', SA: '🌎', AS: '🌏', OC: '🌏'
        };
        const flag = (country.continent && continentIcons[country.continent]) ? continentIcons[country.continent] : '⚡';
        return { name: `${country.name} Semaları`, flag };
      }
    }

    // 2. Check known meteorological regions / hotspots
    for (const reg of REGIONS) {
      if (this.isCoordInRegion(lat, lon, reg.id)) {
        return { name: `${reg.name} Semaları`, flag: '⚡' };
      }
    }

    // 3. Oceanic and Polar Resolution
    if (lat > 66) return { name: 'Kuzey Kutup Dairesi', flag: '❄️' };
    if (lat < -60) return { name: 'Antarktika Buzul Sahası', flag: '❄️' };

    // Atlantic Ocean
    if (lon >= -70 && lon <= -10) {
      if (lat > 15) return { name: 'Kuzey Atlantik Havzası', flag: '🌊' };
      if (lat <= 15) return { name: 'Güney Atlantik Havzası', flag: '🌊' };
    }

    // Pacific Ocean
    if (lon <= -100 || lon >= 140) {
      if (lat > 10) return { name: 'Kuzey Pasifik Okyanusu', flag: '🌊' };
      if (lat <= 10) return { name: 'Güney Pasifik Okyanusu', flag: '🌊' };
    }

    // Indian Ocean
    if (lat <= 25 && lat >= -45 && lon >= 45 && lon <= 110) {
      return { name: 'Hint Okyanusu Havzası', flag: '🌊' };
    }

    // Fallback based on continent bounding
    if (this.isCoordInContinent(lat, lon, 'EU')) return { name: 'Avrupa Kıtası Semaları', flag: '🌍' };
    if (this.isCoordInContinent(lat, lon, 'AF')) return { name: 'Afrika Kıtası Semaları', flag: '🌍' };
    if (this.isCoordInContinent(lat, lon, 'AS')) return { name: 'Asya Kıtası Semaları', flag: '🌏' };
    if (this.isCoordInContinent(lat, lon, 'NA')) return { name: 'Kuzey Amerika Havzası', flag: '🌎' };
    if (this.isCoordInContinent(lat, lon, 'SA')) return { name: 'Güney Amerika Havzası', flag: '🌎' };
    if (this.isCoordInContinent(lat, lon, 'OC')) return { name: 'Okyanusya & Pasifik', flag: '🌏' };

    return { name: 'Açık Deniz / Küresel Odak', flag: '🌐' };
  }
}
