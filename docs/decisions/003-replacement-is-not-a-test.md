# 003 — Replacing a part is never a diagnostic step

**Decided:** 16 Sep 2026, after watching the thing run end to end in a terminal.

## What happened

The demo printed this as its second question:

> *"Replace the drain pump if it does not turn — did that fix it?"*

Every piece of that sentence is defensible in isolation. The manual lists replacing the pump as a
remedy for that fault. The parser turned each remedy into a check. Information gain scored it highly,
because it splits the hypothesis space cleanly.

And the result is a machine asking someone to **buy a part and fit it in order to find out whether
they needed it** — which is the exact behaviour this project exists to argue against, arrived at
honestly, one reasonable step at a time.

## Why it happened

The fault graph conflated two different things that a manual writes identically:

- a **check** — something you do to learn which cause is real
- a **remedy** — something you do once you know

`effortOf()` scored "replace the drain pump" as `easy`, because it did not mention pulling the
machine out or opening the base. It is trivial in body movement and enormous in money.

## The decision

Effort is what it costs the **person**, and that includes their wallet. Anything matching
*replace, renew, fit a new, install a new, swap out* is the most expensive tier there is, so
information gain has to exhaust every free look and cheap check before it reaches for one.

A test now holds the line: given a fault whose manual lists a cheap check and a replacement, the
first question must not be the replacement.

## What this generalises to

Effort is not physical difficulty. It is everything the question costs the person to answer —
money, time, risk, and dignity. A check that is physically trivial but financially irreversible is
an expensive question, and the scoring function has to know that or it will confidently walk someone
into a purchase they did not need.

## How it was found

Not by a test. By running the whole thing in a terminal and reading what it said out loud. The unit
tests were all green while this was happening, because every component was behaving exactly as
specified — the mistake was in what we had specified, and only the full sentence made it visible.
