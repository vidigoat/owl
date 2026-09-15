# 001 — Refuse rather than guess

**Decided:** 15 Sep 2026. **Status:** load-bearing. This is the product.

## The choice

When the evidence does not clearly separate the possible causes, the copilot can either name its best
guess or decline. It declines, and offers to book a technician.

## Why

Every "snap a photo of your broken thing" app already guesses, and they are confidently wrong in a way
that costs money — you buy a $180 part for a fault that was a $0 blockage, or you take apart something
with mains voltage in it on the strength of a plausible sentence.

The moment this thing asks someone to spend money, it has taken on a duty it cannot discharge with a
probability. So the rule is narrow and absolute: a cause has to be upheld against service data for that
specific model before it can be spoken as a fact or attached to a purchase.

There is a second reason. A voice in your kitchen that is occasionally, invisibly wrong is not a product
people keep using. Refusing once, clearly, buys more trust than fifty smooth answers.

## What it costs

Coverage. There will be faults it cannot resolve, and it will hand those to a human. We are content
with that: the win is the third of service calls that are genuinely simple, plus the ones where it
correctly says "not this time."

## How it shows up in the product

- `verify_diagnosis` is the only function allowed to authorise spending.
- Causes involving mains voltage escalate to a technician regardless of confidence.
- The interface has a button that demonstrates the refusal, because the refusal is the differentiator.
- Nothing is sold on an unverified cause, even when the user asks for it directly.

## What would overturn this

Nothing about demo smoothness. Only better evidence — richer per-model service data would move faults
from "refuse" to "upheld", which is an improvement in coverage, not a relaxation of the gate.
