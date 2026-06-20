import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as amqp from 'amqplib';

/**
 * Gestiona la conexión y el canal a RabbitMQ (CloudAMQP). Declara el exchange
 * topic compartido `eciexpress_events` y expone publish/consume.
 */
@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RabbitMQService.name);
  private connection?: amqp.ChannelModel;
  private channel?: amqp.Channel;
  private ready = false;
  private connecting?: Promise<void>;

  private get url(): string {
    return process.env.RABBITMQ_URL ?? 'amqp://guest:guest@localhost:5672';
  }

  get exchange(): string {
    return process.env.RABBITMQ_EXCHANGE ?? 'eciexpress_events';
  }

  get queue(): string {
    return process.env.RABBITMQ_QUEUE ?? 'orders_service_queue';
  }

  isReady(): boolean {
    return this.ready && !!this.channel;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      // No bloqueamos el arranque si el broker no está disponible; el worker y
      // el consumer reintentarán.
      this.logger.error(`No se pudo conectar a RabbitMQ al iniciar: ${(error as Error).message}`);
    }
  }

  async connect(): Promise<void> {
    if (this.isReady()) return;
    // Mutex: evita conexiones concurrentes duplicadas (worker + consumer + publish).
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async doConnect(): Promise<void> {
    this.connection = await amqp.connect(this.url);
    this.connection.on('error', (err) => this.logger.error(`RabbitMQ connection error: ${err.message}`));
    this.connection.on('close', () => {
      this.ready = false;
      this.logger.warn('RabbitMQ connection closed');
    });
    this.channel = await this.connection.createChannel();
    await this.channel.assertExchange(this.exchange, 'topic', { durable: true });
    this.ready = true;
    this.logger.log(`Conectado a RabbitMQ; exchange '${this.exchange}' listo`);
  }

  /** Publica un mensaje persistente en el exchange topic. */
  async publish(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.isReady()) {
      await this.connect();
    }
    const ok = this.channel!.publish(
      this.exchange,
      routingKey,
      Buffer.from(JSON.stringify(payload)),
      { persistent: true, contentType: 'application/json' },
    );
    if (!ok) {
      throw new Error('RabbitMQ publish buffer full');
    }
  }

  /** Declara la cola del servicio, la enlaza a las routing keys y consume. */
  async consume(
    bindings: string[],
    handler: (routingKey: string, content: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.isReady()) {
      await this.connect();
    }
    const channel = this.channel!;
    await channel.assertQueue(this.queue, { durable: true });
    for (const pattern of bindings) {
      await channel.bindQueue(this.queue, this.exchange, pattern);
    }
    await channel.prefetch(10);
    await channel.consume(this.queue, (msg) => {
      if (!msg) return;
      const routingKey = msg.fields.routingKey;
      let content: Record<string, unknown> = {};
      try {
        content = JSON.parse(msg.content.toString());
      } catch {
        this.logger.warn(`Mensaje no-JSON en ${routingKey}; descartado`);
        channel.ack(msg);
        return;
      }
      handler(routingKey, content)
        .then(() => channel.ack(msg))
        .catch((error) => {
          // Ack para evitar poison-message loops; el error queda registrado.
          this.logger.error(`Error procesando ${routingKey}: ${(error as Error).message}`);
          channel.ack(msg);
        });
    });
    this.logger.log(`Consumiendo '${this.queue}' con bindings: ${bindings.join(', ')}`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch {
      // ignore
    }
  }
}
