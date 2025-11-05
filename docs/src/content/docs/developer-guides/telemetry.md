---
title: Telemetry
description: Notes about the telemetry functionality that is within Synapse.
---

To help maintainers validate functionality and iron out problems throughout the whole Filecoin Onchain Cloud stack, starting from the SDK, telemetry is **temporarily enabled by default for the calibration network** in Synapse.  We are currently leveraging sentry.io as discussed in [issue #328](https://github.com/FilOzone/synapse-sdk/issues/328).

### How to disable telemetry

There are multiple ways to disable Synapse telemetry:

1) Via Synapse Config:
```ts
const synapse = await Synapse.create({
  /* ...existing options... */
  telemetry : { sentryInitOptions : { enabled: false } },
})
```

2) Set the environment variable `SYNAPSE_TELEMETRY_DISABLED=true` before instantiating Synapse.

3) Set `globalThis.SYNAPSE_TELEMETRY_DISABLED=true` before instantiating Synapse.

### What is being collected and why

All HTTP calls are being instrumented (except for static assets like JS, CSS, and images), even HTTP calls that originate from outside of Synapse.  This was the quickest way to ensure we captured the information we are after.

The primary information we are attempting to collect is HTTP request paths, response status codes, and request/response latencies to RPC providers and Service Providers (SPs).  Non 200 responses or "slow" responses may indicate issues in Synapse or the backend SP software, or general operational issues with RPC providers or SPs.  These are issues we want to be aware of so we can potentially fix or improve.

We also capture general uncaught errors.  This could be indicative of issues in Synapse, which we'd want to fix.

We are not capturing:
- Personal identifiable information (PII).  We explicitly [disable sending default PII to Sentry](https://docs.sentry.io/platforms/javascript/configuration/options/#sendDefaultPii).
- Metrics on static asset (e.g., CSS, JS, image) retrieval.  

(One can verify these claims in [telemetry/service.ts](https://github.com/FilOzone/synapse-sdk/blob/master/packages/synapse-sdk/src/telemetry/service.ts).)

### Why is telemetry collecting happening a library like Synapse
Collecting telemetry through Synapse with [issue #328](https://github.com/FilOzone/synapse-sdk/issues/328) is done as short a term dev-resource efficient decision.  In this season of focusing on stability, the goal is to capture request failures and other client-side errors as broadly and quickly as possible so we have an enumeration of the problems and their impact.  By setting up telemetry at the Synapse layer, we can broadly get telemetry from some of the first consumers by default without requiring extra on them (e.g., filecoin-pin,filecoin-pin-website, synapse demo websites).  This is a short term measure.

### How long will Synapse collect telemetry
This broad telemetry at the library/SDK layer will be removed by GA (by end of November 2025).  At that point, we'll do one or more of the following:
1. Reduce telemetry collecting to only be for calls originating from Synapse (not all HTTP calls),
2. Switch the default to opt-in vs. opt-out like it is currently.  (Note that currently we only enable telemetry by default for the calibration network.  We don't enable it by default for mainnet.)
3. Remove telemetry entirely out of Synapse, and instead require applications (e.g., filecoin-pin, filecoin-pin-website) to do their telemetry collecting.
The tracking issue for this cleanup is [issue #363](https://github.com/FilOzone/synapse-sdk/issues/363).

### How to configure telemetry
Synapse consumers can pass in any [Sentry options](https://docs.sentry.io/platforms/javascript/configuration/options/) via `Synapse.create({telemetry : { sentryInitOptions : {...} },})`.

Synapse default Sentry options are applied in [src/telemetry/service.ts] whenever not explicitly set by the user.  

Any explicit tags to add to all Sentry calls can be added with `Synapse.create({telemetry : { sentrySetTags : {...} },})`.

One also has direct access to the Sentry instance that Synapse is using via `synapse.telemetry.sentry`, at which point any of the [Sentry APIs](https://docs.sentry.io/platforms/javascript/apis/) can be invoked.

### Who has access to the telemetry data
Access is restricted to the Synapse maintainers and product/support personnel actively involved in the Filecoin Onchain Cloud who work with Synapse.