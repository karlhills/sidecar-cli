import { stringifyJson } from './format.js';

export interface JsonCommandEnvelope<T = unknown> {
  ok: boolean;
  command: string;
  data: T | null;
  errors: string[];
}

export function jsonSuccess<T>(command: string, data: T): JsonCommandEnvelope<T> {
  return {
    ok: true,
    command,
    data,
    errors: [],
  };
}

export function jsonFailure(command: string, message: string): JsonCommandEnvelope<null> {
  return {
    ok: false,
    command,
    data: null,
    errors: [message],
  };
}

export function printJsonEnvelope<T>(payload: JsonCommandEnvelope<T>): void {
  console.log(stringifyJson(payload));
}
