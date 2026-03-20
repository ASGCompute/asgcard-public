# Stripe Interop - Moving an MPP Flow to Stellar

If the user already has an MPP flow on Stripe, do not redesign the protocol first. Preserve the high-level contract and swap the settlement rail underneath it.

## What Stays The Same

- the protected resource still returns `402 Payment Required`
- the challenge still describes what must be paid
- the client still responds with a `Payment` credential
- the server still verifies payment before unlocking the action

## What Changes

| Stripe MPP | Stellar MPP |
|------------|-------------|
| `PaymentIntent` or shared payment token | SAC transfer or channel commitment |
| Stripe verifies payment state | the server verifies on-chain payment or channel signature |
| USD card rail | Stellar asset rail |
| network fees are part of Stripe economics | network and sponsorship model must be explicit |

## Practical Migration Rule

Refactor the server into two layers:

1. **Protocol layer**: issue challenge, parse credential, handle `402`
2. **Settlement layer**: verify Stripe or Stellar payment proof

That lets you keep the same MPP surface while adding a new method backend.

## Replay And Side Effects

Do not treat "a payment once succeeded" as enough authorization for unlimited business actions.

Always do both:

- bind the payment proof to the exact action context being unlocked
- consume the payment proof exactly once before the side effect runs

Good server keys for one-time consumption include:

- on-chain transaction hash
- challenge id plus payment proof id
- channel id plus latest accepted cumulative amount

## Recommendation For ASG-Style Flows

If the action creates value off-chain, such as issuing a card or provisioning a credential:

- keep the MPP challenge stateless if you want
- make the business side effect stateful and one-time
- persist a concrete consumed payment reference before minting the asset

That keeps a Stellar MPP rollout aligned with the hard lessons from Stripe MPP beta work.
