/**
 * Puerto de publicación de eventos de dominio. La capa de aplicación lo usa para
 * emitir eventos sin conocer la infraestructura (outbox/RabbitMQ).
 */
export interface EventPublisher {
  /** Encola un evento de dominio para su publicación garantizada (outbox). */
  publish(routingKey: string, payload: Record<string, unknown>): Promise<void>;
}

export const EVENT_PUBLISHER = Symbol('EVENT_PUBLISHER');
