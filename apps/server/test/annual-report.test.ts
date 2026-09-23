import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SpeciesState } from '@shanhai/game-core';
import { createApp } from '../src/app.ts';

describe('annual report species aggregation', () => {
  let service: ReturnType<typeof createApp>['service'];
  let store: ReturnType<typeof createApp>['store'];

  beforeAll(() => {
    const created = createApp({ databasePath: ':memory:', loggerEnabled: false });
    service = created.service;
    store = created.store;
  });

  afterAll(() => store.close());

  function makeState(
    saveId: string,
    year: number,
    siteId: SpeciesState['siteId'],
    speciesId: string,
    population: number,
    health: number,
    status: string
  ): SpeciesState {
    return {
      saveId,
      year,
      siteId,
      speciesId,
      population,
      health,
      seedBank: 10,
      suitability: 0.8,
      status,
      phenology: { bloomStartDay: 5, bloomPeakDay: 7, bloomEndDay: 9, shift: 0 }
    };
  }

  type ReportInput = { id: string; year: number; year_start_species_json: string };
  type AnnualReportSummary = {
    speciesChanges: Array<{ speciesId: string; status: string }>;
  };

  function buildReport(save: ReportInput, states: SpeciesState[]): AnnualReportSummary {
    return (
      service as unknown as {
        createAnnualReport: (save: ReportInput, states: SpeciesState[]) => AnnualReportSummary;
      }
    ).createAnnualReport(save, states);
  }

  it('reports growing when every region is genuinely growing (no injected stable)', () => {
    // carex-community 分布在全部 4 个区域，carryingCapacity 分别为
    // stream_valley 450、ridge 320、foothill 260、mixed_forest 220；
    // 下面的种群/健康组合经 getStatus 判定全部为 growing。
    const saveId = 'save-all-growing';
    const sites: Array<SpeciesState['siteId']> = ['stream_valley', 'ridge', 'foothill', 'mixed_forest'];
    const initialPopulations: Record<SpeciesState['siteId'], number> = {
      stream_valley: 350,
      ridge: 250,
      foothill: 200,
      mixed_forest: 170
    };
    const finalPopulations: Record<SpeciesState['siteId'], number> = {
      stream_valley: 400,
      ridge: 290,
      foothill: 230,
      mixed_forest: 200
    };

    const initialStates = sites.map((siteId) =>
      makeState(saveId, 1, siteId, 'carex-community', initialPopulations[siteId], 80, 'growing')
    );
    const finalStates = sites.map((siteId) =>
      makeState(saveId, 1, siteId, 'carex-community', finalPopulations[siteId], 90, 'growing')
    );
    const save: ReportInput = { id: saveId, year: 1, year_start_species_json: JSON.stringify(initialStates) };

    const report = buildReport(save, finalStates);

    const change = report.speciesChanges.find((item) => item.speciesId === 'carex-community');
    expect(change).toBeDefined();
    expect(change!.status).toBe('growing');
  });

  it('reports the worst real status when regions differ', () => {
    // camellia-japonica 在 mixed_forest 增长、在 stream_valley 脆弱，汇总必须为脆弱。
    const saveId = 'save-mixed-status';
    const initialStates = [
      makeState(saveId, 1, 'mixed_forest', 'camellia-japonica', 80, 70, 'stable'),
      makeState(saveId, 1, 'stream_valley', 'camellia-japonica', 28, 50, 'vulnerable')
    ];
    const finalStates = [
      makeState(saveId, 1, 'mixed_forest', 'camellia-japonica', 150, 90, 'growing'),
      makeState(saveId, 1, 'stream_valley', 'camellia-japonica', 20, 50, 'vulnerable')
    ];
    const save: ReportInput = { id: saveId, year: 1, year_start_species_json: JSON.stringify(initialStates) };

    const report = buildReport(save, finalStates);

    const change = report.speciesChanges.find((item) => item.speciesId === 'camellia-japonica');
    expect(change).toBeDefined();
    expect(change!.status).toBe('vulnerable');
  });
});
