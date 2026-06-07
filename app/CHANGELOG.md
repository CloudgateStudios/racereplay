# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [0.4.0](https://github.com/CloudgateStudios/race_replay/compare/0.3.2...0.4.0) (2026-06-07)

### Features

- add about page ([#43](https://github.com/CloudgateStudios/race_replay/issues/43)) ([dd6f3a1](https://github.com/CloudgateStudios/race_replay/commit/dd6f3a14e11e866637028bea59e90c881c3a3c5f))

### Bug Fixes

- actually round the time format ([#42](https://github.com/CloudgateStudios/race_replay/issues/42)) ([6571205](https://github.com/CloudgateStudios/race_replay/commit/6571205a2a3cce6f61e3939a35ec95cbe13d8b26))
- add --dry-run flag and column warnings to ingest script ([#52](https://github.com/CloudgateStudios/race_replay/issues/52)) ([ae9955f](https://github.com/CloudgateStudios/race_replay/commit/ae9955f0440d1f8d6bc9afc0a703eb024ecdab51))
- add AthleteStatus enum to Prisma schema (tech debt [#6](https://github.com/CloudgateStudios/race_replay/issues/6)) ([#55](https://github.com/CloudgateStudios/race_replay/issues/55)) ([a142b38](https://github.com/CloudgateStudios/race_replay/commit/a142b38948eaf21a19d77ae6144a01d1af05625a))
- add error boundary components for graceful error handling ([#47](https://github.com/CloudgateStudios/race_replay/issues/47)) ([7e879b7](https://github.com/CloudgateStudios/race_replay/commit/7e879b748528b8695a997e298962eab205e5d412))
- add isFinish flag to Segment model (tech debt [#3](https://github.com/CloudgateStudios/race_replay/issues/3)) ([#54](https://github.com/CloudgateStudios/race_replay/issues/54)) ([0e18a0c](https://github.com/CloudgateStudios/race_replay/commit/0e18a0c5bd2e0ccef4c6876c8c60e4a76468a9e3))
- add skeleton loading states for event and athlete pages ([#49](https://github.com/CloudgateStudios/race_replay/issues/49)) ([3b44aef](https://github.com/CloudgateStudios/race_replay/commit/3b44aefe1e894618412abaa3ccec26270feb212e))
- always render all four rank cards on athlete page ([#48](https://github.com/CloudgateStudios/race_replay/issues/48)) ([5c7efad](https://github.com/CloudgateStudios/race_replay/commit/5c7efad995fa9a7d3d3b1e76ebbcdecdb479f958))
- debounce search input to reduce excessive router pushes ([#50](https://github.com/CloudgateStudios/race_replay/issues/50)) ([e339387](https://github.com/CloudgateStudios/race_replay/commit/e3393879b3de8369dc63e5c1d7ba33d2baa59915))
- make Athlete.finishTime nullable, replace sentinel string with null ([#53](https://github.com/CloudgateStudios/race_replay/issues/53)) ([a1de4a1](https://github.com/CloudgateStudios/race_replay/commit/a1de4a1818db9e2de5e010e995582ce492a48677))
- pass DATABASE_URL to vercel build step in CI ([#56](https://github.com/CloudgateStudios/race_replay/issues/56)) ([f307f7c](https://github.com/CloudgateStudios/race_replay/commit/f307f7c316631f0fc1eaec8a26ccfca857fc9550))
- remove duplicate release notes in version increment workflow ([#41](https://github.com/CloudgateStudios/race_replay/issues/41)) ([90ba21b](https://github.com/CloudgateStudios/race_replay/commit/90ba21bcbface4654490d52f61c61fa85ccc6c4f))
- trim whitespace from athlete string fields during ingest ([#51](https://github.com/CloudgateStudios/race_replay/issues/51)) ([6ea2027](https://github.com/CloudgateStudios/race_replay/commit/6ea2027558496106b79cc11efe4e52010fdca15b))
- validate DATABASE_URL at startup instead of crashing at query time ([#46](https://github.com/CloudgateStudios/race_replay/issues/46)) ([0832124](https://github.com/CloudgateStudios/race_replay/commit/083212459ed18cbcba9537f7a6f6991d4396ce9c))

### [0.3.2](https://github.com/CloudgateStudios/race_replay/compare/0.3.1...0.3.2) (2026-06-07)

### Features

- add total time in athlete page ([#39](https://github.com/CloudgateStudios/race_replay/issues/39)) ([bc2ce1e](https://github.com/CloudgateStudios/race_replay/commit/bc2ce1e3761ed7c80c63713ab7e692d806994998))
- compute ranks locally when RTRT omits them, hide empty data fields ([#40](https://github.com/CloudgateStudios/race_replay/issues/40)) ([f903a6c](https://github.com/CloudgateStudios/race_replay/commit/f903a6cdcaf6447af3fa02d0e62a622b629cd425))

### Bug Fixes

- make participation funnel responsive on mobile ([#36](https://github.com/CloudgateStudios/race_replay/issues/36)) ([113ad1b](https://github.com/CloudgateStudios/race_replay/commit/113ad1b63122bdfc8107b8bb98217cd24cc14d1b))
- retry on network-level fetch failures in split fetching ([#37](https://github.com/CloudgateStudios/race_replay/issues/37)) ([c7ff445](https://github.com/CloudgateStudios/race_replay/commit/c7ff445f4824ddb9737536ac123ddfb5d60d917b))
- update data scraper for better performance and visibility ([#38](https://github.com/CloudgateStudios/race_replay/issues/38)) ([f7603fa](https://github.com/CloudgateStudios/race_replay/commit/f7603fa9804b7f224937ffbf301512aa3e7cfbc8))

### [0.3.1](https://github.com/CloudgateStudios/racereplay/compare/0.3.0...0.3.1) (2026-06-06)

### Bug Fixes

- correct version tag after CHANGELOG amend ([#35](https://github.com/CloudgateStudios/racereplay/issues/35)) ([947cdcc](https://github.com/CloudgateStudios/racereplay/commit/947cdccb6351d3717adacb70022a28672ceefb2d))

## [0.3.0](https://github.com/CloudgateStudios/racereplay/compare/0.2.0...0.3.0) (2026-06-06)

### Features

- add visible labels to event results filters ([#33](https://github.com/CloudgateStudios/racereplay/issues/33)) ([efdb0ce](https://github.com/CloudgateStudios/racereplay/commit/efdb0cefac32f7943ddc6bacce8e8ccc57cf9ba1))
- landing page, all-races page, and UI polish ([#27](https://github.com/CloudgateStudios/racereplay/issues/27)) ([6b1f65b](https://github.com/CloudgateStudios/racereplay/commit/6b1f65b698b97470a9a3d8b5b5e992b785a8a10e))
- replace event badges with participation funnel ([#34](https://github.com/CloudgateStudios/racereplay/issues/34)) ([93e4900](https://github.com/CloudgateStudios/racereplay/commit/93e49004c8f588276a0f200d81fbd7c83389d023))
- skip year picker when race has only one year of data ([#29](https://github.com/CloudgateStudios/racereplay/issues/29)) ([f3b6664](https://github.com/CloudgateStudios/racereplay/commit/f3b6664abc6fc732ef990fe19a74be2c25db131d))
- slim results table to Net columns only ([#32](https://github.com/CloudgateStudios/racereplay/issues/32)) ([71d2ae0](https://github.com/CloudgateStudios/racereplay/commit/71d2ae026d30a45f9f4cca2b4f4cc41295759da3))

### Bug Fixes

- downgrade eslint to ^9 to satisfy eslint-config-next peer deps ([#30](https://github.com/CloudgateStudios/racereplay/issues/30)) ([d9d155d](https://github.com/CloudgateStudios/racereplay/commit/d9d155d0486547291ffa922326007db2c6578f96))
- full-bleed hero gradient ([#28](https://github.com/CloudgateStudios/racereplay/issues/28)) ([4cd4f1d](https://github.com/CloudgateStudios/racereplay/commit/4cd4f1de9f78687b5c4a8a17be3f28e6f9d6d8c8))

## [0.2.0](https://github.com/CloudgateStudios/racereplay/compare/v0.1.0...v0.2.0) (2026-06-06)

## 0.1.0 (2026-06-06)

### Features

- initial RaceReplay web app ([#15](https://github.com/CloudgateStudios/racereplay/issues/15)) ([38d441e](https://github.com/CloudgateStudios/racereplay/commit/38d441e21f2ffc7920e08036e4ebeb050b60fb37))
- phase 1 — scaffold, Prisma schema, project config ([#5](https://github.com/CloudgateStudios/racereplay/issues/5)) ([fd189eb](https://github.com/CloudgateStudios/racereplay/commit/fd189ebce0e67037471ddbbff7331d819af56ba2))
- POC physical passing algorithm verified on two real races ([#3](https://github.com/CloudgateStudios/racereplay/issues/3)) ([72cf6fc](https://github.com/CloudgateStudios/racereplay/commit/72cf6fc20c15309c018be7b77064e96515870ab2))

### Bug Fixes

- pass --env-file .env.local to all prisma scripts ([#9](https://github.com/CloudgateStudios/racereplay/issues/9)) ([e6795ee](https://github.com/CloudgateStudios/racereplay/commit/e6795ee9de764431d07e3313480d0b0d61f84d9d))
- update rtrt script ([#11](https://github.com/CloudgateStudios/racereplay/issues/11)) ([79c805f](https://github.com/CloudgateStudios/racereplay/commit/79c805fbe4bbb955dc3d0c8d280ad9d382b07967))
- use dotenv-cli to load .env.local for prisma scripts ([#10](https://github.com/CloudgateStudios/racereplay/issues/10)) ([e06e539](https://github.com/CloudgateStudios/racereplay/commit/e06e53987e05bfaf2052de34d35b603e1db594bc))
