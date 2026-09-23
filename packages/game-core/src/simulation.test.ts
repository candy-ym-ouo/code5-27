import { describe, expect, it } from 'vitest';
import { SPECIES, SPECIES_BY_ID } from './catalog.ts';
import {
  applyOverwinter,
  createSpeciesState,
  disperseSpecies,
  evaluateSample,
  evolveSeason,
  generateSiteState,
  getPhenologyWindow,
  getPlantPresentation,
  getSuitability,
  getWorstStatus
} from './simulation.ts';

describe('deterministic world simulation', () => {
  it('generates identical environments for the same seed', () => {
    const first = generateSiteState('save', 'seed-alpha', 1, 'spring', 3, 'foothill');
    const second = generateSiteState('save', 'seed-alpha', 1, 'spring', 3, 'foothill');
    expect(first).toEqual(second);
  });

  it('penalizes a wrong litter sample', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const site = generateSiteState('save', 'seed-beta', 1, 'spring', 3, 'foothill');
    const state = createSpeciesState('save', 'seed-beta', 1, 'spring', 'foothill', species.id);
    const decision = evaluateSample(species, state, site, 'spring', 3, 'litter', 0);
    expect(decision.allowed).toBe(true);
    expect(decision.protocolMatch).toBe(false);
    expect(decision.effects.health).toBeLessThan(0);
    expect(decision.effects.populationDelta).toBeLessThan(0);
  });

  it('keeps multi-year simulations finite and bounded', () => {
    const species = SPECIES_BY_ID.get('ginkgo-biloba')!;
    let state = createSpeciesState('save', 'seed-gamma', 1, 'spring', 'mixed_forest', species.id);

    for (let year = 1; year <= 250; year += 1) {
      for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
        const site = generateSiteState('save', 'seed-gamma', year, season, 5, 'mixed_forest');
        expect(getSuitability(species, site)).toBeGreaterThanOrEqual(0);
        expect(getSuitability(species, site)).toBeLessThanOrEqual(1);
        state = evolveSeason(state, site, [site]).state;
      }
      state = applyOverwinter(state, generateSiteState('save', 'seed-gamma', year, 'winter', 5, 'mixed_forest'));
      expect(Number.isFinite(state.population)).toBe(true);
      expect(Number.isFinite(state.health)).toBe(true);
      expect(state.population).toBeGreaterThanOrEqual(0);
      expect(state.health).toBeGreaterThanOrEqual(0);
      expect(state.health).toBeLessThanOrEqual(100);
    }
  });
});

describe('catalog-wide stability', () => {
  it('keeps every configured species and site finite for 120 years', () => {
    for (const species of SPECIES) {
      for (const [siteId, profile] of Object.entries(species.zones)) {
        if (!siteId || !profile) continue;
        let state = createSpeciesState('save', `seed-${species.id}`, 1, 'spring', siteId as never, species.id);
        for (let year = 1; year <= 120; year += 1) {
          for (const season of ['spring', 'summer', 'autumn', 'winter'] as const) {
            const site = generateSiteState('save', `seed-${species.id}`, year, season, 5, siteId as never);
            state = evolveSeason(state, site, [site]).state;
          }
          state = applyOverwinter(state, generateSiteState('save', `seed-${species.id}`, year, 'winter', 5, siteId as never));
          expect(Number.isFinite(state.population)).toBe(true);
          expect(Number.isFinite(state.health)).toBe(true);
          expect(Number.isFinite(state.seedBank)).toBe(true);
          expect(state.population).toBeGreaterThanOrEqual(0);
          expect(state.population).toBeLessThanOrEqual(profile.carryingCapacity * 1.2 + 0.01);
          expect(state.health).toBeGreaterThanOrEqual(0);
          expect(state.health).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});

describe('sampling safety', () => {
  it('does not allow destructive sampling on protected species', () => {
    const species = SPECIES_BY_ID.get('metasequoia-glyptostroboides')!;
    const site = generateSiteState('save', 'protected-seed', 1, 'spring', 5, 'stream_valley');
    const state = createSpeciesState('save', 'protected-seed', 1, 'spring', 'stream_valley', species.id);
    expect(evaluateSample(species, state, site, 'spring', 5, 'litter', 0).allowed).toBe(false);
    expect(evaluateSample(species, state, site, 'spring', 5, 'cutting', 0).allowed).toBe(false);
    expect(evaluateSample(species, state, site, 'spring', 5, 'photo', 0).allowed).toBe(true);
  });
});

describe('annual dispersal', () => {
  it('moves surplus individuals into a suitable neighboring habitat without creating mass', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const base = generateSiteState('save', 'dispersal-seed', 1, 'spring', 5, 'foothill');
    const preferred = {
      temperatureC: species.preferred.temperatureC,
      humidity: species.preferred.humidity,
      soilMoisture: species.preferred.soilMoisture,
      lightLux: species.preferred.lightLux,
      windSpeed: 1,
      disturbance: 0
    };
    const foothill = { ...base, ...preferred };
    const mixed = { ...base, ...preferred, siteId: 'mixed_forest' as const };
    const source = {
      ...createSpeciesState('save', 'dispersal-seed', 1, 'spring', 'foothill', species.id),
      population: species.zones.foothill!.carryingCapacity * 0.95,
      health: 90
    };
    const target = {
      ...createSpeciesState('save', 'dispersal-seed', 1, 'spring', 'mixed_forest', species.id),
      population: 10,
      health: 85
    };
    const before = source.population + target.population;
    const result = disperseSpecies([source, target], [foothill, mixed]);
    const nextSource = result.find((state) => state.siteId === 'foothill')!;
    const nextTarget = result.find((state) => state.siteId === 'mixed_forest')!;
    expect(nextSource.population).toBeLessThan(source.population);
    expect(nextTarget.population).toBeGreaterThan(target.population);
    expect(nextSource.population + nextTarget.population).toBeCloseTo(before, 1);
  });
});

describe('phenology shift', () => {
  it('uses annual temperature shifts in the effective bloom window and presentation', () => {
    const species = SPECIES_BY_ID.get('prunus-davidiana')!;
    const site = generateSiteState('save', 'phenology-seed', 1, 'spring', 4, 'foothill');
    const state = createSpeciesState('save', 'phenology-seed', 1, 'spring', 'foothill', species.id);
    const shifted = { ...state, phenology: { ...state.phenology, shift: -1 } };
    expect(getPhenologyWindow(species, shifted, 'spring')).toEqual({ start: 1, peak: 4, end: 7 });
    expect(getPlantPresentation(species, shifted, 'spring', 4).stage).toBe('full_bloom');
    expect(applyOverwinter(state, { ...site, temperatureC: 12 }).phenology.shift).toBe(-1);
  });
});

describe('cross-region status aggregation', () => {
  it('reports growing when every region is genuinely growing', () => {
    // 回归：年度汇总不得用预置的 stable 覆盖真实区域状态。
    expect(getWorstStatus(['growing', 'growing', 'growing', 'growing'])).toBe('growing');
  });

  it('reflects the worst real status across all regions', () => {
    expect(getWorstStatus(['growing', 'stable'])).toBe('stable');
    expect(getWorstStatus(['stable', 'vulnerable', 'growing'])).toBe('vulnerable');
    expect(getWorstStatus(['growing', 'endangered', 'stable'])).toBe('endangered');
    expect(getWorstStatus(['vulnerable', 'absent'])).toBe('absent');
  });

  it('ignores unknown or missing statuses and returns null when no real status exists', () => {
    expect(getWorstStatus([null, undefined, 'unknown'])).toBeNull();
    expect(getWorstStatus([])).toBeNull();
  });
});
