import { stringifyJson } from './format.js';

export const JSON_CONTRACT_VERSION = '1.0';

export interface JsonCommandEnvelope<T = unknown> {
  ok: boolean;
  version: string;
  command: string;
  data: T | null;
  errors: string[];
}

export function jsonSuccess<T>(command: string, data: T): JsonCommandEnvelope<T> {
  return {
    ok: true,
    version: JSON_CONTRACT_VERSION,
    command,
    data,
    errors: [],
  };
}

export function jsonFailure(command: string, message: string): JsonCommandEnvelope<null> {
  return {
    ok: false,
    version: JSON_CONTRACT_VERSION,
    command,
    data: null,
    errors: [message],
  };
}

export function printJsonEnvelope<T>(payload: JsonCommandEnvelope<T>): void {
  console.log(stringifyJson(payload));
}
