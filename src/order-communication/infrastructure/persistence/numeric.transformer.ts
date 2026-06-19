import { ValueTransformer } from 'typeorm';

/**
 * Postgres devuelve `bigint` como string en node-postgres. Este transformer
 * convierte los montos (almacenados en centavos COP) entre `bigint` en la DB y
 * `number` en el dominio.
 */
export const bigintCentavosTransformer: ValueTransformer = {
  to: (value?: number | null): number | null => (value === undefined || value === null ? null : Math.round(value)),
  from: (value?: string | null): number => (value === undefined || value === null ? 0 : parseInt(value, 10)),
};
