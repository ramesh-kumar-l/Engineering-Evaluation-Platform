import { describe, expect, it } from 'vitest';
import {
  experimentSelectionFromEnv,
  InvalidExperimentSelectionError,
} from './experimentSelectionFromEnv.js';

describe('experimentSelectionFromEnv', () => {
  it('returns an empty selection when no variables are set', () => {
    expect(experimentSelectionFromEnv({})).toEqual({});
  });

  it('parses comma-separated task ids, trimming and dropping empties', () => {
    expect(experimentSelectionFromEnv({ EEP_EXPERIMENT_TASK_IDS: ' debugging-01 , feature-01 , ' })).toEqual({
      taskIds: ['debugging-01', 'feature-01'],
    });
  });

  it('parses comma-separated condition names including ablated names', () => {
    expect(experimentSelectionFromEnv({ EEP_EXPERIMENT_CONDITIONS: 'native,ecc,ecc-ablated:memory' })).toEqual({
      conditionNames: ['native', 'ecc', 'ecc-ablated:memory'],
    });
  });

  it('treats an all-whitespace/comma list as unset', () => {
    expect(experimentSelectionFromEnv({ EEP_EXPERIMENT_TASK_IDS: ' , , ' })).toEqual({});
  });

  it('parses a positive integer repetitions value', () => {
    expect(experimentSelectionFromEnv({ EEP_EXPERIMENT_REPETITIONS: '2' })).toEqual({ repetitions: 2 });
  });

  it('ignores an empty repetitions value', () => {
    expect(experimentSelectionFromEnv({ EEP_EXPERIMENT_REPETITIONS: '  ' })).toEqual({});
  });

  it.each(['0', '-1', '1.5', '3abc', 'many'])(
    'throws InvalidExperimentSelectionError for a malformed repetitions value (%s)',
    (value) => {
      expect(() => experimentSelectionFromEnv({ EEP_EXPERIMENT_REPETITIONS: value })).toThrow(
        InvalidExperimentSelectionError,
      );
    },
  );

  it('combines all three fields', () => {
    expect(
      experimentSelectionFromEnv({
        EEP_EXPERIMENT_TASK_IDS: 'debugging-01',
        EEP_EXPERIMENT_CONDITIONS: 'native,ecc',
        EEP_EXPERIMENT_REPETITIONS: '1',
      }),
    ).toEqual({ taskIds: ['debugging-01'], conditionNames: ['native', 'ecc'], repetitions: 1 });
  });
});
