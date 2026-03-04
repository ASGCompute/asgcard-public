export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(`API error ${status}`);
    this.status = status;
    this.body = body;
  }
}

export class TimeoutError extends Error {
  constructor(message = "Request timed out") {
    super(message);
  }
}

export class PaymentError extends Error {
  readonly signature?: string;

  constructor(message: string, signature?: string) {
    super(message);
    this.signature = signature;
  }
}

export class InsufficientBalanceError extends Error {
  readonly required: string;
  readonly available: string;

  constructor(required: string, available: string) {
    super(`Insufficient USDC balance. Required: ${required}, available: ${available}`);
    this.required = required;
    this.available = available;
  }
}
