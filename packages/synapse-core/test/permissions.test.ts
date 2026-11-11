import assert from 'assert'
import {
  AddPiecesPermission,
  CreateDataSetPermission,
  DefaultFwssPermissions,
  FwssPermissions,
  isFwssPermissionId,
  SchedulePieceRemovalsPermission,
  TerminateServicePermission,
} from '../src/session-key/permissions.ts'

describe('FwssPermissions', () => {
  it('maps console scope IDs to permission hashes', () => {
    assert.deepStrictEqual(FwssPermissions, {
      createDataSet: CreateDataSetPermission,
      addPieces: AddPiecesPermission,
      schedulePieceRemovals: SchedulePieceRemovalsPermission,
      terminateService: TerminateServicePermission,
    })
  })

  it('covers every default FWSS permission', () => {
    assert.deepStrictEqual(Object.values(FwssPermissions), DefaultFwssPermissions)
  })
})

describe('isFwssPermissionId', () => {
  it('accepts known IDs', () => {
    for (const id of Object.keys(FwssPermissions)) {
      assert.strictEqual(isFwssPermissionId(id), true)
    }
  })

  it('rejects unknown values', () => {
    for (const value of [
      'CreateDataSet',
      'createdataset',
      '',
      'toString',
      '__proto__',
      CreateDataSetPermission,
      1,
      null,
      undefined,
      {},
    ]) {
      assert.strictEqual(isFwssPermissionId(value), false)
    }
  })
})
