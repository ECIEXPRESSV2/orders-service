import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { execSync, exec } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SERVICE_NAME = 'orders-service';
const LOCK_FILE = path.join(os.tmpdir(), `${SERVICE_NAME}-swagger.lock`);
const SWAGGER_OPEN_TTL_MS = 5 * 60_000;

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

  const config = new DocumentBuilder()
    .setTitle('ECIXPRESS Order & Communication')
    .setDescription('Orders, chat and operational tracking API for ECIXPRESS')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);

  if (shouldAutoOpenSwagger()) {
    openSwaggerIfBrowserOpen(`http://localhost:${port}/api`);
  }
}
bootstrap();
