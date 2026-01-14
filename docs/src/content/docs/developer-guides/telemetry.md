---
title: Telemetry
description: Notes about the telemetry functionality that is within Synapse.
---

To help maintainers validate functionality and iron out problems throughout the whole Filecoin Onchain Cloud stack, starting from the SDK, maintainer telemetry can be opted into.  We are currently leveraging sentry.io as discussed in [issue #328](https://github.com/FilOzone/synapse-sdk/issues/328).

## How to enable telemetry

There are multiple ways to enable Synapse telemetry:

1) Via Synapse Config:

```ts
const synapse = await Synapse.create({
  /* ...existing options... */
  telemetry : { sentryInitOptions : { enabled: false } },
})
```

1) Set the environment variable `SYNAPSE_TELEMETRY_ENABLED=true` before instantiating Synapse.

2) Set `globalThis.SYNAPSE_TELEMETRY_ENABLED=true` before instantiating Synapse.

## What can be collected and why

When enabled, all HTTP calls are being instrumented (except for static assets like JS, CSS, and images), even HTTP calls that originate from outside of Synapse.  This was the quickest way to ensure we captured the information we are after.

The primary information we are attempting to collect is HTTP request paths, response status codes, and request/response latencies to RPC providers and Service Providers (SPs).  Non 200 responses or "slow" responses may indicate issues in Synapse or the backend SP software, or general operational issues with RPC providers or SPs.  These are issues we want to be aware of so we can potentially fix or improve.

When enabled, we also capture general uncaught errors.  This could be indicative of issues in Synapse, which we'd want to fix.

Even if enabled, we are not capturing:

- Personal identifiable information (PII).  We explicitly [disable sending default PII to Sentry](https://docs.sentry.io/platforms/javascript/configuration/options/#sendDefaultPii).
- Metrics on static asset (e.g., CSS, JS, image) retrieval.  

(One can verify these claims in [telemetry/service.ts](https://github.com/FilOzone/synapse-sdk/blob/master/packages/synapse-sdk/src/telemetry/service.ts).)

## Why is telemetry collecting happening in a library like Synapse

Collecting telemetry through Synapse with [issue #328](https://github.com/FilOzone/synapse-sdk/issues/328) is done as short a term dev-resource efficient decision.  In this season of focusing on stability, the goal is to capture request failures and other client-side errors as broadly and quickly as possible so we have an enumeration of the problems and their impact.  By setting up telemetry at the Synapse layer, we can broadly get telemetry from some of the first consumers by default without requiring extra on them (e.g., filecoin-pin,filecoin-pin-website, synapse demo websites).  This is a short term measure.

## How to configure telemetry

Synapse consumers can pass in any [Sentry options](https://docs.sentry.io/platforms/javascript/configuration/options/) via `Synapse.create({telemetry : { sentryInitOptions : {...} },})`.

Synapse default Sentry options are applied in [src/telemetry/service.ts] whenever not explicitly set by the user.  

Any explicit tags to add to all Sentry calls can be added with `Synapse.create({telemetry : { sentrySetTags : {...} },})`.

One also has direct access to the Sentry instance that Synapse is using via `synapse.telemetry.sentry`, at which point any of the [Sentry APIs](https://docs.sentry.io/platforms/javascript/apis/) can be invoked.

## Who has access to the telemetry data

Access is restricted to the Synapse maintainers and product/support personnel actively involved in the Filecoin Onchain Cloud who work with Synapse.
