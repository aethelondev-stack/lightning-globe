/**
 * EnergyProxy: Dynamic physical scaling and intensity proxy model for lightning strikes (Phase 20).
 *
 * When direct physical joules or gigawatt metrics are unavailable from raw sensor telemetry,
 * this model synthesizes an empirical energy index from absolute peak current amplitude (|kA|)
 * and localized strike cluster density.
 *
 * Formula (per MASTER_PLAN_V2.md):
 *   EnergyProxy = clamp( 0.65 * (|peakCurrent| / 100.0) + 0.35 * (localDensity / 10.0), 0.2, 3.0 )
 */

export interface EnergyScalingFactors {
  energyProxy: number;
  shockwaveMaxRadius: number;
  shockwavePropagationSpeed: number;
  pointRadius: number;
  boltIntensity: number;
}

export class EnergyProxy {
  public static readonly MIN_CLAMP = 0.2;
  public static readonly MAX_CLAMP = 3.0;

  public static readonly CURRENT_WEIGHT = 0.65;
  public static readonly DENSITY_WEIGHT = 0.35;

  public static readonly CURRENT_NORM_KA = 100.0;
  public static readonly DENSITY_NORM_COUNT = 10.0;

  /**
   * Calculates the raw clamped EnergyProxy index.
   *
   * @param peakCurrent Peak current amplitude in kiloamperes (e.g. -35 kA, +120 kA)
   * @param localDensity Number of strikes in close spatio-temporal proximity (default 1.0)
   * @returns Clamped scalar in range [0.2, 3.0]
   */
  public static calculate(peakCurrent: number, localDensity: number = 1.0): number {
    const absCurrent = Math.abs(peakCurrent);
    const density = Math.max(0, localDensity);

    const currentComponent = this.CURRENT_WEIGHT * (absCurrent / this.CURRENT_NORM_KA);
    const densityComponent = this.DENSITY_WEIGHT * (density / this.DENSITY_NORM_COUNT);

    const rawEnergy = currentComponent + densityComponent;
    return Math.min(this.MAX_CLAMP, Math.max(this.MIN_CLAMP, rawEnergy));
  }

  /**
   * Computes dynamic shockwave max radius in globe units.
   * Scaled sub-linearly (power 0.4) to maintain visual realism without overwhelming the globe.
   */
  public static getShockwaveMaxRadius(energyProxy: number, baseRadius: number = 4.5): number {
    return baseRadius * Math.pow(energyProxy, 0.4);
  }

  /**
   * Computes dynamic propagation expansion speed.
   * High-energy strikes blast shockwaves faster into the surrounding air.
   */
  public static getShockwavePropagationSpeed(energyProxy: number, baseSpeed: number = 3.0): number {
    return baseSpeed * Math.pow(energyProxy, 0.3);
  }

  /**
   * Computes radiant strike point visual size.
   */
  public static getPointRadius(energyProxy: number, baseRadius: number = 0.18): number {
    return baseRadius * Math.pow(energyProxy, 0.5);
  }

  /**
   * Computes 3D procedural bolt thickness/luminosity factor.
   */
  public static getBoltIntensity(energyProxy: number): number {
    return Math.min(2.5, Math.max(0.4, energyProxy * 0.85));
  }

  /**
   * Computes all dynamic visual scaling factors in a single call.
   */
  public static getScalingFactors(peakCurrent: number, localDensity: number = 1.0): EnergyScalingFactors {
    const proxy = this.calculate(peakCurrent, localDensity);
    return {
      energyProxy: proxy,
      shockwaveMaxRadius: this.getShockwaveMaxRadius(proxy),
      shockwavePropagationSpeed: this.getShockwavePropagationSpeed(proxy),
      pointRadius: this.getPointRadius(proxy),
      boltIntensity: this.getBoltIntensity(proxy)
    };
  }
}
