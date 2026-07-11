/**
 * Cotización de comisiones de una tienda para la factura del carrito. financial-service
 * es la fuente de verdad de la comisión de hora pico (franja + recargo) y de si el momento
 * actual cae en hora pico. orders-service la consulta al cotizar para que el total de la
 * factura coincida con lo que financial va a debitar de la billetera.
 */
export interface CommissionQuote {
  /** Recargo de hora pico en centavos COP (0 si no aplica). */
  peakFeeAmount: number;
  /** true si el momento actual cae en la franja de hora pico de la tienda. */
  isPeakHour: boolean;
  /** Porcentaje de recargo de hora pico configurado (informativo). */
  peakFeePercent: number;
}

/**
 * Puerto hacia financial-service. `orderAmount` va en centavos COP (subtotal ya con
 * promociones y descuentos aplicados). Nunca debe hacer fallar la cotización del carrito:
 * ante un error devuelve un recargo de cero (el cobro real lo recalcula financial).
 */
export interface FinancialPort {
  getCommission(storeId: string, orderAmount: number): Promise<CommissionQuote>;
}

export const FINANCIAL_PORT = Symbol('FINANCIAL_PORT');
