import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVICE_NAME = 'orders-service';
const LOCK_FILE = path.join(os.tmpdir(), `${SERVICE_NAME}-swagger.lock`);
const SWAGGER_OPEN_TTL_MS = 5 * 60_000;
const ENV_FILE = path.resolve(process.cwd(), '.env');

function loadLocalEnv(): void {
  if (!fs.existsSync(ENV_FILE)) return;

  const lines = fs.readFileSync(ENV_FILE, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    const value = rawValue.trim().replace(/^(['"])(.*)\1$/, '$2');
    process.env[key] = value;
  }
}

loadLocalEnv();

function shouldAutoOpenSwagger(): boolean {
  if (process.env.SWAGGER_AUTO_OPEN === 'false') {
    return false;
  }

  return process.env.NODE_ENV === 'development' || process.env.SWAGGER_AUTO_OPEN === 'true';
}

function isBrowserRunning(): boolean {
  try {
    if (process.platform === 'win32') {
      const out = execSync('tasklist /nh', {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true,
      });
      return /chrome\.exe|msedge\.exe|firefox\.exe|brave\.exe|opera\.exe/i.test(out);
    }
    const out = execSync('ps aux', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return /Google Chrome|Safari|firefox|Brave Browser|Chromium/i.test(out);
  } catch {
    return false;
  }
}

function openBrowser(url: string): void {
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`, { windowsHide: true });
  } else if (process.platform === 'darwin') {
    exec(`open "${url}"`);
  } else {
    exec(`xdg-open "${url}"`);
  }
}

function openSwaggerIfBrowserOpen(url: string): void {
  if (fs.existsSync(LOCK_FILE)) {
    try {
      const { timestamp } = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf-8')) as {
        timestamp: number;
      };
      if (Date.now() - timestamp < SWAGGER_OPEN_TTL_MS) {
        return;
      }
    } catch {
      // lock file corrupted or old format — proceed
    }
  }

  if (!isBrowserRunning()) return;

  fs.writeFileSync(LOCK_FILE, JSON.stringify({ timestamp: Date.now() }), 'utf-8');
  openBrowser(url);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const config = new DocumentBuilder()
    .setTitle('ECIXPRESS Order & Communication')
    .setDescription('Orders, chat and operational tracking API for ECIXPRESS')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  const host = process.env.HOST ?? '0.0.0.0';
  await app.listen(port, host);

  if (shouldAutoOpenSwagger()) {
    openSwaggerIfBrowserOpen(`http://${host ?? 'localhost'}:${port}/api`);
  }
}
bootstrap();
