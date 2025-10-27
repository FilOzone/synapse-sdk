import { persistentMap } from '@nanostores/persistent'

type SettingsValue = {
  network: 'mainnet' | 'calibration'
}
export const isPlainObject = (payload: unknown): payload is { [key: string]: unknown } => {
  if (typeof payload !== 'object' || payload === null) return false
  if (payload === Object.prototype) return false
  if (Object.getPrototypeOf(payload) === null) return true

  return Object.getPrototypeOf(payload) === Object.prototype
}
export const store = persistentMap<SettingsValue>(
  'settings:',
  {
    network: 'calibration',
  },
  {
    encode: (value) => {
      if (typeof value === 'boolean') {
        return `$$boolean:${value}`
      }
      if (isPlainObject(value)) {
        return `$$object:${JSON.stringify(value)}`
      }
      if (typeof value === 'undefined' || value === null) {
        return ''
      }

      return value
    },
    decode: (value) => {
      if (value.startsWith('$$boolean:')) {
        return value.split(':')[1] === 'true'
      }
      if (value.startsWith('$$object:')) {
        return JSON.parse(value.replace('$$object:', ''))
      }
      if (value === '') {
        return undefined
      }
      return value
    },
  }
)
