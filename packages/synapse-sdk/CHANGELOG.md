## [0.28.0](https://github.com/FilOzone/synapse-sdk/compare/v0.27.0...v0.28.0) (2025-09-19)

### Features

* add terminateDataSet functionality ([#230](https://github.com/FilOzone/synapse-sdk/issues/230)) ([ffaacac](https://github.com/FilOzone/synapse-sdk/commit/ffaacac507b4882abfc33d3de72fe9fa98843cd2))

## [0.30.1](https://github.com/FilOzone/synapse-sdk/compare/synapse-sdk-v0.30.0...synapse-sdk-v0.30.1) (2025-10-09)


### Bug Fixes

* more careful checks for EIP-1193 provider ([#290](https://github.com/FilOzone/synapse-sdk/issues/290)) ([bfeee48](https://github.com/FilOzone/synapse-sdk/commit/bfeee489ee2df9d86b6c940ef28a0049bf78b273))

## [0.30.0](https://github.com/FilOzone/synapse-sdk/compare/synapse-sdk-v0.29.3...synapse-sdk-v0.30.0) (2025-10-08)


### Features

* add piece deletion to storage context ([#285](https://github.com/FilOzone/synapse-sdk/issues/285)) ([ac946dc](https://github.com/FilOzone/synapse-sdk/commit/ac946dce9dbbc77d9d559532ba0c4d8ebeafcd09))
* add session key support ([#209](https://github.com/FilOzone/synapse-sdk/issues/209)) ([0b0c983](https://github.com/FilOzone/synapse-sdk/commit/0b0c9836ef6d355cb74a3daa28d616c413be10cb))


### Bug Fixes

* generate-abi from correct contracts git tag ([#279](https://github.com/FilOzone/synapse-sdk/issues/279)) ([742c041](https://github.com/FilOzone/synapse-sdk/commit/742c041c355b41f5b14af53aa5ef956913fc79bf))


### Chores

* update mock service worker package version to 2.10.5 ([e201a48](https://github.com/FilOzone/synapse-sdk/commit/e201a483c24a4527afe610c1a23f46eb6d124268))

## [0.29.3](https://github.com/FilOzone/synapse-sdk/compare/synapse-sdk-v0.29.2...synapse-sdk-v0.29.3) (2025-10-03)


### Bug Fixes

* update package.json paths to use 'dist/src' directory ([625b269](https://github.com/FilOzone/synapse-sdk/commit/625b2699266a42a272bc27af3127475fee107b28))

## [0.29.2](https://github.com/FilOzone/synapse-sdk/compare/synapse-sdk-v0.29.1...synapse-sdk-v0.29.2) (2025-10-03)


### Bug Fixes

* clean up synapse-sdk readme ([8a7f949](https://github.com/FilOzone/synapse-sdk/commit/8a7f949b90e3e0e196247dd7a006d8e7dab9a11f))

## [0.29.1](https://github.com/FilOzone/synapse-sdk/compare/v0.29.0...v0.29.1) (2025-09-26)


### Bug Fixes

* import constants ([#246](https://github.com/FilOzone/synapse-sdk/issues/246)) ([53e0c97](https://github.com/FilOzone/synapse-sdk/commit/53e0c97268b1c5b0838c1a3979297aa3652ebf4c))
* resolve data sets in getClientDataSetsWithDetails without rail indirection ([#235](https://github.com/FilOzone/synapse-sdk/issues/235)) ([d0e8fb9](https://github.com/FilOzone/synapse-sdk/commit/d0e8fb955105ff23cdd0bcd7efb627fc4ca95067))

## [0.29.0](https://github.com/FilOzone/synapse-sdk/compare/v0.28.0...v0.29.0) (2025-09-24)


### Features

* rename FilCDN to FilBeam ([#239](https://github.com/FilOzone/synapse-sdk/issues/239)) ([8511b33](https://github.com/FilOzone/synapse-sdk/commit/8511b333cc235f5babe6a6a80e74361f1ccc40f9))


### Bug Fixes

* **ci:** no tabs in workflow file ([#237](https://github.com/FilOzone/synapse-sdk/issues/237)) ([b9c2275](https://github.com/FilOzone/synapse-sdk/commit/b9c2275fda73b5e40320795675de980887230cbe))
* **doc:** \&lt; ([5f5af43](https://github.com/FilOzone/synapse-sdk/commit/5f5af436bf6126bd3a0b4630b5b394fb6023944d))
* Escape &lt; in mdx ([#241](https://github.com/FilOzone/synapse-sdk/issues/241)) ([5f5af43](https://github.com/FilOzone/synapse-sdk/commit/5f5af436bf6126bd3a0b4630b5b394fb6023944d))


### Chores

* **ci:** switch from semantic-release to release-please ([#233](https://github.com/FilOzone/synapse-sdk/issues/233)) ([9f84cc6](https://github.com/FilOzone/synapse-sdk/commit/9f84cc6d0db1f99d9c81f962e3f06584c49dd461))

## [0.27.0](https://github.com/FilOzone/synapse-sdk/compare/v0.26.0...v0.27.0) (2025-09-19)

### Features

* allow custom metadata for data sets & roots ([fe41931](https://github.com/FilOzone/synapse-sdk/commit/fe4193181e1af214e702f7ecd877713e16ba5964)), closes [#201](https://github.com/FilOzone/synapse-sdk/issues/201)
* expose metadata as Record<string,string>; check constraints ([68ed29b](https://github.com/FilOzone/synapse-sdk/commit/68ed29bc0a2890b09d82990e4c983cc65768dab1))
* match data set for auto-selection based on all metadata (unordered) ([50eb97a](https://github.com/FilOzone/synapse-sdk/commit/50eb97ac1098b2997f073487ea1ad7c3cbb738a6))

### Bug Fixes

* exact match of metadata, ignoring order, when selecting data set to reuse ([5f80a64](https://github.com/FilOzone/synapse-sdk/commit/5f80a64a43d2fe8c11727a4337b7939ec921985a))
* pass metadata to context create, match cached contexts on metadata ([967f272](https://github.com/FilOzone/synapse-sdk/commit/967f2727aeacf4695d7e166276dcc58adb5dd1cd))

## [0.26.0](https://github.com/FilOzone/synapse-sdk/compare/v0.25.1...v0.26.0) (2025-09-19)

### Features

* add mainnet address, add --network flag to sp-tool ([#231](https://github.com/FilOzone/synapse-sdk/issues/231)) ([d0b5242](https://github.com/FilOzone/synapse-sdk/commit/d0b5242fafec72b0f295df05bc3c2219c754b9e3))

## [0.25.1](https://github.com/FilOzone/synapse-sdk/compare/v0.25.0...v0.25.1) (2025-09-15)

### Bug Fixes

* mdx formatting ([#218](https://github.com/FilOzone/synapse-sdk/issues/218)) ([f93edec](https://github.com/FilOzone/synapse-sdk/commit/f93edec6af2caf8594635a07cdf21cf018b1d967))

## [0.25.0](https://github.com/FilOzone/synapse-sdk/compare/v0.24.11...v0.25.0) (2025-09-15)

### Features

* payment rail settlement ([#136](https://github.com/FilOzone/synapse-sdk/issues/136)) ([9a5503e](https://github.com/FilOzone/synapse-sdk/commit/9a5503ec0fbedd388e7113ab7f78c7f8563d0ff8))

### Trivial Changes

* **deps-dev:** bump type-fest from 4.41.0 to 5.0.0 ([#217](https://github.com/FilOzone/synapse-sdk/issues/217)) ([d3a3608](https://github.com/FilOzone/synapse-sdk/commit/d3a360873dea9587fdc4643fd8f8a74b2f337891))
* **no-release:** disable eslint and prettier in VSCode settings ([#214](https://github.com/FilOzone/synapse-sdk/issues/214)) ([0631dbf](https://github.com/FilOzone/synapse-sdk/commit/0631dbfc156b87aaf66adf184ed6b89f91feb1fd))

## [0.24.11](https://github.com/FilOzone/synapse-sdk/compare/v0.24.10...v0.24.11) (2025-09-11)

### Trivial Changes

* **deps-dev:** bump @biomejs/biome from 2.2.3 to 2.2.4 ([#213](https://github.com/FilOzone/synapse-sdk/issues/213)) ([d79ba37](https://github.com/FilOzone/synapse-sdk/commit/d79ba37de99a5f0150e8065bf9d8c5de4c1016bd))
* **deps:** bump actions/setup-node from 4 to 5 ([#212](https://github.com/FilOzone/synapse-sdk/issues/212)) ([32ec07a](https://github.com/FilOzone/synapse-sdk/commit/32ec07a1df8a81fc6c43fba00e96c18ecea776ed))

## [0.24.10](https://github.com/FilOzone/synapse-sdk/compare/v0.24.9...v0.24.10) (2025-09-11)

### Bug Fixes

* select data set using providerId, not payee ([#211](https://github.com/FilOzone/synapse-sdk/issues/211)) ([6382e81](https://github.com/FilOzone/synapse-sdk/commit/6382e81330c787d328d9234f2a749643aa6ad3d6))

### Trivial Changes

* **no-release:** fix docs ([70d2c43](https://github.com/FilOzone/synapse-sdk/commit/70d2c43b24e9bed6c610a365353bae7010af8d24))
* **no-release:** fix docs base path ([11ed22d](https://github.com/FilOzone/synapse-sdk/commit/11ed22dd76a147160cffae7983d60ad215d0a683))
* **no-release:** fix docs index urls for github pages ([d31669b](https://github.com/FilOzone/synapse-sdk/commit/d31669bc824d3dba3886ae8b8bd6ace6afa650a2))
* **no-release:** github urls again ([1c1aee5](https://github.com/FilOzone/synapse-sdk/commit/1c1aee566d3e409fcf711a37359651286f5c8782))
* **no-release:** make docs run only on master ([04a6f2b](https://github.com/FilOzone/synapse-sdk/commit/04a6f2b5ba54491286107c7773cc82a60fdc96e6))

## [0.24.9](https://github.com/FilOzone/synapse-sdk/compare/v0.24.8...v0.24.9) (2025-09-10)

### Trivial Changes

* **docs:** add GitHub Pages deployment workflow and enable GitHub Pages in Astro config ([#210](https://github.com/FilOzone/synapse-sdk/issues/210)) ([4158abf](https://github.com/FilOzone/synapse-sdk/commit/4158abfa2aca84523c40b810acaccd0eadb9de6f))

## [0.24.8](https://github.com/FilOzone/synapse-sdk/compare/v0.24.7...v0.24.8) (2025-09-10)

### Trivial Changes

* **docs:** initialize documentation site with Astro and Starlight ([#180](https://github.com/FilOzone/synapse-sdk/issues/180)) ([770efcb](https://github.com/FilOzone/synapse-sdk/commit/770efcbc66205577032be9e2098d151bdd2f3984))

## [0.24.7](https://github.com/FilOzone/synapse-sdk/compare/v0.24.6...v0.24.7) (2025-09-10)

### Trivial Changes

* fix service-provider-tool ([#196](https://github.com/FilOzone/synapse-sdk/issues/196)) ([07374a6](https://github.com/FilOzone/synapse-sdk/commit/07374a632ac89e71ec8c6577c29d106dec43ed0d))

## [0.24.6](https://github.com/FilOzone/synapse-sdk/compare/v0.24.5...v0.24.6) (2025-09-09)

## [0.24.5](https://github.com/FilOzone/synapse-sdk/compare/v0.24.4...v0.24.5) (2025-09-09)

### Trivial Changes

* .gitignore Vim ([#205](https://github.com/FilOzone/synapse-sdk/issues/205)) ([60522f6](https://github.com/FilOzone/synapse-sdk/commit/60522f6715fb9ff917fd9c04d3ad015776c5c083))
* **deps-dev:** bump @biomejs/biome from 2.2.2 to 2.2.3 ([#197](https://github.com/FilOzone/synapse-sdk/issues/197)) ([4aa6cf8](https://github.com/FilOzone/synapse-sdk/commit/4aa6cf87983610970fa11f7dbe11590cafcea587))

## [0.24.4](https://github.com/FilOzone/synapse-sdk/compare/v0.24.3...v0.24.4) (2025-09-09)

### Trivial Changes

* update testing setup and dependencies ([#171](https://github.com/FilOzone/synapse-sdk/issues/171)) ([eb3e590](https://github.com/FilOzone/synapse-sdk/commit/eb3e590e5a83b612afa285eac4fabcd4dbf8a059))

## [0.24.3](https://github.com/FilOzone/synapse-sdk/compare/v0.24.2...v0.24.3) (2025-09-08)

### Trivial Changes

* contract address constants ([#192](https://github.com/FilOzone/synapse-sdk/issues/192)) ([0456047](https://github.com/FilOzone/synapse-sdk/commit/0456047ab37d7e0df307330ae30c68ea27eb417f))

## [0.24.2](https://github.com/FilOzone/synapse-sdk/compare/v0.24.1...v0.24.2) (2025-09-06)

### Bug Fixes

* **pdp:** select provider on ID, allow graceful fallback when no match ([#195](https://github.com/FilOzone/synapse-sdk/issues/195)) ([30d32af](https://github.com/FilOzone/synapse-sdk/commit/30d32af3a70950c0872a261375424aa4f8c35009))

## [0.24.1](https://github.com/FilOzone/synapse-sdk/compare/v0.24.0...v0.24.1) (2025-09-05)

### Trivial Changes

* **deps-dev:** bump typescript from 5.8.3 to 5.9.2 ([#193](https://github.com/FilOzone/synapse-sdk/issues/193)) ([8892319](https://github.com/FilOzone/synapse-sdk/commit/8892319658194be1fba54320a11753bdee47e166))

## [0.24.0](https://github.com/FilOzone/synapse-sdk/compare/v0.23.2...v0.24.0) (2025-09-05)

### Features

* add synapse.storage and StorageContext ([#153](https://github.com/FilOzone/synapse-sdk/issues/153)) ([7485b84](https://github.com/FilOzone/synapse-sdk/commit/7485b848973c129f11d299840236080208fedf9a))
* **commp:** transition to CommPv2 ([c0c39a4](https://github.com/FilOzone/synapse-sdk/commit/c0c39a446b8127f6f302b78760b76098d28c7736))
* **commp:** use "PieceCID" terminology, use v2 exclusively ([81f9ea8](https://github.com/FilOzone/synapse-sdk/commit/81f9ea8fa595cff231ad25d478c92fec846c19af))
* **commpv2:** Curio CommPv2 compatibility ([#156](https://github.com/FilOzone/synapse-sdk/issues/156)) ([d529e0b](https://github.com/FilOzone/synapse-sdk/commit/d529e0bdbc2e11360ae3a5d1bce4559abb3fd752))
* EIP712 signing support for metadata in CreateDataSet and AddPices ([#173](https://github.com/FilOzone/synapse-sdk/issues/173)) ([f396e0d](https://github.com/FilOzone/synapse-sdk/commit/f396e0d8b59445de9a8de28e2c5565d5bd9f8bac))
* major rename - pandora->warm storage, proof sets->data sets, roots->pieces ([6e1a743](https://github.com/FilOzone/synapse-sdk/commit/6e1a743fd7f4d168b39afac62c3494394f00a93d))
* sp registry ([e680f82](https://github.com/FilOzone/synapse-sdk/commit/e680f82ee5be19d2e487554a7347123491ba6ce3))
* **utils:** split client and provider functionality to make setup easier ([66c9d02](https://github.com/FilOzone/synapse-sdk/commit/66c9d02bca0e90c13d957bd527d2b9c3df83ea1e))
* **warmstorage:** discover dependent contract addresses from WarmStorage ([984966b](https://github.com/FilOzone/synapse-sdk/commit/984966bf20b50770ec75edc3a765b511258e5993))

### Bug Fixes

* ignore deleted providers when searching for retrieval options ([#159](https://github.com/FilOzone/synapse-sdk/issues/159)) ([2b8c427](https://github.com/FilOzone/synapse-sdk/commit/2b8c4270651224099a79c977814b3c2311016947))
* **pdp:** encode the metadata correctly in extraData ([c4aea98](https://github.com/FilOzone/synapse-sdk/commit/c4aea98ca442259a9b21c1393f0cc615d1f2fc9b))
* **pdp:** isComplete on data set creation should include server status ([#158](https://github.com/FilOzone/synapse-sdk/issues/158)) ([5cf3dc1](https://github.com/FilOzone/synapse-sdk/commit/5cf3dc17437f94e338aa3c8bc095c89885f776c3))
* trim trailing slash from serviceURL ([cf8be53](https://github.com/FilOzone/synapse-sdk/commit/cf8be534fdce262a1bc05b16c5274d2b93eaabde))
* **warmstorage:** adapt to view contract using extsload ([f56f00e](https://github.com/FilOzone/synapse-sdk/commit/f56f00e704464182eb516f86437bdfd70d04c7f0))

### Trivial Changes

* add biome and git hooks ([#165](https://github.com/FilOzone/synapse-sdk/issues/165)) ([425ba99](https://github.com/FilOzone/synapse-sdk/commit/425ba99552d991967c74d163124b88a2af33140a))
* change imports to .ts ([#185](https://github.com/FilOzone/synapse-sdk/issues/185)) ([778f779](https://github.com/FilOzone/synapse-sdk/commit/778f77941900d60b61a1d7479e26354457ddb247))
* **deps-dev:** bump chai from 5.3.3 to 6.0.1 ([#164](https://github.com/FilOzone/synapse-sdk/issues/164)) ([6d64b0b](https://github.com/FilOzone/synapse-sdk/commit/6d64b0b70524f2e92b97eaa83c64eb17127a8740))
* **deps:** bump actions/setup-node from 4.4.0 to 5.0.0 ([#190](https://github.com/FilOzone/synapse-sdk/issues/190)) ([b43d391](https://github.com/FilOzone/synapse-sdk/commit/b43d391d65143f4cb20fbd92855b5d299ccb2827))
* FilCDNBeneficiary ([#191](https://github.com/FilOzone/synapse-sdk/issues/191)) ([b394840](https://github.com/FilOzone/synapse-sdk/commit/b3948406fb04da7bfad99e85b6c3baa82d8ac16f))
* fix biome warnings ([#170](https://github.com/FilOzone/synapse-sdk/issues/170)) ([6d62d88](https://github.com/FilOzone/synapse-sdk/commit/6d62d8841c9d5f59b2d91e9a9179b32ff23f9600))
* remove simple-git-hooks from devDeps ([d600d5e](https://github.com/FilOzone/synapse-sdk/commit/d600d5efdc409dd2a05941d2074ab906914b4c33))
* update ABI imports and clean up unused code ([#187](https://github.com/FilOzone/synapse-sdk/issues/187)) ([6bdd507](https://github.com/FilOzone/synapse-sdk/commit/6bdd5071c38e6c84d66803343b0c7f1675e3ded8))
* update contract addresses ([2227cc9](https://github.com/FilOzone/synapse-sdk/commit/2227cc99f4e70e9f6261fdcdc0127feffc3198ba))
* update for alpha release contracts ([4a60150](https://github.com/FilOzone/synapse-sdk/commit/4a601502333d5b7f3731b8022fef9181178b4307))
* update TypeScript configuration ([#172](https://github.com/FilOzone/synapse-sdk/issues/172)) ([0e521d1](https://github.com/FilOzone/synapse-sdk/commit/0e521d1b32f536f1cc36ca35089cd7e0671bef38))

## [0.23.2](https://github.com/FilOzone/synapse-sdk/compare/v0.23.1...v0.23.2) (2025-08-13)

### Trivial Changes

* **deps:** bump actions/checkout from 4 to 5 ([#150](https://github.com/FilOzone/synapse-sdk/issues/150)) ([efc8018](https://github.com/FilOzone/synapse-sdk/commit/efc8018e801a4cd75da723d96f0c3c6ba106cda3))

## [0.23.1](https://github.com/FilOzone/synapse-sdk/compare/v0.23.0...v0.23.1) (2025-08-13)

### Trivial Changes

* **ci:** delete Claude Code PR review workflow ([#152](https://github.com/FilOzone/synapse-sdk/issues/152)) ([ec26b4b](https://github.com/FilOzone/synapse-sdk/commit/ec26b4b0242c74955c987fbfa64fa6da03c97bc7))

## [0.23.0](https://github.com/FilOzone/synapse-sdk/compare/v0.22.0...v0.23.0) (2025-08-04)

### Features

* use Performance API, update docs with additional timing input ([b4fe5f0](https://github.com/FilOzone/synapse-sdk/commit/b4fe5f035cbd962e4c8982418a3e02855cd6181d))

### Trivial Changes

* add comprehensive performance and timing analysis documentation ([d9eb5f1](https://github.com/FilOzone/synapse-sdk/commit/d9eb5f1bf4fdff44bb8c032bb5e0e6ab3954bb20)), closes [#125](https://github.com/FilOzone/synapse-sdk/issues/125)

## [0.22.0](https://github.com/FilOzone/synapse-sdk/compare/v0.21.0...v0.22.0) (2025-08-04)

### Features

* add batching for parallel uploads ([48b46b0](https://github.com/FilOzone/synapse-sdk/commit/48b46b0f1cdc240fa9d3102e5726916a2c40ebde))
* upload batch size, add simple debounce for uploads ([c54f36b](https://github.com/FilOzone/synapse-sdk/commit/c54f36b8f429e5e815c56c2c6ba75604fb1a3226))

## [0.21.0](https://github.com/FilOzone/synapse-sdk/compare/v0.20.1...v0.21.0) (2025-08-02)

### Features

* add pdpVerifierAddress option to SynapseOptions ([#138](https://github.com/FilOzone/synapse-sdk/issues/138)) ([965592e](https://github.com/FilOzone/synapse-sdk/commit/965592eaa245cbf2db976a22d2e79d4e992bfa4a))
* reset versioning to continue 0.x development ([ce58d21](https://github.com/FilOzone/synapse-sdk/commit/ce58d215492a8a80f836d9451655b8b70d680f2a))

### Trivial Changes

* **release:** 1.0.0 [skip ci] ([9d998b5](https://github.com/FilOzone/synapse-sdk/commit/9d998b5bf66d233496797bf2a7d5fd52c6d4bfde)), closes [#138](https://github.com/FilOzone/synapse-sdk/issues/138)
* reset version to 0.20.1 after accidental major release ([1cfe165](https://github.com/FilOzone/synapse-sdk/commit/1cfe165d1afe21bcd94b1d72f8fc15f086b69055))

## [1.0.0](https://github.com/FilOzone/synapse-sdk/compare/v0.20.1...v1.0.0) (2025-08-02)

### ⚠ BREAKING CHANGES

* add pdpVerifierAddress option to SynapseOptions (#138)

### Features

* add pdpVerifierAddress option to SynapseOptions ([#138](https://github.com/FilOzone/synapse-sdk/issues/138)) ([d35b40d](https://github.com/FilOzone/synapse-sdk/commit/d35b40d8d418432fb3dfee3fb9ac8bd2bc16ecea))

## [0.20.1](https://github.com/FilOzone/synapse-sdk/compare/v0.20.0...v0.20.1) (2025-08-02)

### Trivial Changes

* **ci:** grant Claude more permissions ([#139](https://github.com/FilOzone/synapse-sdk/issues/139)) ([3e4d23c](https://github.com/FilOzone/synapse-sdk/commit/3e4d23c18f29106efa5553e0fecae4da6e6d3bb0))

## [0.20.0](https://github.com/FilOzone/synapse-sdk/compare/v0.19.4...v0.20.0) (2025-07-18)

### Features

* **doc:** dual license as Apache 2.0 & MIT ([#134](https://github.com/FilOzone/synapse-sdk/issues/134)) ([5170b19](https://github.com/FilOzone/synapse-sdk/commit/5170b19095159de52ce46f332c8ac2b0a90003b8))

## [0.19.4](https://github.com/FilOzone/synapse-sdk/compare/v0.19.3...v0.19.4) (2025-07-17)

### Trivial Changes

* update docs for add-issues-and-prs-to-fs-project-board.yml ([#133](https://github.com/FilOzone/synapse-sdk/issues/133)) ([20ea7f3](https://github.com/FilOzone/synapse-sdk/commit/20ea7f35bc5163f17d9ec2106958c75eabcf31d3))

## [0.19.3](https://github.com/FilOzone/synapse-sdk/compare/v0.19.2...v0.19.3) (2025-07-15)

### Trivial Changes

* **docs:** npm badge on readme ([#132](https://github.com/FilOzone/synapse-sdk/issues/132)) ([ab8aa4c](https://github.com/FilOzone/synapse-sdk/commit/ab8aa4c860c5ec3b294dbb1868be627e004a04b1))

## [0.19.2](https://github.com/FilOzone/synapse-sdk/compare/v0.19.1...v0.19.2) (2025-07-15)

### Bug Fixes

* **pdp:** handle Curio's "proofsetCreated" casing ([#130](https://github.com/FilOzone/synapse-sdk/issues/130)) ([594c4ae](https://github.com/FilOzone/synapse-sdk/commit/594c4aee071891ad622bcec2ee2d4bf49415584e))

## [0.19.1](https://github.com/FilOzone/synapse-sdk/compare/v0.19.0...v0.19.1) (2025-07-14)

### Trivial Changes

* add Claude Code GitHub Workflow [skip-ci] ([#128](https://github.com/FilOzone/synapse-sdk/issues/128)) ([3878254](https://github.com/FilOzone/synapse-sdk/commit/38782549ac216570da7bba49dfe66c79d6f65be6))

## [0.19.0](https://github.com/FilOzone/synapse-sdk/compare/v0.18.0...v0.19.0) (2025-07-11)

### Features

* implement SynapseStorage[#piece](https://github.com/FilOzone/synapse-sdk/issues/piece)Status(commp) ([#127](https://github.com/FilOzone/synapse-sdk/issues/127)) ([9ee7f5b](https://github.com/FilOzone/synapse-sdk/commit/9ee7f5b10d28629fb0238647318be88b4b135552))
* **retriever:** add SubgraphRetriever ([#115](https://github.com/FilOzone/synapse-sdk/issues/115)) ([6352278](https://github.com/FilOzone/synapse-sdk/commit/6352278df83ee509d77c17266b070f2bcc5e58f5))

### Trivial Changes

* Update .github/workflows/add-issues-and-prs-to-fs-project-board.yml [skip ci] ([579ef07](https://github.com/FilOzone/synapse-sdk/commit/579ef070d795ee55521b7d5c81bf66016768a5e1))

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
