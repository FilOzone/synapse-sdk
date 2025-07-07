## [0.18.0](https://github.com/FilOzone/synapse-sdk/compare/v0.17.0...v0.18.0) (2025-07-04)

### Features

* add SDK methods to fetch proofset roots and metadata ([#111](https://github.com/FilOzone/synapse-sdk/issues/111)) ([a6ec128](https://github.com/FilOzone/synapse-sdk/commit/a6ec128b1dbf31eb68ff88d0cb00f91d0557e011))

## [0.17.0](https://github.com/FilOzone/synapse-sdk/compare/v0.16.1...v0.17.0) (2025-07-04)

### Features

* add provider info and storage info APIs ([#124](https://github.com/FilOzone/synapse-sdk/issues/124)) ([af8afb1](https://github.com/FilOzone/synapse-sdk/commit/af8afb1ee8407e7516fc2e661bf28eabbf7efa90))

## [0.16.1](https://github.com/FilOzone/synapse-sdk/compare/v0.16.0...v0.16.1) (2025-07-04)

## [0.16.0](https://github.com/FilOzone/synapse-sdk/compare/v0.15.0...v0.16.0) (2025-07-03)

### Features

* **pdp:** implement ping validation for storage providers in selection process ([#119](https://github.com/FilOzone/synapse-sdk/issues/119)) ([12a5bf7](https://github.com/FilOzone/synapse-sdk/commit/12a5bf78101e9337cf590ece468197771a3d0030))

## [0.15.0](https://github.com/FilOzone/synapse-sdk/compare/v0.14.0...v0.15.0) (2025-06-25)

### Features

* **pdp:** add ping method to check connectivity with SP ([46a3223](https://github.com/FilOzone/synapse-sdk/commit/46a322322c75c6824924da054ca33974855a5aca))

## [0.14.0](https://github.com/FilOzone/synapse-sdk/compare/v0.13.0...v0.14.0) (2025-06-24)

### Features

* **pdp:** always validate and return CommP (CID) objects from server ([d3b30da](https://github.com/FilOzone/synapse-sdk/commit/d3b30da047c9a719641b99b92781ea07b8e8ee7f))

### Trivial Changes

* **pdp:** validate server responses ([d2e135b](https://github.com/FilOzone/synapse-sdk/commit/d2e135b91a94a9ba2c7f9f81f9c0ab2d4c5d411c))

## [0.13.0](https://github.com/FilOzone/synapse-sdk/compare/v0.12.0...v0.13.0) (2025-06-23)

### Features

* enhance checkAllowanceForStorage with customizable lockup periods ([52c3204](https://github.com/FilOzone/synapse-sdk/commit/52c3204c94dc389259414b3f447a8174d3a649b0))

### Bug Fixes

* correct depositAmountNeeded assignment in PandoraService ([bdc1827](https://github.com/FilOzone/synapse-sdk/commit/bdc1827173b7062ba6d018d60e06ab67baf846ad))

### Tests

* add checks for depositAmountNeeded in PandoraService tests ([e07ae2d](https://github.com/FilOzone/synapse-sdk/commit/e07ae2d7dfa78a6d4cd4d61c0564a2f2f2b7e1b1))

## [0.12.0](https://github.com/FilOzone/synapse-sdk/compare/v0.11.0...v0.12.0) (2025-06-18)

### Features

* **cdn:** add complete FilCDN retriever implementation ([#106](https://github.com/FilOzone/synapse-sdk/issues/106)) ([e2ff94b](https://github.com/FilOzone/synapse-sdk/commit/e2ff94bb78cbcfdc41a0b7c9e08753b66e6e8d96))

## [0.11.0](https://github.com/FilOzone/synapse-sdk/compare/v0.10.0...v0.11.0) (2025-06-16)

### Features

* **retriever:** implement PieceRetriever pattern for flexible piece downloads ([16d9a84](https://github.com/FilOzone/synapse-sdk/commit/16d9a8430f6d3b4833bb3f2d495463c764c1d08f))

### Bug Fixes

* **retriever:** use Promise.any instead of Promise.race for provider selection ([c291821](https://github.com/FilOzone/synapse-sdk/commit/c2918219ef9e69a1b30f8c0edd8f635dc670d5db))

### Trivial Changes

* **pdp:** use extracted utility functions for url building ([7e96345](https://github.com/FilOzone/synapse-sdk/commit/7e963457d357cf753bb68a3d06dfdb1739c8a9c7))

## [0.10.0](https://github.com/FilOzone/synapse-sdk/compare/v0.9.1...v0.10.0) (2025-06-14)

### Features

* **admin:** expose addServiceProvider on PandoraService ([0270e7b](https://github.com/FilOzone/synapse-sdk/commit/0270e7bb52e8abc25464a48813e427a91748e604))

### Trivial Changes

* **admin:** remove pandora-admin html in preference of gh-pages branch ([1708857](https://github.com/FilOzone/synapse-sdk/commit/170885779921dd75d4b3a2a6ada2fd9608499259))

## [0.9.1](https://github.com/FilOzone/synapse-sdk/compare/v0.9.0...v0.9.1) (2025-06-13)

### Trivial Changes

* **transactions:** increase default wait confidence to 1 ([f6e42cb](https://github.com/FilOzone/synapse-sdk/commit/f6e42cbb311b38c641b9f2dea09da9b7e1443924))

## [0.9.0](https://github.com/FilOzone/synapse-sdk/compare/v0.8.1...v0.9.0) (2025-06-12)

### Features

* **pdp:** add transaction tracking for root additions with server verification ([00de2b2](https://github.com/FilOzone/synapse-sdk/commit/00de2b27eac9ce0731c7d9d0f25cbf825ea2d8cc))

### Trivial Changes

* add conventional commits guidelines ([bc68d04](https://github.com/FilOzone/synapse-sdk/commit/bc68d042048feee572a96fa97f768bbc6ccfe68d))

## [0.8.1](https://github.com/FilOzone/synapse-sdk/compare/v0.8.0...v0.8.1) (2025-06-11)

### Bug Fixes

* **addroots:** report full padded piece size to contract to match Curio ([277e015](https://github.com/FilOzone/synapse-sdk/commit/277e01598455c315ae04a21dfdd757bd2eaa0e46))

## [0.8.0](https://github.com/FilOzone/synapse-sdk/compare/v0.7.0...v0.8.0) (2025-06-11)

### Features

* return TransactionResponse objects from payment methods ([23d1d9d](https://github.com/FilOzone/synapse-sdk/commit/23d1d9d6dded4addcf529a5d8c716cf4dcc455e9))

### Bug Fixes

* **storage:** retry logic around proofset creation tx lookup ([454c721](https://github.com/FilOzone/synapse-sdk/commit/454c721773ad3e50b3b6c264752823fb4955d847))

### Trivial Changes

* minor README tweaks ([1ad8c09](https://github.com/FilOzone/synapse-sdk/commit/1ad8c095b6965785504d85fafbf677ad800b3e27))

## [0.7.0](https://github.com/FilOzone/synapse-sdk/compare/v0.6.1...v0.7.0) (2025-06-10)

### Features

* **storage:** implement smart provider selection to prefer existing relationships ([8433899](https://github.com/FilOzone/synapse-sdk/commit/843389974ee24165db70fcd690c5f4fe34c28afc))

## [0.6.1](https://github.com/FilOzone/synapse-sdk/compare/v0.6.0...v0.6.1) (2025-06-10)

### Trivial Changes

* **deps-dev:** bump @types/node from 22.15.31 to 24.0.0 ([fecfaa5](https://github.com/FilOzone/synapse-sdk/commit/fecfaa5c9bf919a566274b8be807e5bf52ee3212))

## [0.6.0](https://github.com/FilOzone/synapse-sdk/compare/v0.5.0...v0.6.0) (2025-06-10)

### Features

* **utils:** add Pandora storage provider admin portal [skip ci] ([#79](https://github.com/FilOzone/synapse-sdk/issues/79)) ([e6a79bc](https://github.com/FilOzone/synapse-sdk/commit/e6a79bc589d2a0a2f692c617104fbb5962bba687))

### Bug Fixes

* remove 60s delay after createproofset and associated testing hack ([353551a](https://github.com/FilOzone/synapse-sdk/commit/353551ad1207df97195000459bae35e7a8683200))

### Trivial Changes

* **docs:** move ADMIN_SAFE_INTEGRATION_PLAN.md to utils ([4167234](https://github.com/FilOzone/synapse-sdk/commit/416723423968780dfe9ed582ba078812f44e6a2a))

## [0.5.0](https://github.com/FilOzone/synapse-sdk/compare/v0.4.0...v0.5.0) (2025-06-09)

### Features

* add minimum upload size validation and improve storage reliability ([4270590](https://github.com/FilOzone/synapse-sdk/commit/42705907776db9c1380b799e6b538d5eec0cf9d2))
* **storage:** add creation callbacks and remove out-of-scope methods ([2de7f91](https://github.com/FilOzone/synapse-sdk/commit/2de7f918d676a177fd55ae035000b6d7199e3a84))
* **storage:** implement download method and simplify DownloadOptions ([05c1b79](https://github.com/FilOzone/synapse-sdk/commit/05c1b795d5f5108554a31c15f21c0762187661f4))
* **storage:** implement preflight checks and refactor allowance API ([2746cba](https://github.com/FilOzone/synapse-sdk/commit/2746cba61f704d9f53e8f5d5a9f63562c18c21a3))
* **storage:** implement provider selection and proof set management ([9faf04f](https://github.com/FilOzone/synapse-sdk/commit/9faf04f49e586c733ce65e40e8ea50e4f1699782))
* **storage:** implement upload method with UploadCallbacks ([e289ae9](https://github.com/FilOzone/synapse-sdk/commit/e289ae9f7efd93dda62c3b50cc53cf81d1281217))

### Bug Fixes

* add hack to skip 60s delay in upload during tests ([f4ade39](https://github.com/FilOzone/synapse-sdk/commit/f4ade3979327b2e5f5d204f29f0074f3cecc0995))
* **docs:** update README examples for latest signatures ([b574a90](https://github.com/FilOzone/synapse-sdk/commit/b574a90b1336b41723cf2d9359e84a6b45a1ec1f))
* **pdp:** restore correct upload protocol with check object ([18618b2](https://github.com/FilOzone/synapse-sdk/commit/18618b25fd41c659374f6612e26ddc1db7e450c6))
* semantic-release bug ([bf340d8](https://github.com/FilOzone/synapse-sdk/commit/bf340d8f203d56f2726c012e56112b2b17be9f44))

### Trivial Changes

* remove example-usage.js in favour of new examples in utils/ ([72dbe23](https://github.com/FilOzone/synapse-sdk/commit/72dbe23ed7fceb8b7ee38356b8513b772309a100))
* remove unused getters ([1bed0db](https://github.com/FilOzone/synapse-sdk/commit/1bed0db5103b8b5a8c33d05dce1c271400d3c9eb))
* use ethers.js utilities instead of hardcoded decimals ([8895422](https://github.com/FilOzone/synapse-sdk/commit/88954226c081f3df170a0fcfcbf25367e5e19a9e))

## [0.4.0](https://github.com/FilOzone/synapse-sdk/compare/v0.3.0...v0.4.0) (2025-06-09)

### Features

* refactor SDK architecture for separation of concerns ([9e0867b](https://github.com/FilOzone/synapse-sdk/commit/9e0867b4bf30cb914f8243d91c5575c2d66835b1))

## [0.3.0](https://github.com/FilOzone/synapse-sdk/compare/v0.2.0...v0.3.0) (2025-06-06)

### Features

* **pandora:** implement getClientProofSets for client ([bef0053](https://github.com/FilOzone/synapse-sdk/commit/bef005365b6819fd0e143e12959659403ed94d57))
* **pdp:** add comprehensive proof set discovery and status utilities ([6f1da3e](https://github.com/FilOzone/synapse-sdk/commit/6f1da3e879ad40f4b0e469a3a0f69f5a5d22a1fe))
* **pdp:** add findPiece method to check piece existence on PDP server ([cd7f3cd](https://github.com/FilOzone/synapse-sdk/commit/cd7f3cd0c7570fa4d013837bd068257f11d9d90a))

### Trivial Changes

* **docs:** add proof-sets-viewer.html example ([bdb995e](https://github.com/FilOzone/synapse-sdk/commit/bdb995e41647b5a116c1a77d319fd6256b9293c1))
* remove unnecessary cruft and improve error handling ([f04c0e0](https://github.com/FilOzone/synapse-sdk/commit/f04c0e0a882999a53a265686ce18600a1a32bf6a))

## [0.2.0](https://github.com/FilOzone/synapse-sdk/compare/v0.1.0...v0.2.0) (2025-06-06)

### Features

* **payments:** add enhanced payment APIs and update Pandora contract integration ([b6ff598](https://github.com/FilOzone/synapse-sdk/commit/b6ff598702c0ea629678378da5244d8c73b43e6c))

### Bug Fixes

* **payments:** no fallback to known pricing, only from chain ([e43def6](https://github.com/FilOzone/synapse-sdk/commit/e43def67d6bd49e48739bca9345330b13eb03b92))
* use my latest deployed pandora contract ([1b6b198](https://github.com/FilOzone/synapse-sdk/commit/1b6b1986a5fa36bb22e794c57b11c64f68dff441))

### Trivial Changes

* **doc:** add payments-demo.html ([e85bb18](https://github.com/FilOzone/synapse-sdk/commit/e85bb185acc3f57e3ea782d8100c9b7e34ab6f01))
* **test:** merge payments tests into single file ([6166615](https://github.com/FilOzone/synapse-sdk/commit/61666156276e0ab1bc58b5f44c943cabb7e87268))

## [0.1.0](https://github.com/FilOzone/synapse-sdk/compare/v0.0.1...v0.1.0) (2025-06-06)

### Features

* **pdptool:** AddRoots API call ([#70](https://github.com/FilOzone/synapse-sdk/issues/70)) ([d159552](https://github.com/FilOzone/synapse-sdk/commit/d15955283beadf2fe8dcd02d0a9426d7e91289b9))

### Trivial Changes

* **docs:** fix CHANGELOG format [skip ci] ([d89be6c](https://github.com/FilOzone/synapse-sdk/commit/d89be6c20c5f16b6202dded2af308173fe2a8346))

## [0.0.1](https://github.com/FilOzone/synapse-sdk/compare/v0.0.0...v0.0.1) (2025-06-05)

### Bug Fixes

* **auth:** no need for digest check ([cac3b71](https://github.com/FilOzone/synapse-sdk/commit/cac3b71f95ab3bd27910c4ed324c7187e2940552))
* use full bytes of commp in auth signing blob ([2901305](https://github.com/FilOzone/synapse-sdk/commit/2901305a2499b74760b600bd637a6bd008bd25b2))

### Trivial Changes

* **ci:** no more dry-run publishes ([7b0da83](https://github.com/FilOzone/synapse-sdk/commit/7b0da839393f75a2554a40579fbfcfa3163a5b27))
* **docs:** add CHANGELOG with 0.0.0 notes ([61193f9](https://github.com/FilOzone/synapse-sdk/commit/61193f9595f703c420408a127d777fcd4346d8e5))
* **test:** update addRoots auth blob fixtures ([2897f2b](https://github.com/FilOzone/synapse-sdk/commit/2897f2b179b107b5b0f95a86c63b40c89f9c6fbe))

## 0.0.0 (2025-06-05)

### Features

* add 'authorization' option for auth header ([ddb4bcd](https://github.com/FilOzone/synapse-sdk/commit/ddb4bcd5107f3b386940a934169b06d0328fa44f))
* add blob creation helpers ([848613c](https://github.com/FilOzone/synapse-sdk/commit/848613ca960f2383d64fa05086043def2778d7dd))
* add commp calculation functionality ([a87c4c9](https://github.com/FilOzone/synapse-sdk/commit/a87c4c9006751a04a7d3c988064a88747a16f133))
* **auth:** modify ScheduleRemovals signing for UX improvements ([fadcc8d](https://github.com/FilOzone/synapse-sdk/commit/fadcc8dbeb3a75aa72f9387912a96c83e3b51a87))
* **commp:** toZeroPaddedSize ([18aa22b](https://github.com/FilOzone/synapse-sdk/commit/18aa22be4e1e27d5a7ad77fb0091bb7bdfe8c2a8))
* **dist:** publish as single-file bundles for web/cdn use ([0a42daa](https://github.com/FilOzone/synapse-sdk/commit/0a42daac1205d13ca22a86f7e5d1a9fba1618f2e))
* **docs:** add post-deploy-setup.js script, more docs ([ed002d7](https://github.com/FilOzone/synapse-sdk/commit/ed002d760a99bbf57d6f2caf3010a146521ca9d7))
* implement wallet & contract interactions; style, test, lint ([689afdd](https://github.com/FilOzone/synapse-sdk/commit/689afddae4de21dc9e997ed9f561c256fd11f9f8))
* implementation of initial design with mock backend ([346b01f](https://github.com/FilOzone/synapse-sdk/commit/346b01f198934098016f47c7c673931d291ea667))
* initial interface design proposal ([53616f0](https://github.com/FilOzone/synapse-sdk/commit/53616f0fc983d8df83cde5397de59b13a8807786))
* make constructor private, simplify internals ([2e23b4c](https://github.com/FilOzone/synapse-sdk/commit/2e23b4cb5b5892f59e88f962fcd37d1d97f8ea7b))
* minimal interface to align with M1 plan ([c05319a](https://github.com/FilOzone/synapse-sdk/commit/c05319a14590740125169be62a1d8688fba022c4))
* more payments contract interaction features ([c198f56](https://github.com/FilOzone/synapse-sdk/commit/c198f565576be566426e74a571e0ed979ad55d45))
* **payments:** extract SynapsePayments class, access as synapse.payments ([f7df69e](https://github.com/FilOzone/synapse-sdk/commit/f7df69e48d2880c06262c63e460a2f42391a4921))
* **pdp:** EIP-712 signing support ([a4513af](https://github.com/FilOzone/synapse-sdk/commit/a4513afdb196a185e3eb3a8ec4c131a4196ca291))
* rename SimplePDPServiceWithPayments to Pandora ([942030c](https://github.com/FilOzone/synapse-sdk/commit/942030cd0aa66ba34e04e89c163f50a96c48ddd7))
* signing operations for PDP ([ff08423](https://github.com/FilOzone/synapse-sdk/commit/ff0842313bc0e7933d3d11da1a9dd9e014bade2d))
* **sptool:** Add StorageProviderTool for SP-focused utilities ([e54b4ad](https://github.com/FilOzone/synapse-sdk/commit/e54b4ad63b3847b86fa682b157f2954ef94267d5))
* streaming commp, PDP piece upload & download ([d464589](https://github.com/FilOzone/synapse-sdk/commit/d46458948d1ee797361efe9e7ff08cf7077bd03a))

### Bug Fixes

* adjust signing to match current contract implementation ([4a6668c](https://github.com/FilOzone/synapse-sdk/commit/4a6668c252733bb6561b8a2ec486fc22650afb35))
* auth signature needs [bytes] for CID, not bytes ([87afdc1](https://github.com/FilOzone/synapse-sdk/commit/87afdc1a1ed9e1323a4baaf2f5a4a164363ecccd))
* **auth:** also pack roots for ScheduleRemoval ([8abfba5](https://github.com/FilOzone/synapse-sdk/commit/8abfba545f312f211b8200b14b736fc2fc4be271))
* **auth:** deal with EIP-712 incompatibilities in contract ([175c012](https://github.com/FilOzone/synapse-sdk/commit/175c012e93e4d83a25ef957f1a303e14dbddb594))
* **auth:** deeper EIP-712 support with internal metamask detection ([4efc63d](https://github.com/FilOzone/synapse-sdk/commit/4efc63d6f0ca3b3a803ffd0a6275cefa4e32c5da))
* **auth:** fix compatibility with questionable results ([8d87969](https://github.com/FilOzone/synapse-sdk/commit/8d879693f2813dc0cd4b13cf7acb3458855ecd54))
* **auth:** simplify auth setup inside Synapse, update docs ([ed35266](https://github.com/FilOzone/synapse-sdk/commit/ed35266fa0b04a8c6cdcf84ae01f8a846c9d66cf))
* **auth:** use uint256[] for ScheduleRemovals signature ([690c2aa](https://github.com/FilOzone/synapse-sdk/commit/690c2aa6dd276552bbc30612712d2081d37a3633))
* lint and browser test compatibility ([aac8569](https://github.com/FilOzone/synapse-sdk/commit/aac856930be4706538c1f5a3e91fe37c4df29131))
* no Buffer ([5a6de27](https://github.com/FilOzone/synapse-sdk/commit/5a6de27a0a7cb7ba28d0cebf86c7c767bdce2116))
* **pdp:** more complete index ([14f8abe](https://github.com/FilOzone/synapse-sdk/commit/14f8abed5eeb5f1b1090f3ba3ddfc24ac7f4a550))
* **test:** dedupe test utils ([831e745](https://github.com/FilOzone/synapse-sdk/commit/831e745f682b7e0051ed189365e166aae1270da9))
* websockets first, document walletBalance vs balance differences ([7a58b9e](https://github.com/FilOzone/synapse-sdk/commit/7a58b9e3b3bb13bb035a6b546c523181380b2323))

### Trivial Changes

* add CLAUDE.md symlink ([4c5b9e5](https://github.com/FilOzone/synapse-sdk/commit/4c5b9e54e65e46e36caa76ac38df8917547f29ba))
* add dependabot ([c87963c](https://github.com/FilOzone/synapse-sdk/commit/c87963c1619ed6314eaf68591dcf259c8c57bb72))
* add GHA test & release w/ release temporarily disabled ([00e1fae](https://github.com/FilOzone/synapse-sdk/commit/00e1faeb711f6c4525b572f9ce796d46bc67a6bc))
* **deps-dev:** bump webpack-cli from 5.1.4 to 6.0.1 ([03df52f](https://github.com/FilOzone/synapse-sdk/commit/03df52fd1b0d5978b9c3dcc234f6a6a8312661b3))
* **deps:** bump actions/checkout from 4.1.7 to 4.2.2 ([#45](https://github.com/FilOzone/synapse-sdk/issues/45)) ([9fff4f5](https://github.com/FilOzone/synapse-sdk/commit/9fff4f5d6bef159cf17d9be256bb113b18e44eff))
* **deps:** bump actions/setup-node from 4.0.4 to 4.4.0 ([711ad66](https://github.com/FilOzone/synapse-sdk/commit/711ad66dc363a31465a0f0cddc545c6d3dc87da7))
* **doc:** pdp-auth-demo page ([0811d95](https://github.com/FilOzone/synapse-sdk/commit/0811d9550efbc0fcf0bdb0a885862456c246ab2c))
* **docs,ai:** compress and organise LLM file ([3b192f9](https://github.com/FilOzone/synapse-sdk/commit/3b192f9060b2ef27d3352283ecadabd4593eb13f))
* **docs,ai:** PDP architecture & contract details + flows ([2e5091b](https://github.com/FilOzone/synapse-sdk/commit/2e5091b117562e94ce62e5354ed0ccf1662cddd1))
* **docs,ai:** update knowledge ([7e21908](https://github.com/FilOzone/synapse-sdk/commit/7e21908a93dd61775a0af37a48f80c5c7b92c6f2))
* **docs,ai:** update knowledge about dev repos ([29b13e7](https://github.com/FilOzone/synapse-sdk/commit/29b13e79fb43d8101ae8ddf1dc1c7f3f8b4e4f35))
* **docs:** "base units" instead of "smallest unit" for tokens ([8b97c60](https://github.com/FilOzone/synapse-sdk/commit/8b97c609f6653135265cab122652f8ea96ec4ee4))
* enable auto-publishing ([ce08315](https://github.com/FilOzone/synapse-sdk/commit/ce0831537bc1b7f27c97c707a1c5d40997da2d55))
* move pdp-auth-demo.html into utils ([ec60268](https://github.com/FilOzone/synapse-sdk/commit/ec602681eaee9a007ac9f388fbe2b21c3c826cfe))
* publishConfig & dry-run for now ([a198ddc](https://github.com/FilOzone/synapse-sdk/commit/a198ddc8aa4b42320ee05cd7a11a909b5b3307a2))
* remove example auth ([17440a2](https://github.com/FilOzone/synapse-sdk/commit/17440a2098a0394ddeb1b56aa004a38b2a601598))
* remove reexport from top-level index ([3ace19a](https://github.com/FilOzone/synapse-sdk/commit/3ace19a325bc2e6aea83aeb670c1ce107b3bc9f7))
* rename @filoz/synapse-sdk for now ([b588fda](https://github.com/FilOzone/synapse-sdk/commit/b588fda81bbe35edd5f71646ab4b61c65b300809))
* rename CLAUDE.md to AGENTS.md ([d8c5d3a](https://github.com/FilOzone/synapse-sdk/commit/d8c5d3ac5be6b1cb14c94de23d50bca70abb6302))
* reorg auth components into pdp subpackage, remove from main interface ([d0fc739](https://github.com/FilOzone/synapse-sdk/commit/d0fc7394c91ab976e4c7748e2722d17a451f2b29))
* **test:** extend timeout for windows browser tests ([0dadc4f](https://github.com/FilOzone/synapse-sdk/commit/0dadc4f2c9dfc22f571a0e85b2a0b9f265721ab8))
* **tmp:** add example-auth-simple.js ([f329d09](https://github.com/FilOzone/synapse-sdk/commit/f329d09a9d7db9b43fe401933ccaf294fdc9cb91))
* update GHA release permissions ([f07628f](https://github.com/FilOzone/synapse-sdk/commit/f07628fb5055906d3a5dfcb476c04009fc8dda25))
