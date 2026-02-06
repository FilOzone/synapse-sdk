#!/usr/bin/env node

import { cli } from 'cleye'
import { datasets } from './commands/datasets.ts'
import { datasetsCreate } from './commands/datasets-create.ts'
import { datasetsTerminate } from './commands/datasets-terminate.ts'
import { deposit } from './commands/deposit.ts'
import { endorse } from './commands/endorse.ts'
import { fund } from './commands/fund.ts'
import { getSpPeerIds } from './commands/get-sp-peer-ids.ts'
import { init } from './commands/init.ts'
import { pay } from './commands/pay.ts'
import { pieces } from './commands/pieces.ts'
import { piecesRemoval } from './commands/pieces-removal.ts'
import { piecesUpload } from './commands/pieces-upload.ts'
import { upload } from './commands/upload.ts'
import { uploadDataset } from './commands/upload-dataset.ts'
import { withdraw } from './commands/withdraw.ts'

const argv = cli({
  name: 'synapse-cli',
  version: '0.0.1',

  commands: [
    init,
    pay,
    fund,
    deposit,
    withdraw,
    endorse,
    upload,
    datasets,
    datasetsTerminate,
    datasetsCreate,
    pieces,
    piecesRemoval,
    piecesUpload,
    uploadDataset,
    getSpPeerIds,
  ],
})

if (!argv.command) {
  argv.showHelp()
  process.exit(1)
}
