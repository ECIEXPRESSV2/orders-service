import { join } from 'path';
import { DataSourceOptions } from 'typeorm';

/**
 * Opciones de TypeORM compartidas por la aplicación NestJS y por el CLI de
 * migraciones (data-source.ts). Se leen desde variables de entorno para
 * mantener una única fuente de verdad.
 *
 * Los globs `{.ts,.js}` permiten que funcionen tanto con ts-node (CLI de
 * migraciones / dev) como con el build compilado a `dist`.
 */
export function buildTypeOrmOptions(): DataSourceOptions {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL no está definida. Configúrala en .env');
  }

  const isProd = process.env.NODE_ENV === 'production';

  return {
    type: 'postgres',
    url,
    // Neon exige SSL; rejectUnauthorized=false evita problemas con la cadena
    // de certificados del pooler.
    ssl: { rejectUnauthorized: false },
    entities: [join(__dirname, '/../**/*.entity{.ts,.js}')],
    migrations: [join(__dirname, '/../migrations/*{.ts,.js}')],
    // Nunca sincronizamos el esquema automáticamente: se usan migraciones.
    synchronize: false,
    logging: isProd ? ['error'] : ['error', 'warn'],
  };
}
