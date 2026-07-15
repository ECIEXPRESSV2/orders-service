import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DefaultAzureCredential } from '@azure/identity';
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  UserDelegationKey,
} from '@azure/storage-blob';

/** Parámetros para subir un blob y obtener su URL firmada. */
export interface UploadWithSasInput {
  container: string;
  blobName: string;
  content: Buffer;
  contentType: string;
  /** Vida del SAS de lectura en minutos. */
  ttlMinutes: number;
}

/**
 * Acceso a Azure Blob Storage con Managed Identity (`DefaultAzureCredential`), igual que en
 * fulfillment-service. Sube al contenedor privado compartido `orders` (evidencia de reembolsos
 * en `<orderId>/refunds/<refundId>/...`; fulfillment sube ahí mismo los QR en `<orderId>/qr/...`)
 * y devuelve una **user-delegation SAS URL** de solo lectura y expiración corta: nunca se expone
 * la account key ni se hace público el contenedor.
 *
 * Requiere que la identidad tenga el rol **Storage Blob Data Contributor** sobre la cuenta.
 * Si `AZURE_STORAGE_ACCOUNT` no está configurada, `enabled` es `false`.
 */
@Injectable()
export class BlobStorageService {
  private readonly logger = new Logger(BlobStorageService.name);
  private readonly account?: string;
  private client?: BlobServiceClient;
  private delegationKey?: { key: UserDelegationKey; expiresOn: Date };
  private keyFetchInFlight: Promise<UserDelegationKey> | null = null;

  constructor(private readonly config: ConfigService) {
    this.account = this.config.get<string>('AZURE_STORAGE_ACCOUNT') || undefined;
  }

  /** `true` si hay cuenta configurada y por tanto se puede subir a blob. */
  get enabled(): boolean {
    return Boolean(this.account);
  }

  private getClient(): BlobServiceClient {
    if (!this.client) {
      this.client = new BlobServiceClient(
        `https://${this.account}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
    }
    return this.client;
  }

  /**
   * Sube (o sobrescribe) un blob y devuelve su URL con SAS de lectura. Crea el contenedor si no
   * existe (queda PRIVADO: sin `access`, ninguna lectura anónima).
   */
  async uploadWithReadSas(input: UploadWithSasInput): Promise<string> {
    if (!this.enabled) {
      throw new Error('BlobStorageService deshabilitado: falta AZURE_STORAGE_ACCOUNT');
    }
    const service = this.getClient();
    const containerClient = service.getContainerClient(input.container);
    await containerClient.createIfNotExists();
    const blob = containerClient.getBlockBlobClient(input.blobName);

    await blob.uploadData(input.content, {
      blobHTTPHeaders: { blobContentType: input.contentType },
    });

    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + input.ttlMinutes * 60 * 1000);
    const key = await this.getDelegationKey(startsOn, expiresOn);

    const sas = generateBlobSASQueryParameters(
      {
        containerName: input.container,
        blobName: input.blobName,
        permissions: BlobSASPermissions.parse('r'),
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
      },
      key,
      this.account!,
    ).toString();

    return `${blob.url}?${sas}`;
  }

  /**
   * Lista los blobs bajo `prefix` y devuelve una URL con SAS de lectura (corta) para cada uno.
   * No persistimos URLs firmadas en ningún lado (una user-delegation key vive máx. 7 días en
   * Azure): esto se llama cada vez que alguien abre el detalle de la evidencia, así siempre
   * devuelve tokens frescos.
   */
  async listWithReadSas(container: string, prefix: string, ttlMinutes: number): Promise<string[]> {
    if (!this.enabled) return [];
    const containerClient = this.getClient().getContainerClient(container);
    const names: string[] = [];
    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
      names.push(blob.name);
    }
    if (names.length === 0) return [];

    const startsOn = new Date(Date.now() - 5 * 60 * 1000);
    const expiresOn = new Date(Date.now() + ttlMinutes * 60 * 1000);
    const key = await this.getDelegationKey(startsOn, expiresOn);

    return names.map((blobName) => {
      const blob = containerClient.getBlockBlobClient(blobName);
      const sas = generateBlobSASQueryParameters(
        {
          containerName: container,
          blobName,
          permissions: BlobSASPermissions.parse('r'),
          startsOn,
          expiresOn,
          protocol: SASProtocol.Https,
        },
        key,
        this.account!,
      ).toString();
      return `${blob.url}?${sas}`;
    });
  }

  private async getDelegationKey(startsOn: Date, expiresOn: Date): Promise<UserDelegationKey> {
    const cached = this.delegationKey;
    if (cached && cached.expiresOn > expiresOn) {
      return cached.key;
    }
    if (!this.keyFetchInFlight) {
      const keyExpiry = new Date(expiresOn.getTime() + 60 * 60 * 1000);
      this.keyFetchInFlight = this.getClient()
        .getUserDelegationKey(startsOn, keyExpiry)
        .then((key) => {
          this.delegationKey = { key, expiresOn: keyExpiry };
          return key;
        })
        .finally(() => {
          this.keyFetchInFlight = null;
        });
    }
    return this.keyFetchInFlight;
  }
}
