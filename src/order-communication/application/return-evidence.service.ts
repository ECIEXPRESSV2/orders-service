import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ORDER_REPOSITORY } from './ports/order.repository';
import type { OrderRepository } from './ports/order.repository';
import { IDENTITY_PORT } from './ports/identity.port';
import type { IdentityPort } from './ports/identity.port';
import { BlobStorageService } from '../../common/storage/blob-storage.service';

/** Tipo mínimo del archivo que entrega multer (memory storage); evita depender de @types/multer. */
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
  originalname: string;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_FILES = 3;
const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Evidencia fotográfica (RN reembolsos post-recogida): el comprador adjunta hasta 3 fotos al
 * solicitar una devolución sobre un pedido ya entregado, para que la tienda las revise antes de
 * aprobar/rechazar. Vive en el contenedor privado compartido `orders`
 * (`<orderId>/refunds/<refundId>/<n>.<ext>`; fulfillment sube ahí mismo los QR en
 * `<orderId>/qr/...`), accesible solo vía SAS de lectura de corta duración generada al vuelo
 * (nunca se persiste una URL firmada: la user-delegation key de Azure vive máx. 7 días).
 */
@Injectable()
export class ReturnEvidenceService {
  private readonly container: string;

  constructor(
    @Inject(ORDER_REPOSITORY) private readonly orderRepository: OrderRepository,
    @Inject(IDENTITY_PORT) private readonly identity: IdentityPort,
    private readonly blob: BlobStorageService,
    config: ConfigService,
  ) {
    this.container = config.get<string>('AZURE_STORAGE_ORDERS_CONTAINER') || 'orders';
  }

  /** Sube la evidencia del comprador; solo el dueño del pedido puede adjuntarla. */
  async upload(orderId: string, actorId: string, refundId: string, files: UploadedImage[]): Promise<{ urls: string[] }> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    if (order.customerId !== actorId) {
      throw new ForbiddenException('No eres el comprador de este pedido');
    }
    if (!refundId || !/^[a-zA-Z0-9-]{1,64}$/.test(refundId)) {
      throw new BadRequestException('refundId inválido');
    }
    if (!files?.length) {
      throw new BadRequestException('Adjunta al menos una imagen');
    }
    if (files.length > MAX_FILES) {
      throw new BadRequestException(`Máximo ${MAX_FILES} imágenes de evidencia`);
    }
    if (!this.blob.enabled) {
      throw new ServiceUnavailableException('Almacenamiento de evidencia no configurado');
    }

    const urls: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const file = files[i];
      const ext = EXT_BY_MIME[file.mimetype];
      if (!ext) {
        throw new BadRequestException(`Tipo de archivo no permitido: ${file.mimetype}`);
      }
      const url = await this.blob.uploadWithReadSas({
        container: this.container,
        blobName: `${orderId}/refunds/${refundId}/${i}.${ext}`,
        content: file.buffer,
        contentType: file.mimetype,
        ttlMinutes: 60,
      });
      urls.push(url);
    }
    return { urls };
  }

  /** Lista la evidencia de un reembolso (comprador o staff de la tienda del pedido) con SAS fresca. */
  async list(orderId: string, actorId: string, refundId: string): Promise<{ urls: string[] }> {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    const isOwner = order.customerId === actorId;
    if (!isOwner && !(await this.identity.isStoreStaff(order.storeId, actorId))) {
      throw new ForbiddenException('No tienes acceso a la evidencia de este pedido');
    }
    const urls = await this.blob.listWithReadSas(this.container, `${orderId}/refunds/${refundId}/`, 60);
    return { urls };
  }
}

export { MAX_IMAGE_BYTES };
