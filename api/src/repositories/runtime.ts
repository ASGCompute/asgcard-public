import { InMemoryCardRepository } from "./inMemoryCardRepo";
import { InMemoryPaymentRepository } from "./inMemoryPaymentRepo";

// Runtime repository bindings.
// Swap these with DB-backed implementations when wiring Postgres.
export const cardRepository = new InMemoryCardRepository();
export const paymentRepository = new InMemoryPaymentRepository();

