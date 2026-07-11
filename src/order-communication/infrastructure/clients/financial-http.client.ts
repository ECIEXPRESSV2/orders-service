import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import type { CommissionQuote, FinancialPort } from '../../application/ports/financial.port';

/** Shape de `GET /stores/:storeId/commission` en financial-service (StoreCommissionInfo). */
interface CommissionResponse {
  peakFeeAmount: number;
  isPeakHour: boolean;
  peakFeePercent: number;
}

/**
 * Cliente real hacia financial-service para cotizar la comisión de hora pico de una tienda.
 * Es una llamada servicio-a-servicio DIRECTA (FINANCIAL_SERVICE_URL apunta al servicio, no al
 * gateway). El endpoint de comisión no exige identidad de negocio: recibe el storeId en la ruta.
 *
 * Resiliencia: si financial no responde o la tienda no existe allí, NO se hace fallar la
 * cotización del carrito; se devuelve recargo de cero. El cobro autoritativo lo recalcula
 * financial al procesar `order.created`, así que el peor caso es que el modal no anticipe el
 * recargo (comportamiento previo), nunca un checkout bloqueado.
 */
@Injectable()
export class FinancialHttpClient implements FinancialPort {
  private readonly logger = new Logger(FinancialHttpClient.name);

  private get baseUrl(): string {
    return (process.env.FINANCIAL_SERVICE_URL ?? 'http://localhost:3004').replace(/\/$/, '');
  }

  async getCommission(storeId: string, orderAmount: number): Promise<CommissionQuote> {
    try {
      const { data } = await axios.get<CommissionResponse>(
        `${this.baseUrl}/stores/${storeId}/commission`,
        {
          params: { amount: Math.max(0, Math.round(orderAmount)) },
          timeout: 6000,
          headers: { 'x-user-id': 'orders-service' },
        },
      );
      return {
        peakFeeAmount: Math.max(0, Math.round(data.peakFeeAmount ?? 0)),
        isPeakHour: !!data.isPeakHour,
        peakFeePercent: Number(data.peakFeePercent ?? 0),
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo cotizar la comisión de la tienda ${storeId}; se asume sin recargo. ` +
          `Causa: ${(error as Error).message}`,
      );
      return { peakFeeAmount: 0, isPeakHour: false, peakFeePercent: 0 };
    }
  }
}
