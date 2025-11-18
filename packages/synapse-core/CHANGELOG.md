# Changelog

## [0.1.3](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.1.2...synapse-core-v0.1.3) (2025-11-17)


### Features

* streaming upload support ([9510752](https://github.com/FilOzone/synapse-sdk/commit/95107525d2dc71590cfbe07ab9d53f59fe44252f))


### Bug Fixes

* error outputs out of lotus are weird ([#411](https://github.com/FilOzone/synapse-sdk/issues/411)) ([341eeff](https://github.com/FilOzone/synapse-sdk/commit/341eeff0692b768e7a8cf99c74511df58e719192))


### Chores

* plumb AbortSignal through upload flow, address feedback ([077fc92](https://github.com/FilOzone/synapse-sdk/commit/077fc921a9522e6aafd8625c4b415f0031ad1a23))
* update calibnet SessionKeyRegistry address ([#431](https://github.com/FilOzone/synapse-sdk/issues/431)) ([3137130](https://github.com/FilOzone/synapse-sdk/commit/3137130d2daf816739f51c30df372b31ba62668f))
* update deps ([#432](https://github.com/FilOzone/synapse-sdk/issues/432)) ([6a9205b](https://github.com/FilOzone/synapse-sdk/commit/6a9205beede7b425469608980d2500c16884aa08))

## [0.1.2](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.1.1...synapse-core-v0.1.2) (2025-11-04)


### Features

* update FWSS Mainnet addresses ([2b9a17c](https://github.com/FilOzone/synapse-sdk/commit/2b9a17c1e035fa5d7896d42e3d84e34fc33b319d))
* update FWSS Mainnet addresses ([#391](https://github.com/FilOzone/synapse-sdk/issues/391)) ([2b9a17c](https://github.com/FilOzone/synapse-sdk/commit/2b9a17c1e035fa5d7896d42e3d84e34fc33b319d))


### Chores

* fix docs ([#397](https://github.com/FilOzone/synapse-sdk/issues/397)) ([196e735](https://github.com/FilOzone/synapse-sdk/commit/196e7352c982d90553f5b186acfdb724077b8a26))
* simplify linting and make sure git hook works ([#394](https://github.com/FilOzone/synapse-sdk/issues/394)) ([ee8a83d](https://github.com/FilOzone/synapse-sdk/commit/ee8a83d5b737eabb6dec5d9c0f821ea6370f2496))

## [0.1.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.1.0...synapse-core-v0.1.1) (2025-11-03)


### Bug Fixes

* core abis in sdk ([#372](https://github.com/FilOzone/synapse-sdk/issues/372)) ([2b70909](https://github.com/FilOzone/synapse-sdk/commit/2b709094ae4a6b96c2fd7e5d6400ff79ecd5bb7f))


### Chores

* convert fwss tests to jsonrpc mocks ([#384](https://github.com/FilOzone/synapse-sdk/issues/384)) ([947c25e](https://github.com/FilOzone/synapse-sdk/commit/947c25e83d4f66709e4b2c7e6a4500c029257a8c))
* **deps-dev:** bump @biomejs/biome from 2.2.7 to 2.3.1 ([#352](https://github.com/FilOzone/synapse-sdk/issues/352)) ([ed8cee6](https://github.com/FilOzone/synapse-sdk/commit/ed8cee6ec505fa188d10d6ae668da24b8d087c08))

## [0.1.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.0.1...synapse-core-v0.1.0) (2025-10-29)


### ⚠ BREAKING CHANGES

* create dataset and add pieces ([#357](https://github.com/FilOzone/synapse-sdk/issues/357))

### Features

* better curio error and polling ([#344](https://github.com/FilOzone/synapse-sdk/issues/344)) ([d4d44c6](https://github.com/FilOzone/synapse-sdk/commit/d4d44c6de5001e4f58eb36753b95904971492ce1)), closes [#331](https://github.com/FilOzone/synapse-sdk/issues/331)
* create dataset and add pieces ([#357](https://github.com/FilOzone/synapse-sdk/issues/357)) ([662904d](https://github.com/FilOzone/synapse-sdk/commit/662904d83ca1e2eac706b9e1ec6d6d0299dbbbba)), closes [#264](https://github.com/FilOzone/synapse-sdk/issues/264)
* delete piece errors ([#354](https://github.com/FilOzone/synapse-sdk/issues/354)) ([f57cc6a](https://github.com/FilOzone/synapse-sdk/commit/f57cc6af41086694b21289cba78ed1c11ae7360a))
* reset versioning to continue 0.x development ([ce58d21](https://github.com/FilOzone/synapse-sdk/commit/ce58d215492a8a80f836d9451655b8b70d680f2a))
* **ServiceProviderRegistry:** support latest ABI ([#364](https://github.com/FilOzone/synapse-sdk/issues/364)) ([a34dacc](https://github.com/FilOzone/synapse-sdk/commit/a34dacc0ecd470a06bc98148ea9f72cf85caf5ab))
* update to latest abi, including SP registry changes ([#361](https://github.com/FilOzone/synapse-sdk/issues/361)) ([a2c2dea](https://github.com/FilOzone/synapse-sdk/commit/a2c2dea1adc12281d68668e57b4deee22a9827e1))
* use random nonce for AddPieces operations ([80eebea](https://github.com/FilOzone/synapse-sdk/commit/80eebea0c148bbdec9d6e485cf07c40d88009e82))


### Chores

* merge core and react ([#335](https://github.com/FilOzone/synapse-sdk/issues/335)) ([0e0262b](https://github.com/FilOzone/synapse-sdk/commit/0e0262b5a0f5aa7d41b907b5a81dfd7d53c51905))
