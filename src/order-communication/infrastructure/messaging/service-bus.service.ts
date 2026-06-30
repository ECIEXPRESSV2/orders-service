import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  ServiceBusClient,
  ServiceBusSender,
  ServiceBusReceiver,
  ServiceBusReceivedMessage,
  ProcessErrorArgs,
} from '@azure/service-bus';
import { DefaultAzureCredential } from '@azure/identity';

/**
 * Gestiona la conexión a Azure Service Bus (Managed Identity / DefaultAzureCredential).
 * Expone la misma API que el antiguo RabbitMQService (publish/consume) para no tocar al
 * consumer ni al worker de outbox.
 *
 * - publish(routingKey, payload): envía al topic compartido con subject = routingKey.
 * - consume(bindings, handler): abre un receiver sobre la subscription propia. Los
 *   `bindings` (patrones de routing-key) ya NO se aplican aquí: el filtro por dominio
 *   vive en la regla SQL de la subscription (Terraform). Se conservan en la firma por
 *   compatibilidad y se loguean.
 */
@Injectable()
export class ServiceBusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ServiceBusService.name);
  private client?: ServiceBusClient;
  private sender?: ServiceBusSender;
  private receiver?: ServiceBusReceiver;

  private get fqns(): string {
    const v = process.env.SERVICE_BUS_FULLY_QUALIFIED_NAMESPACE;
    if (!v) throw new Error('SERVICE_BUS_FULLY_QUALIFIED_NAMESPACE no configurado');
    return v;
  }

  get topic(): string {
    return process.env.SERVICE_BUS_TOPIC ?? 'eciexpress_events';
  }

  get subscription(): string {
    return process.env.SERVICE_BUS_SUBSCRIPTION ?? 'orders-service';
  }

  isReady(): boolean {
    return !!this.client;
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.connect();
    } catch (error) {
      // No bloqueamos el arranque; el worker y el consumer reintentarán.
      this.logger.error(
        `No se pudo inicializar Service Bus al iniciar: ${(error as Error).message}`,
      );
    }
  }

  async connect(): Promise<void> {
    if (this.client) return;
    const connStr = process.env.SERVICE_BUS_CONNECTION_STRING;
    this.client = connStr
      ? new ServiceBusClient(connStr)
      : new ServiceBusClient(this.fqns, new DefaultAzureCredential());
    this.sender = this.client.createSender(this.topic);
    this.logger.log(`Conectado a Service Bus; topic '${this.topic}' listo`);
  }

  /** Publica un mensaje en el topic compartido (subject = routingKey). */
  async publish(routingKey: string, payload: Record<string, unknown>): Promise<void> {
    if (!this.sender) {
      await this.connect();
    }
    await this.sender!.sendMessages({
      body: payload,
      subject: routingKey,
      applicationProperties: { routingKey },
      contentType: 'application/json',
    });
  }

  /** Abre el receiver de la subscription propia y despacha cada mensaje al handler. */
  async consume(
    bindings: string[],
    handler: (routingKey: string, content: Record<string, unknown>) => Promise<void>,
  ): Promise<void> {
    if (!this.client) {
      await this.connect();
    }
    this.receiver = this.client!.createReceiver(this.topic, this.subscription);

    this.receiver.subscribe({
      processMessage: async (msg: ServiceBusReceivedMessage) => {
        const routingKey = (
          msg.subject ??
          (msg.applicationProperties?.routingKey as string | undefined) ??
          ''
        ).toString();
        const content = (
          typeof msg.body === 'object' && msg.body !== null ? msg.body : {}
        ) as Record<string, unknown>;
        try {
          await handler(routingKey, content);
        } catch (error) {
          // Se completa igualmente para evitar poison-message loops (igual que el ack
          // del consumer anterior); el error queda registrado.
          this.logger.error(
            `Error procesando ${routingKey}: ${(error as Error).message}`,
          );
        }
      },
      processError: async (args: ProcessErrorArgs) => {
        this.logger.error(
          `Error en el receiver de Service Bus (${args.entityPath}): ${args.error.message}`,
        );
      },
    });

    this.logger.log(
      `Consumiendo subscription '${this.subscription}' (bindings declarados: ${bindings.join(', ')})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.receiver?.close();
      await this.sender?.close();
      await this.client?.close();
    } catch {
      // ignore
    }
  }
}
