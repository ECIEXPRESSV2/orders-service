import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';
import { buildTypeOrmOptions } from './typeorm.options';

// El CLI de TypeORM se ejecuta fuera del contexto de NestJS, por lo que
// cargamos el .env manualmente antes de construir el DataSource.
dotenv.config();

const dataSource = new DataSource(buildTypeOrmOptions());

export default dataSource;
