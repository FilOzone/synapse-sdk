# Changelog

## [0.2.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.2.0...synapse-core-v0.2.1) (2026-02-19)


### Bug Fixes

* **metadata:** validate metadata values are strings before length check ([#615](https://github.com/FilOzone/synapse-sdk/issues/615)) ([be6133f](https://github.com/FilOzone/synapse-sdk/commit/be6133f7c9a482ed9e06a0a45418160f13d88f65))
* **pay:** require explicit allowances when approving custom operators ([#616](https://github.com/FilOzone/synapse-sdk/issues/616)) ([b5820c9](https://github.com/FilOzone/synapse-sdk/commit/b5820c9d2b507bbb09d14bc11ad6866097c10b6e))


### Chores

* update biome ([#609](https://github.com/FilOzone/synapse-sdk/issues/609)) ([fe2b365](https://github.com/FilOzone/synapse-sdk/commit/fe2b3651ca17087a6f9ed31216aed64afaa756fa))
* update msw package version to 2.12.10 in workspace and mock service worker files ([#610](https://github.com/FilOzone/synapse-sdk/issues/610)) ([c046b7a](https://github.com/FilOzone/synapse-sdk/commit/c046b7a9e36a1f8e5de2fc70bab2cc203b5ebaa2))

## [0.2.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.1.4...synapse-core-v0.2.0) (2026-02-11)


### ⚠ BREAKING CHANGES

* change params to options object and remove withIpni ([#601](https://github.com/FilOzone/synapse-sdk/issues/601))
* reorganize sp actions
* transition from ethers to viem ([#555](https://github.com/FilOzone/synapse-sdk/issues/555))
* replace `getMaxProvingPeriod()` and `getChallengeWindow()` with `getPDPConfig()` ([#526](https://github.com/FilOzone/synapse-sdk/issues/526))
* use activePieceCount for accurate piece tracking ([#517](https://github.com/FilOzone/synapse-sdk/issues/517))

### refactor

* replace `getMaxProvingPeriod()` and `getChallengeWindow()` with `getPDPConfig()` ([#526](https://github.com/FilOzone/synapse-sdk/issues/526)) ([a4956c7](https://github.com/FilOzone/synapse-sdk/commit/a4956c7d3aa6f78573ed87153da2fcd4b8dc8254))


### Features

* add devnet support ([#527](https://github.com/FilOzone/synapse-sdk/issues/527)) ([773551b](https://github.com/FilOzone/synapse-sdk/commit/773551bf1e9cf4cdc49aeb63a47a81f8dc5cb9e1))
* add the json rpc mock modules ([370b6ed](https://github.com/FilOzone/synapse-sdk/commit/370b6ed02950658a8fe4975565cf91f0ba2d029b))
* change params to options object and remove withIpni ([#601](https://github.com/FilOzone/synapse-sdk/issues/601)) ([0d529e2](https://github.com/FilOzone/synapse-sdk/commit/0d529e269332dc83f0bd43e14fe68f6602c0b90f))
* Endorsements Service ([#553](https://github.com/FilOzone/synapse-sdk/issues/553)) ([fba3280](https://github.com/FilOzone/synapse-sdk/commit/fba328044ec926317f72075ba2dfe611ecd9ba64))
* **examples/cli:** add get-sp-peer-ids command ([#546](https://github.com/FilOzone/synapse-sdk/issues/546)) ([8aafdf1](https://github.com/FilOzone/synapse-sdk/commit/8aafdf1c0b8ba1b729898898aec4aeb47f5ac6a4))
* reorganize sp actions ([929eeaf](https://github.com/FilOzone/synapse-sdk/commit/929eeaf2a4fd5a148fc9fddd6d2846b9552e2016))
* transition from ethers to viem ([#555](https://github.com/FilOzone/synapse-sdk/issues/555)) ([3741241](https://github.com/FilOzone/synapse-sdk/commit/37412415eba0b1204b6b14d00bac68aaf35afca1))
* use activePieceCount for accurate piece tracking ([#517](https://github.com/FilOzone/synapse-sdk/issues/517)) ([59fd863](https://github.com/FilOzone/synapse-sdk/commit/59fd8634c48df588460cf67b8518d81c4c171e4a))


### Bug Fixes

* move default nonces to the sign functions ([9b3f73f](https://github.com/FilOzone/synapse-sdk/commit/9b3f73f5a3478e8757cc6f1898ab591c06ea8bda))
* namespace upload types ([d7b9661](https://github.com/FilOzone/synapse-sdk/commit/d7b9661c8a77f31eb51a6f6bd29a1f104cbfe53a))
* revert back uploads to uint8array and stream ([67a17ee](https://github.com/FilOzone/synapse-sdk/commit/67a17ee8190cf3574bf5f642fa277ff32e01a87e))
* simplify upload input to Blob ([908c042](https://github.com/FilOzone/synapse-sdk/commit/908c0429e0243e1cd4304506fe0f62244fbef494))
* treat status code 202 for findPiece as a retry ([6b9e03f](https://github.com/FilOzone/synapse-sdk/commit/6b9e03f06cd469a0f8365f725881cd87a71f41dc))


### Chores

* add docs build to packages ci ([810d7a8](https://github.com/FilOzone/synapse-sdk/commit/810d7a82a497bb9b2e788333d70a89a607e4db33)), closes [#468](https://github.com/FilOzone/synapse-sdk/issues/468)
* add msw to catalog and add update:msw script ([81f8aa4](https://github.com/FilOzone/synapse-sdk/commit/81f8aa4d4e2860d3a549718f1913c7a9830456b2))
* **docs:** fix code blocks ([b90b3fb](https://github.com/FilOzone/synapse-sdk/commit/b90b3fb0937f14670361e65760b8076f51e663d1))
* improve documentation ([3d536ac](https://github.com/FilOzone/synapse-sdk/commit/3d536acc636229c15351295a7b6cc92f4b3c9484))
* linter ([ac0e76e](https://github.com/FilOzone/synapse-sdk/commit/ac0e76eda0192fbb3be045374bbea2eb6ee63272))
* pnpm security and catalog ([123b89c](https://github.com/FilOzone/synapse-sdk/commit/123b89c178f2597a35168e7ebddb440d1dda0816))
* re-add `getMaxProvingPeriod` and `challengeWindow` function ([#550](https://github.com/FilOzone/synapse-sdk/issues/550)) ([62bb92a](https://github.com/FilOzone/synapse-sdk/commit/62bb92a27401b8fe9e874e124668e2cc0b8c45c4))
* remove outdated NETWORK_FEE mock ([#552](https://github.com/FilOzone/synapse-sdk/issues/552)) ([9f8ea3e](https://github.com/FilOzone/synapse-sdk/commit/9f8ea3ea2f3ebec8cd76b78d389d6f02c2837cb8))
* update docs and export missing types ([8061afb](https://github.com/FilOzone/synapse-sdk/commit/8061afb2ab980b8a25162442f82a047108fd10cc))
* update msw ([#465](https://github.com/FilOzone/synapse-sdk/issues/465)) ([ea02a6d](https://github.com/FilOzone/synapse-sdk/commit/ea02a6dba86ad91a012c4ef6bb167c5fa774cc67))
* update viem/wagmi and markdown lint ([#478](https://github.com/FilOzone/synapse-sdk/issues/478)) ([3f023f6](https://github.com/FilOzone/synapse-sdk/commit/3f023f6bb426a67afca917b73d41ac063d158487))

## [0.1.4](https://github.com/FilOzone/synapse-sdk/compare/synapse-core-v0.1.3...synapse-core-v0.1.4) (2025-12-02)


### Features

* auctionPriceAt ([#454](https://github.com/FilOzone/synapse-sdk/issues/454)) ([b38d81f](https://github.com/FilOzone/synapse-sdk/commit/b38d81fb912c6388804ba917154be8e2d61151b3))


### Chores

* **deps-dev:** bump @biomejs/biome from 2.3.5 to 2.3.6 ([#448](https://github.com/FilOzone/synapse-sdk/issues/448)) ([ebcab4e](https://github.com/FilOzone/synapse-sdk/commit/ebcab4ea166aa69c35d988ff2356b3f5972af351))
* **deps-dev:** bump @biomejs/biome from 2.3.6 to 2.3.7 ([#459](https://github.com/FilOzone/synapse-sdk/issues/459)) ([d3c65a8](https://github.com/FilOzone/synapse-sdk/commit/d3c65a806e4819bbc560f5a7087f79eec31417a5))
* **deps-dev:** bump @biomejs/biome from 2.3.7 to 2.3.8 ([#476](https://github.com/FilOzone/synapse-sdk/issues/476)) ([d95f812](https://github.com/FilOzone/synapse-sdk/commit/d95f812d7752a9b1dcb46219a4857eb99b54ebf0))

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
