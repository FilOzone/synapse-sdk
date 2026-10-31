# Changelog

## [0.6.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.5.1...synapse-react-v0.6.0) (2026-10-31)


### ⚠ BREAKING CHANGES

* **react:** wait for created data sets and added pieces on chain

### Features

* **react:** wait for created data sets and added pieces on chain ([14a29cc](https://github.com/FilOzone/synapse-sdk/commit/14a29cc34497c3ffb5ce99117ff00b7ce64af05d)), closes [#1049](https://github.com/FilOzone/synapse-sdk/issues/1049)

## [0.5.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.5.0...synapse-react-v0.5.1) (2026-10-16)


### Features

* **react:** accept an optional chainId on read hooks ([182e524](https://github.com/FilOzone/synapse-sdk/commit/182e524a72c527d96bec36ab0e5b2b4a7ea13f49)), closes [#1026](https://github.com/FilOzone/synapse-sdk/issues/1026)
* **react:** add useUploadPieces streaming multi-file upload hook ([3a9a3d5](https://github.com/FilOzone/synapse-sdk/commit/3a9a3d5be875b459935e6a28f0a7278c297d874e)), closes [#1027](https://github.com/FilOzone/synapse-sdk/issues/1027)
* **react:** sign SP write hooks with an optional session key ([d6b4f1e](https://github.com/FilOzone/synapse-sdk/commit/d6b4f1ed3c910e636aacedc6f0c88d23a03db1ae)), closes [#1025](https://github.com/FilOzone/synapse-sdk/issues/1025)


### Bug Fixes

* **core:** default the data set payer to a session key's root wallet ([b5aa6c8](https://github.com/FilOzone/synapse-sdk/commit/b5aa6c8e93f8ff4710e548824ce9811c66a00d00)), closes [#1025](https://github.com/FilOzone/synapse-sdk/issues/1025)
* **react:** forward useDepositAndApprove props to core ([42873ca](https://github.com/FilOzone/synapse-sdk/commit/42873ca6007e2bb61b10b47f8aba4991b5bd4d4f)), closes [#1022](https://github.com/FilOzone/synapse-sdk/issues/1022)
* **react:** honour useDataSets query options and make pieces optional ([59cf7b1](https://github.com/FilOzone/synapse-sdk/commit/59cf7b1f54af9c6c5f6e12f9de4a0873541534fd)), closes [#1023](https://github.com/FilOzone/synapse-sdk/issues/1023)
* **react:** let useCreateDataSet set data set metadata ([118463b](https://github.com/FilOzone/synapse-sdk/commit/118463b24dfe1c426c305337bf54ddda87d55aab)), closes [#1024](https://github.com/FilOzone/synapse-sdk/issues/1024)
* **react:** reject a session key whose root is not the connected account ([2e6b8e0](https://github.com/FilOzone/synapse-sdk/commit/2e6b8e078654e5cbe266d47cd16ae138094e82d2))

## [0.5.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.4.0...synapse-react-v0.5.0) (2026-09-25)


### ⚠ BREAKING CHANGES

* **synapse-core:** PdpDataSet.provider and Piece.url can now be null. Callers must check these fields before using them.

### Bug Fixes

* **synapse-core:** handle inactive PDP providers ([44fee17](https://github.com/FilOzone/synapse-sdk/commit/44fee17978cc5da1790919e226ce7cb9c1e46ab5))


### Chores

* fix root lint command issues and clean up unused exports ([#980](https://github.com/FilOzone/synapse-sdk/issues/980)) ([28bd4b2](https://github.com/FilOzone/synapse-sdk/commit/28bd4b2486dd85560a8b9ff8c8fdb384722f8bda))

## [0.4.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.3.1...synapse-react-v0.4.0) (2026-09-03)


### ⚠ BREAKING CHANGES

* remove piece metadata getters ([#936](https://github.com/FilOzone/synapse-sdk/issues/936))

### Features

* remove piece metadata getters ([#936](https://github.com/FilOzone/synapse-sdk/issues/936)) ([8e0ee82](https://github.com/FilOzone/synapse-sdk/commit/8e0ee82a16a6a48c3680a14281cab3fd753d991f))

## [0.3.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.3.0...synapse-react-v0.3.1) (2026-08-25)


### Features

* support custom client for reads ([#909](https://github.com/FilOzone/synapse-sdk/issues/909)) ([1b8b54e](https://github.com/FilOzone/synapse-sdk/commit/1b8b54e873bf28002fa045bf56940adbe10d44d3))

## [0.3.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.2.3...synapse-react-v0.3.0) (2026-06-12)


### ⚠ BREAKING CHANGES

* **costs:** per-operation pricing price list ([#823](https://github.com/FilOzone/synapse-sdk/issues/823))

### Features

* **costs:** per-operation pricing price list ([#823](https://github.com/FilOzone/synapse-sdk/issues/823)) ([66af832](https://github.com/FilOzone/synapse-sdk/commit/66af8327430737437e96294a76210033efba9a45))


### Chores

* update release configuration and improve synapse-react documentation ([#843](https://github.com/FilOzone/synapse-sdk/issues/843)) ([53acc47](https://github.com/FilOzone/synapse-sdk/commit/53acc47aad132b45709e98b1e163dc1f0c79e986))
* update to pnpm 11 and dependencies across multiple packages ([95a620c](https://github.com/FilOzone/synapse-sdk/commit/95a620c619fcfcde3d575895b1c0ae99092a5e5a))

## [0.2.3](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.2.2...synapse-react-v0.2.3) (2026-03-30)


### Bug Fixes

* support multi sp upload flow in react and demo ([#675](https://github.com/FilOzone/synapse-sdk/issues/675)) ([7f70914](https://github.com/FilOzone/synapse-sdk/commit/7f70914e301a6969d5a1a6d1f06e6866d62f48d5))
* update use-upload-simple interface and export in warm-storage ([da08356](https://github.com/FilOzone/synapse-sdk/commit/da083565802980aebdc11d4b354117a97771c612))

## [0.2.2](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.2.1...synapse-react-v0.2.2) (2026-02-26)


### Features

* new session keys with viem ([#618](https://github.com/FilOzone/synapse-sdk/issues/618)) ([ad9ebe7](https://github.com/FilOzone/synapse-sdk/commit/ad9ebe7cc7792f42c980f1d1b9c51bd574fc674b))


### Chores

* **master:** release synapse-core 0.2.2 ([92fd0cb](https://github.com/FilOzone/synapse-sdk/commit/92fd0cb81f986e6dcee5b732324266bb00440eff))
* **master:** release synapse-sdk 0.37.2 ([c4396e1](https://github.com/FilOzone/synapse-sdk/commit/c4396e145160ffdf0591cecb6546f93af86e6c8e))

## [0.2.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.2.0...synapse-react-v0.2.1) (2026-02-12)


### Bug Fixes

* add chain id to query keys ([#605](https://github.com/FilOzone/synapse-sdk/issues/605)) ([a49b95a](https://github.com/FilOzone/synapse-sdk/commit/a49b95a21864383e716772480d9b790fb5d0cd6b))

## [0.2.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.1.4...synapse-react-v0.2.0) (2026-02-11)


### ⚠ BREAKING CHANGES

* change params to options object and remove withIpni ([#601](https://github.com/FilOzone/synapse-sdk/issues/601))
* transition from ethers to viem ([#555](https://github.com/FilOzone/synapse-sdk/issues/555))

### Features

* change params to options object and remove withIpni ([#601](https://github.com/FilOzone/synapse-sdk/issues/601)) ([0d529e2](https://github.com/FilOzone/synapse-sdk/commit/0d529e269332dc83f0bd43e14fe68f6602c0b90f))
* transition from ethers to viem ([#555](https://github.com/FilOzone/synapse-sdk/issues/555)) ([3741241](https://github.com/FilOzone/synapse-sdk/commit/37412415eba0b1204b6b14d00bac68aaf35afca1))


### Bug Fixes

* update to next core version ([43c0fe9](https://github.com/FilOzone/synapse-sdk/commit/43c0fe966d1bc6bfe9185a3d8ddc1630f82c530a))


### Chores

* pnpm security and catalog ([123b89c](https://github.com/FilOzone/synapse-sdk/commit/123b89c178f2597a35168e7ebddb440d1dda0816))
* update viem/wagmi and markdown lint ([#478](https://github.com/FilOzone/synapse-sdk/issues/478)) ([3f023f6](https://github.com/FilOzone/synapse-sdk/commit/3f023f6bb426a67afca917b73d41ac063d158487))

## [0.1.4](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.1.3...synapse-react-v0.1.4) (2025-12-04)


### Chores

* **deps-dev:** bump @biomejs/biome from 2.3.5 to 2.3.6 ([#448](https://github.com/FilOzone/synapse-sdk/issues/448)) ([ebcab4e](https://github.com/FilOzone/synapse-sdk/commit/ebcab4ea166aa69c35d988ff2356b3f5972af351))
* **deps-dev:** bump @biomejs/biome from 2.3.6 to 2.3.7 ([#459](https://github.com/FilOzone/synapse-sdk/issues/459)) ([d3c65a8](https://github.com/FilOzone/synapse-sdk/commit/d3c65a806e4819bbc560f5a7087f79eec31417a5))
* **deps-dev:** bump @biomejs/biome from 2.3.7 to 2.3.8 ([#476](https://github.com/FilOzone/synapse-sdk/issues/476)) ([d95f812](https://github.com/FilOzone/synapse-sdk/commit/d95f812d7752a9b1dcb46219a4857eb99b54ebf0))

## [0.1.3](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.1.2...synapse-react-v0.1.3) (2025-11-17)


### Chores

* update deps ([#432](https://github.com/FilOzone/synapse-sdk/issues/432)) ([6a9205b](https://github.com/FilOzone/synapse-sdk/commit/6a9205beede7b425469608980d2500c16884aa08))

## [0.1.2](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.1.1...synapse-react-v0.1.2) (2025-11-04)


### Chores

* simplify linting and make sure git hook works ([#394](https://github.com/FilOzone/synapse-sdk/issues/394)) ([ee8a83d](https://github.com/FilOzone/synapse-sdk/commit/ee8a83d5b737eabb6dec5d9c0f821ea6370f2496))

## [0.1.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.1.0...synapse-react-v0.1.1) (2025-11-03)


### Bug Fixes

* core abis in sdk ([#372](https://github.com/FilOzone/synapse-sdk/issues/372)) ([2b70909](https://github.com/FilOzone/synapse-sdk/commit/2b709094ae4a6b96c2fd7e5d6400ff79ecd5bb7f))


### Chores

* **deps-dev:** bump @biomejs/biome from 2.2.7 to 2.3.1 ([#352](https://github.com/FilOzone/synapse-sdk/issues/352)) ([ed8cee6](https://github.com/FilOzone/synapse-sdk/commit/ed8cee6ec505fa188d10d6ae668da24b8d087c08))

## [0.1.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-react-v0.0.1...synapse-react-v0.1.0) (2025-10-29)


### ⚠ BREAKING CHANGES

* create dataset and add pieces ([#357](https://github.com/FilOzone/synapse-sdk/issues/357))

### Features

* better curio error and polling ([#344](https://github.com/FilOzone/synapse-sdk/issues/344)) ([d4d44c6](https://github.com/FilOzone/synapse-sdk/commit/d4d44c6de5001e4f58eb36753b95904971492ce1)), closes [#331](https://github.com/FilOzone/synapse-sdk/issues/331)
* create dataset and add pieces ([#357](https://github.com/FilOzone/synapse-sdk/issues/357)) ([662904d](https://github.com/FilOzone/synapse-sdk/commit/662904d83ca1e2eac706b9e1ec6d6d0299dbbbba)), closes [#264](https://github.com/FilOzone/synapse-sdk/issues/264)
* delete piece errors ([#354](https://github.com/FilOzone/synapse-sdk/issues/354)) ([f57cc6a](https://github.com/FilOzone/synapse-sdk/commit/f57cc6af41086694b21289cba78ed1c11ae7360a))
* reset versioning to continue 0.x development ([ce58d21](https://github.com/FilOzone/synapse-sdk/commit/ce58d215492a8a80f836d9451655b8b70d680f2a))
* **ServiceProviderRegistry:** support latest ABI ([#364](https://github.com/FilOzone/synapse-sdk/issues/364)) ([a34dacc](https://github.com/FilOzone/synapse-sdk/commit/a34dacc0ecd470a06bc98148ea9f72cf85caf5ab))
* update to latest abi, including SP registry changes ([#361](https://github.com/FilOzone/synapse-sdk/issues/361)) ([a2c2dea](https://github.com/FilOzone/synapse-sdk/commit/a2c2dea1adc12281d68668e57b4deee22a9827e1))


### Bug Fixes

* react createDataset ([6a98b98](https://github.com/FilOzone/synapse-sdk/commit/6a98b989e4dc15fa0d945f19ee63db1294f35c86))


### Chores

* merge core and react ([#335](https://github.com/FilOzone/synapse-sdk/issues/335)) ([0e0262b](https://github.com/FilOzone/synapse-sdk/commit/0e0262b5a0f5aa7d41b907b5a81dfd7d53c51905))
