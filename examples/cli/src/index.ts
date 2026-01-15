#!/usr/bin/env node

import { cli } from 'cleye'
import { datasets } from './commands/datasets.ts'
import { datasetsCreate } from './commands/datasets-create.ts'
import { datasetsTerminate } from './commands/datasets-terminate.ts'
import { deposit } from './commands/deposit.ts'
import { fund } from './commands/fund.ts'
import { init } from './commands/init.ts'
import { pay } from './commands/pay.ts'
import { pieces } from './commands/pieces.ts'
import { piecesUpload } from './commands/pieces-upload.ts'
import { upload } from './commands/upload.ts'
import { uploadDataset } from './commands/upload-dataset.ts'

const argv = cli({
  name: 'synapse-cli',
  version: '0.0.1',

  commands: [
    init,
    pay,
    fund,
    deposit,
    upload,
    datasets,
    datasetsTerminate,
    datasetsCreate,
    pieces,
    piecesUpload,
    uploadDataset,
  ],
})

if (!argv.command) {
  argv.showHelp()
  process.exit(1)
}
