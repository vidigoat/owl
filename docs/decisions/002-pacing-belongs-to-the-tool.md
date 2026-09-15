# 002 — Pacing belongs to the tool, not the interface

**Decided:** 15 Sep 2026, while wiring the device to the real tools.

## The thing that was wrong

The steps on the device screen were a list in the front-end. They read well, but they were a
description of a repair rather than the output of one. Two problems follow from that.

The first is honesty: a reviewer looking at the repository would find the tool table in the README
promising a `guide` tool, and the actual words on screen coming from somewhere else entirely.

The second is subtler and matters more. If the steps live in the interface, the interface decides how
long each one takes — which in practice means it does not decide at all, and the copilot talks at you
at a constant rate. But this product's whole claim is that it works while your hands are inside a
machine. The gap between "twist the filter out" (twelve seconds) and "clear the well and rinse it"
(forty) is the difference between a companion and a podcast.

## The decision

`guide` returns a `pace` for every step, in seconds, and the device waits that long. Pacing is part of
the repair procedure, so it lives with the procedure, in the tool, per model and per cause.

The same rule applied to the price: `find_part` returns the part, the alternative, and the saving. The
`$38.42` on screen is whatever that tool said, and if the catalogue cannot verify a part for the model,
the screen has nothing to show — which is correct.

## The general rule

The front-end renders. It does not know anything. Every fact on the device screen — the model number,
the fault, the verdict, the steps, the price — comes from a tool that could be called by Alexa+
instead, and the screen would be none the wiser. That is the test for whether this is a real add-on or
a picture of one.
