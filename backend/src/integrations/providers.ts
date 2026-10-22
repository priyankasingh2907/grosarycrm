export interface PaymentRequest {
  orderId: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentProvider {
  createPayment(request: PaymentRequest): Promise<{ providerReference: string; checkoutUrl?: string }>;
  verifyWebhook(payload: Buffer, signature: string): Promise<boolean>;
}

export interface MessageProvider {
  sendMessage(to: string, template: string, variables: Record<string, string>): Promise<{ providerReference: string }>;
}

export interface InvoiceRenderer {
  renderInvoice(invoiceId: string): Promise<Buffer>;
}

// Provider adapters must validate webhook signatures and keep secrets in environment configuration.
